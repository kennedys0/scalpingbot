import { PositionTracker, Position } from './tracker.js';

export type ExitReason = 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'ANTI_DUMP' | 'PANIC_SELL';

export type OnExitCallback = (position: Position, reason: ExitReason, currentPriceUsd: number) => Promise<void>;

export class PositionTicker {
  private tracker: PositionTracker;
  private onExit: OnExitCallback;
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lastPrices: Map<string, number> = new Map();

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
      const lastPrice = this.lastPrices.get(pos.id);
      this.lastPrices.set(pos.id, currentPrice);

      // 0. Anti-Dump Check: Sudden flash dump drop >= 5% from previous tick
      if (lastPrice !== undefined && lastPrice > 0) {
        const tickDropPct = ((lastPrice - currentPrice) / lastPrice) * 100;
        if (tickDropPct >= 5.0) {
          await this.onExit(pos, 'ANTI_DUMP', currentPrice);
          this.lastPrices.delete(pos.id);
          continue;
        }
      }

      // Update highest price for trailing stop
      await this.tracker.updateHighestPrice(pos.id, currentPrice);
      const highestPrice = pos.highestPriceSeen || pos.entryPriceUsd;
      const dropFromHighestPct = ((highestPrice - currentPrice) / highestPrice) * 100;

      // 1. Take Profit check (capped at takeProfitPct, e.g. max 30%)
      if (pnlPct >= pos.takeProfitPct) {
        await this.onExit(pos, 'TAKE_PROFIT', currentPrice);
        this.lastPrices.delete(pos.id);
        continue;
      }

      // 2. Trailing stop check (if in profit >= 8% and dropped >= trailingStopPct from peak)
      const trailingThreshold = pos.trailingStopPct ?? 3.0;
      if (pnlPct >= 8.0 || (highestPrice > pos.entryPriceUsd * 1.08)) {
        if (dropFromHighestPct >= trailingThreshold) {
          await this.onExit(pos, 'TRAILING_STOP', currentPrice);
          this.lastPrices.delete(pos.id);
          continue;
        }
      }

      // 3. Stop Loss check (capped at stopLossPct, e.g. max 10%)
      if (pnlPct <= -pos.stopLossPct) {
        await this.onExit(pos, 'STOP_LOSS', currentPrice);
        this.lastPrices.delete(pos.id);
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
