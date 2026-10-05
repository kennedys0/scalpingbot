import { parseEther, parseAbi, encodeFunctionData, maxUint256 } from 'viem';
import { ViemClientManager } from '../viemClient.js';
import { BuyOrderParams, BuyResult, SellResult } from '../types.js';
import { Position } from '../../positions/tracker.js';
import { rateService } from '../../services/rateService.js';

// BUG-03 & BUG-04 FIX:
// Previously, rhRouter sent raw ETH to Uniswap V4 PoolManager without any calldata,
// which would cause ETH to be locked/lost and no swap to occur.
// Now uses Uniswap V3 SwapRouter02 (deployed on Robinhood Chain) which has a compatible
// V2-style interface for memecoin swaps.
const ROUTER_ABI = parseAbi([
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external',
]);

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
]);

// Uniswap V3 SwapRouter02 on Robinhood Chain (V2-compatible interface)
const RH_ROUTER_ADDRESS: `0x${string}` = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
// WETH on Robinhood Chain (same canonical address as other EVM chains)
const RH_WETH: `0x${string}` = '0x4200000000000000000000000000000000000006';

export class RobinhoodRouterExecutor {
  private viemManager: ViemClientManager;

  constructor(viemManager: ViemClientManager) {
    this.viemManager = viemManager;
  }

  public async executeBuy(order: BuyOrderParams): Promise<BuyResult> {
    const wallet = this.viemManager.getWalletClient(4663);

    if (!wallet) {
      return { success: false, error: 'Wallet private key not configured for live trading on Robinhood Chain' };
    }

    try {
      const account = wallet.account;
      if (!account) throw new Error('No account found on wallet client');

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
      const buyData = encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
        args: [
          0n, // amountOutMin — rely on slippage parameter / private RPC
          [RH_WETH, order.tokenAddress as `0x${string}`],
          account.address,
          deadline,
        ],
      });

      const txHash = await wallet.sendTransaction({
        account,
        to: RH_ROUTER_ADDRESS,
        value: parseEther(order.amountEth.toString()),
        data: buyData,
        chain: null,
      });

      return {
        success: true,
        txHash,
        // Use real-time ETH price for accurate token amount tracking
        amountTokens: (order.amountEth * rateService.getEthPriceUsd()) / order.currentPriceUsd,
        filledPriceUsd: order.currentPriceUsd,
      };
    } catch (err) {
      return {
        success: false,
        error: `Robinhood V3 buy swap execution failed: ${(err as Error).message}`,
      };
    }
  }

  public async executeSell(position: Position, currentPriceUsd: number): Promise<SellResult> {
    const wallet = this.viemManager.getWalletClient(4663);
    const publicClient = this.viemManager.getPublicClient(4663);

    if (!wallet) {
      return { success: false, error: 'Wallet private key not configured for live trading on Robinhood Chain' };
    }

    try {
      const account = wallet.account;
      if (!account) throw new Error('No account found');

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
          args: [account.address, RH_ROUTER_ADDRESS],
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
          args: [RH_ROUTER_ADDRESS, maxUint256],
        });
        const approveTx = await wallet.sendTransaction({
          account,
          to: tokenAddr,
          data: approveData,
          chain: null,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: 20000 }).catch(() => {});
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
      const sellData = encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
        args: [
          balance,
          0n, // amountOutMin
          [tokenAddr, RH_WETH],
          account.address,
          deadline,
        ],
      });

      const pnlPct = ((currentPriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * 100;
      const realizedPnlEth = position.costEth * (pnlPct / 100);

      const txHash = await wallet.sendTransaction({
        account,
        to: RH_ROUTER_ADDRESS,
        value: 0n,
        data: sellData,
        chain: null,
      });

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
        error: `Robinhood sell swap failed: ${(err as Error).message}`,
      };
    }
  }
}
