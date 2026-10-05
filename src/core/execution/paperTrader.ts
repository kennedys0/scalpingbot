import { BuyOrderParams, BuyResult, SellResult } from './types.js';
import { Position } from '../positions/tracker.js';

export class PaperTrader {
  private virtualBalanceEth: number;
  private ethPriceUsd: number = 2500; // Reference ETH price for token count calculations

  constructor(initialEth: number = 1.0) {
    this.virtualBalanceEth = initialEth;
  }

  public getVirtualBalanceEth(): number {
    return this.virtualBalanceEth;
  }

  public resetBalance(amountEth: number = 1.0): void {
    this.virtualBalanceEth = amountEth;
  }

  public async simulateBuy(order: BuyOrderParams, isShadow: boolean = false): Promise<BuyResult> {
    if (!isShadow && order.amountEth > this.virtualBalanceEth) {
      return {
        success: false,
        error: `Insufficient virtual ETH balance: ${this.virtualBalanceEth.toFixed(4)} ETH available, ${order.amountEth} ETH requested.`,
      };
    }

    // Apply 0.5% simulated slippage to fill price
    const slippage = (order.slippagePct ?? 1.0) / 100;
    const filledPriceUsd = order.currentPriceUsd * (1 + Math.min(slippage, 0.005));
    const totalOrderValueUsd = order.amountEth * this.ethPriceUsd;
    const amountTokens = totalOrderValueUsd / filledPriceUsd;

    // Deduct cost from virtual balance (including simulated 0.0003 ETH gas fee) only if not in shadow mode
    if (!isShadow) {
      this.virtualBalanceEth -= (order.amountEth + 0.0003);
    }

    return {
      success: true,
      amountTokens,
      filledPriceUsd,
      txHash: `0x${isShadow ? 'shadow' : 'paper'}_buy_${Date.now().toString(16)}`,
    };
  }

  public async simulateSell(position: Position, currentPriceUsd: number, isShadow: boolean = false): Promise<SellResult> {
    // Apply 0.5% simulated slippage to fill price
    const filledPriceUsd = currentPriceUsd * (1 - 0.005);
    const proceedsUsd = position.amountTokens * filledPriceUsd;
    const proceedsEth = proceedsUsd / this.ethPriceUsd;

    const realizedPnlEth = proceedsEth - position.costEth;
    const realizedPnlPct = ((filledPriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * 100;

    // Credit proceeds (minus simulated gas) back to virtual balance only if not in shadow mode
    if (!isShadow) {
      this.virtualBalanceEth += (proceedsEth - 0.0003);
    }

    return {
      success: true,
      realizedPnlEth,
      realizedPnlPct,
      filledPriceUsd,
      txHash: `0x${isShadow ? 'shadow' : 'paper'}_sell_${Date.now().toString(16)}`,
    };
  }

  public async simulatePartialSell(
    position: Position,
    currentPriceUsd: number,
    pctToSell: number = 50,
    isShadow: boolean = false
  ): Promise<SellResult> {
    const fraction = pctToSell / 100;
    const filledPriceUsd = currentPriceUsd * (1 - 0.005);
    const tokensSold = position.amountTokens * fraction;
    const costEthSold = position.costEth * fraction;

    const proceedsUsd = tokensSold * filledPriceUsd;
    const proceedsEth = proceedsUsd / this.ethPriceUsd;

    const realizedPnlEth = proceedsEth - costEthSold;
    const realizedPnlPct = ((filledPriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * 100;

    // Credit proceeds (minus simulated gas) back to virtual balance only if not in shadow mode
    if (!isShadow) {
      this.virtualBalanceEth += (proceedsEth - 0.0003);
    }

    return {
      success: true,
      realizedPnlEth,
      realizedPnlPct,
      filledPriceUsd,
      txHash: `0x${isShadow ? 'shadow' : 'paper'}_part_sell_${Date.now().toString(16)}`,
    };
  }
}
