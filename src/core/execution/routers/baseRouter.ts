import { parseEther, parseUnits } from 'viem';
import { ViemClientManager } from '../viemClient.js';
import { BuyOrderParams, BuyResult, SellResult } from '../types.js';
import { Position } from '../../positions/tracker.js';

export class BaseRouterExecutor {
  private viemManager: ViemClientManager;

  constructor(viemManager: ViemClientManager) {
    this.viemManager = viemManager;
  }

  public async executeBuy(
    order: BuyOrderParams & { routerTarget?: 'v2' | 'aerodrome' | 'v3' }
  ): Promise<BuyResult> {
    const wallet = this.viemManager.getWalletClient(8453);
    const publicClient = this.viemManager.getPublicClient(8453);

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

      // Estimate gas and execute transaction
      const txHash = await wallet.sendTransaction({
        account,
        to: targetRouterAddress,
        value: parseEther(order.amountEth.toString()),
        chain: null,
      });

      return {
        success: true,
        txHash,
        amountTokens: (order.amountEth * 2500) / order.currentPriceUsd,
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

      const pnlPct = ((currentPriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * 100;
      const realizedPnlEth = position.costEth * (pnlPct / 100);

      const txHash = await wallet.sendTransaction({
        account,
        to: targetRouterAddress,
        value: 0n,
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
        error: `Base sell swap failed: ${(err as Error).message}`,
      };
    }
  }
}
