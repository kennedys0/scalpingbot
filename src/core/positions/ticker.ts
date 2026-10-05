import { PositionTracker, Position } from './tracker.js';

export type ExitReason = 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'PANIC_SELL';

export type OnExitCallback = (position: Position, reason: ExitReason, currentPriceUsd: number) => Promise<void>;

export class PositionTicker {
  private tracker: PositionTracker;
  private onExit: OnExitCallback;
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(tracker: PositionTracker, onExit: OnExitCallback) {
    this.tracker = tracker;
    this.onExit = onExit;
  }

  public async checkPositionsWithPrices(priceMap: Record<string, number>): Promise<void> {
    const activePositions = await this.tracker.getActivePositions();

    for (const pos of activePositions) {
      const currentPrice = priceMap[pos.tokenAddress] || priceMap[pos.tokenAddress.toLowerCase()];
      if (currentPrice === undefined || currentPrice <= 0) continue;

      const pnlPct = ((currentPrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;

      // Update highest price for trailing stop
      await this.tracker.updateHighestPrice(pos.id, currentPrice);
      const highestPrice = pos.highestPriceSeen || pos.entryPriceUsd;
      const dropFromHighestPct = ((highestPrice - currentPrice) / highestPrice) * 100;

      // 1. Take Profit check
      if (pnlPct >= pos.takeProfitPct) {
        await this.onExit(pos, 'TAKE_PROFIT', currentPrice);
        continue;
      }

      // 2. Trailing stop check (if in profit >= 8% and dropped >= trailingStopPct from peak)
      if (pos.trailingStopPct && pnlPct >= 8.0 && dropFromHighestPct >= pos.trailingStopPct) {
        await this.onExit(pos, 'TRAILING_STOP', currentPrice);
        continue;
      }

      // 3. Stop Loss check
      if (pnlPct <= -pos.stopLossPct) {
        await this.onExit(pos, 'STOP_LOSS', currentPrice);
        continue;
      }
    }
  }

  public start(intervalMs: number = 5000, priceFetcher: () => Promise<Record<string, number>>): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.timer = setInterval(async () => {
      try {
        const prices = await priceFetcher();
        await this.checkPositionsWithPrices(prices);
      } catch (err) {
        console.warn(`Position ticker error: ${(err as Error).message}`);
      }
    }, intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }
}
