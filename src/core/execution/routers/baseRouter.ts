import { parseEther, parseAbi, encodeFunctionData, maxUint256 } from 'viem';
import { ViemClientManager } from '../viemClient.js';
import { BuyOrderParams, BuyResult, SellResult } from '../types.js';
import { Position } from '../../positions/tracker.js';
import { rateService } from '../../services/rateService.js';

const ROUTER_ABI = parseAbi([
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external',
  'function WETH() external view returns (address)',
]);

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
]);

const BASE_WETH: `0x${string}` = '0x4200000000000000000000000000000000000006';

export class BaseRouterExecutor {
  private viemManager: ViemClientManager;

  constructor(viemManager: ViemClientManager) {
    this.viemManager = viemManager;
  }

  public async executeBuy(
    order: BuyOrderParams & { routerTarget?: 'v2' | 'aerodrome' | 'v3' }
  ): Promise<BuyResult> {
    const wallet = this.viemManager.getWalletClient(8453);

    if (!wallet) {
      return { success: false, error: 'Wallet private key not configured for live trading on Base' };
    }

    try {
      const account = wallet.account;
      if (!account) throw new Error('No account found on wallet client');

      // Select target router: Default Uniswap V2 router on Base, or Aerodrome
      const targetRouterAddress =
        order.routerTarget === 'aerodrome'
          ? ('0xcF77a3Ba9A5CA399B7c97c7488454543B7374BE' as `0x${string}`)
          : ('0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' as `0x${string}`); // Uniswap V2 Router02 Base

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
      const buyData = encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
        args: [
          0n, // amountOutMin (rely on slippage checks / private RPC)
          [BASE_WETH, order.tokenAddress as `0x${string}`],
          account.address,
          deadline,
        ],
      });

      // Execute on-chain buy swap with calldata
      const txHash = await wallet.sendTransaction({
        account,
        to: targetRouterAddress,
        value: parseEther(order.amountEth.toString()),
        data: buyData,
        chain: null,
      });

      const publicClient = this.viemManager.getPublicClient(8453);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 30000,
      });

      if (receipt.status !== 'success') {
        return {
          success: false,
          txHash,
          error: `Base swap execution reverted on-chain (status: ${receipt.status})`,
        };
      }

      // Query actual on-chain token balance received
      let tokenUnits = (order.amountEth * rateService.getEthPriceUsd()) / order.currentPriceUsd;
      try {
        const [tokenBal, decimals] = await Promise.all([
          publicClient.readContract({
            address: order.tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [account.address],
          }),
          publicClient.readContract({
            address: order.tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'decimals',
          }).catch(() => 18),
        ]);
        if (tokenBal > 0n) {
          tokenUnits = Number(tokenBal) / 10 ** Number(decimals);
        }
      } catch {
        // Fallback to estimated token units if RPC query fails
      }

      return {
        success: true,
        txHash,
        amountTokens: tokenUnits,
        filledPriceUsd: order.currentPriceUsd,
      };
    } catch (err) {
      return {
        success: false,
        error: `Base swap execution failed: ${(err as Error).message}`,
      };
    }
  }

  public async executeSell(
    position: Position,
    currentPriceUsd: number,
    routerTarget?: 'v2' | 'aerodrome' | 'v3'
  ): Promise<SellResult> {
    const wallet = this.viemManager.getWalletClient(8453);
    const publicClient = this.viemManager.getPublicClient(8453);

    if (!wallet) {
      return { success: false, error: 'Wallet private key not configured for live trading on Base' };
    }

    try {
      const account = wallet.account;
      if (!account) throw new Error('No account found');

      const targetRouterAddress =
        routerTarget === 'aerodrome'
          ? ('0xcF77a3Ba9A5CA399B7c97c7488454543B7374BE' as `0x${string}`)
          : ('0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' as `0x${string}`); // Uniswap V2 Router02 Base

      const tokenAddr = position.tokenAddress as `0x${string}`;

      // Check on-chain balance & allowance
      const [balance, allowance] = await Promise.all([
        publicClient.readContract({
          address: tokenAddr,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [account.address],
        }).catch(() => 0n),
        publicClient.readContract({
          address: tokenAddr,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [account.address, targetRouterAddress],
        }).catch(() => 0n),
      ]);

      if (balance === 0n) {
        // Zero token balance on-chain means the tokens are already sold, burned, or liquidated
        return {
          success: true,
          realizedPnlEth: -position.costEth,
          realizedPnlPct: -100,
          filledPriceUsd: 0,
          txHash: '0xzero_balance_reconciled',
        };
      }

      // Approve router if allowance is insufficient
      if (allowance < balance) {
        const approveData = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [targetRouterAddress, maxUint256],
        });
        const approveTx = await wallet.sendTransaction({
          account,
          to: tokenAddr,
          data: approveData,
          chain: null,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: 20000 }).catch(() => {});
      }

      // Encode sell swap calldata
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
      const sellData = encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
        args: [
          balance,
          0n, // amountOutMin
          [tokenAddr, BASE_WETH],
          account.address,
          deadline,
        ],
      });

      const pnlPct = ((currentPriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * 100;
      const realizedPnlEth = position.costEth * (pnlPct / 100);

      const txHash = await wallet.sendTransaction({
        account,
        to: targetRouterAddress,
        value: 0n,
        data: sellData,
        chain: null,
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 30000,
      });

      if (receipt.status !== 'success') {
        return {
          success: false,
          txHash,
          error: `Base sell swap reverted on-chain (status: ${receipt.status})`,
        };
      }

      return {
        success: true,
        realizedPnlEth,
        realizedPnlPct: pnlPct,
        filledPriceUsd: currentPriceUsd,
        txHash,
      };
    } catch (err) {
      return {
        success: false,
        error: `Base sell swap failed: ${(err as Error).message}`,
      };
    }
  }
}
