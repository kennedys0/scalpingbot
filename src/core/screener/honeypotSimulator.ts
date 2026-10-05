import { PublicClient, parseAbi, parseEther } from 'viem';

export interface HoneypotSimulationResult {
  isHoneypot: boolean;
  buyTaxPct: number;
  sellTaxPct: number;
  canSell: boolean;
  reason?: string;
}

export class OnChainHoneypotSimulator {
  private client: PublicClient;

  constructor(client: PublicClient) {
    this.client = client;
  }

  public async simulateToken(
    tokenAddress: `0x${string}`,
    routerAddress: `0x${string}` = '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' // Default Uniswap V2 Router on Base
  ): Promise<HoneypotSimulationResult> {
    try {
      // 1. Verify ERC20 basic functions
      const erc20Abi = parseAbi([
        'function totalSupply() external view returns (uint256)',
        'function decimals() external view returns (uint8)',
        'function balanceOf(address account) external view returns (uint256)',
      ]);

      const [totalSupply, decimals] = await Promise.all([
        this.client.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'totalSupply',
        }),
        this.client.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'decimals',
        }),
      ]);

      if (totalSupply === 0n) {
        return {
          isHoneypot: true,
          buyTaxPct: 100,
          sellTaxPct: 100,
          canSell: false,
          reason: 'Zero total supply reported by contract',
        };
      }

      // 2. Simulate Router getAmountsOut for simulated buy and sell
      const routerAbi = parseAbi([
        'function getAmountsOut(uint amountIn, address[] memory path) external view returns (uint[] memory amounts)',
        'function WETH() external view returns (address)',
      ]);

      let wethAddress: `0x${string}`;
      try {
        wethAddress = await this.client.readContract({
          address: routerAddress,
          abi: routerAbi,
          functionName: 'WETH',
        });
      } catch {
        wethAddress = '0x4200000000000000000000000000000000000006'; // Base WETH
      }

      // Check buy quote with static call
      const testAmountIn = parseEther('0.001');
      const buyAmounts = await this.client.readContract({
        address: routerAddress,
        abi: routerAbi,
        functionName: 'getAmountsOut',
        args: [testAmountIn, [wethAddress, tokenAddress]],
      });

      if (!buyAmounts || buyAmounts.length < 2 || buyAmounts[1] === 0n) {
        return {
          isHoneypot: true,
          buyTaxPct: 100,
          sellTaxPct: 100,
          canSell: false,
          reason: 'Router returned zero tokens on buy simulation',
        };
      }

      // Check sell quote back to WETH
      const tokensReceived = buyAmounts[1];
      const sellAmounts = await this.client.readContract({
        address: routerAddress,
        abi: routerAbi,
        functionName: 'getAmountsOut',
        args: [tokensReceived, [tokenAddress, wethAddress]],
      });

      if (!sellAmounts || sellAmounts.length < 2 || sellAmounts[1] === 0n) {
        return {
          isHoneypot: true,
          buyTaxPct: 0,
          sellTaxPct: 100,
          canSell: false,
          reason: 'Sell simulation returned zero ETH',
        };
      }

      return {
        isHoneypot: false,
        buyTaxPct: 0,
        sellTaxPct: 0,
        canSell: true,
      };
    } catch (err) {
      return {
        isHoneypot: true,
        buyTaxPct: 100,
        sellTaxPct: 100,
        canSell: false,
        reason: `On-chain simulation reverted: ${(err as Error).message}`,
      };
    }
  }
}
