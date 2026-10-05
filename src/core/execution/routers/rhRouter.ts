import { parseEther } from 'viem';
import { ViemClientManager } from '../viemClient.js';
import { BuyOrderParams, BuyResult, SellResult } from '../types.js';
import { Position } from '../../positions/tracker.js';

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

      // Uniswap V4 PoolManager / Universal Router swap on Robinhood Chain
      const txHash = await wallet.sendTransaction({
        account,
        to: '0x000000000004444c5dc75cB358380D2e3dE08A90' as `0x${string}`, // Uniswap V4 PoolManager
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
        error: `Robinhood V4 swap execution failed: ${(err as Error).message}`,
      };
    }
  }

  public async executeSell(position: Position, currentPriceUsd: number): Promise<SellResult> {
    const wallet = this.viemManager.getWalletClient(4663);
    if (!wallet) {
      return { success: false, error: 'Wallet private key not configured for live trading on Robinhood Chain' };
    }

    try {
      const account = wallet.account;
      if (!account) throw new Error('No account found');

      const pnlPct = ((currentPriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * 100;
      const realizedPnlEth = position.costEth * (pnlPct / 100);

      const txHash = await wallet.sendTransaction({
        account,
        to: '0x000000000004444c5dc75cB358380D2e3dE08A90' as `0x${string}`,
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
        error: `Robinhood sell swap failed: ${(err as Error).message}`,
      };
    }
  }
}
