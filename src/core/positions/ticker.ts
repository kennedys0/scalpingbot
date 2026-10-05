import { PositionTracker, Position } from './tracker.js';

export type ExitReason =
  | 'TAKE_PROFIT'
  | 'STOP_LOSS'
  | 'TRAILING_STOP'
  | 'ANTI_DUMP'
  | 'EMERGENCY_DUMP_EXIT'
  | 'PANIC_SELL'
  | 'TIME_EXPIRATION'
  | 'MANUAL_SELL'
  | 'RUGPULL_WRITE_OFF'
  | 'RECONCILED_ON_CHAIN_ZERO_BALANCE';

export type OnExitCallback = (position: Position, reason: ExitReason, currentPriceUsd: number) => Promise<void>;
export type OnPartialTakeProfitCallback = (position: Position, currentPriceUsd: number, pctToSell: number) => Promise<void>;

export class PositionTicker {
  private tracker: PositionTracker;
  private onExit: OnExitCallback;
  private onPartialTakeProfit?: OnPartialTakeProfitCallback;
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lastPrices: Map<string, number> = new Map();
  private tickHistories: Map<string, number[]> = new Map();
  private missingPriceCounts: Map<string, number> = new Map();

  constructor(
    tracker: PositionTracker,
    onExit: OnExitCallback,
    onPartialTakeProfit?: OnPartialTakeProfitCallback
  ) {
    this.tracker = tracker;
    this.onExit = onExit;
    this.onPartialTakeProfit = onPartialTakeProfit;
  }

  public async checkPositionsWithPrices(priceMap: Record<string, number>): Promise<void> {
    const activePositions = await this.tracker.getActivePositions();

    for (const pos of activePositions) {
      const currentPrice = priceMap[pos.tokenAddress] || priceMap[pos.tokenAddress.toLowerCase()];
      if (currentPrice === undefined || currentPrice <= 0) {
        const count = (this.missingPriceCounts.get(pos.id) || 0) + 1;
        this.missingPriceCounts.set(pos.id, count);

        // If price is completely missing/0 for >= 3 ticks (15s), pool has been drained or deleted (Rugpull)
        if (count >= 3) {
          console.warn(`🚨 [TICKER RUGPULL DETECTED] $${pos.tokenSymbol} price missing/0 for ${count} ticks. Triggering ANTI_DUMP exit.`);
          await this.onExit(pos, 'ANTI_DUMP', 0);
          this.missingPriceCounts.delete(pos.id);
          this.lastPrices.delete(pos.id);
          this.tickHistories.delete(pos.id);
        }
        continue;
      }
      this.missingPriceCounts.delete(pos.id);

      const rawPnl = ((currentPrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
      const pnlPct = Math.round(rawPnl * 100) / 100;
      const history = this.tickHistories.get(pos.id) || [];
      const lastPrice = history.length > 0 ? history[history.length - 1] : this.lastPrices.get(pos.id);

      // 0. Multi-Factor Anti-Dump Check:
      // A: Acute single-tick flash plunge >= 4.5%
      // B: Multi-tick rolling cascade drop >= 5.0% across the last 3 ticks
      if (lastPrice !== undefined && lastPrice > 0) {
        const singleTickDropPct = ((lastPrice - currentPrice) / lastPrice) * 100;
        const rollingDropPct = history.length >= 2
          ? ((history[0] - currentPrice) / history[0]) * 100
          : singleTickDropPct;

        if (singleTickDropPct >= 4.5 || (history.length >= 2 && rollingDropPct >= 5.0)) {
          await this.onExit(pos, 'ANTI_DUMP', currentPrice);
          this.lastPrices.delete(pos.id);
          this.tickHistories.delete(pos.id);
          continue;
        }
      }

      // Record tick history (retain up to 3 ticks)
      const updatedHistory = [...history, currentPrice].slice(-3);
      this.tickHistories.set(pos.id, updatedHistory);
      this.lastPrices.set(pos.id, currentPrice);

      // Update highest price for trailing stop
      await this.tracker.updateHighestPrice(pos.id, currentPrice);
      const highestPrice = pos.highestPriceSeen || pos.entryPriceUsd;
      const dropFromHighestPct = ((highestPrice - currentPrice) / highestPrice) * 100;

      // 1. Full Take Profit check (when price reaches or exceeds the position's target TP)
      if (pnlPct >= pos.takeProfitPct) {
        await this.onExit(pos, 'TAKE_PROFIT', currentPrice);
        this.lastPrices.delete(pos.id);
        this.tickHistories.delete(pos.id);
        continue;
      }

      // 2. Partial Take Profit Laddering: At +15% profit (if full TP target > 15%), sell 50% and raise stop loss to +1% (Breakeven)
      if (pos.takeProfitPct > 15.0 && pnlPct >= 15.0 && !pos.partialTakeProfitDone) {
        if (this.onPartialTakeProfit) {
          await this.onPartialTakeProfit(pos, currentPrice, 50);
        }
        await this.tracker.markPartialTakeProfit(pos.id, -1.0);
        // Position remains OPEN with updated state
        continue;
      }

      // 3. Trailing stop check (if in profit >= 8% and dropped >= trailingStopPct from peak)
      const trailingThreshold = pos.trailingStopPct ?? 3.0;
      if (pnlPct >= 8.0 || (highestPrice > pos.entryPriceUsd * 1.08)) {
        if (dropFromHighestPct >= trailingThreshold) {
          await this.onExit(pos, 'TRAILING_STOP', currentPrice);
          this.lastPrices.delete(pos.id);
          this.tickHistories.delete(pos.id);
          continue;
        }
      }

      // 4. Stop Loss check (capped at stopLossPct, e.g. max 10%)
      if (pnlPct <= -pos.stopLossPct) {
        await this.onExit(pos, 'STOP_LOSS', currentPrice);
        this.lastPrices.delete(pos.id);
        this.tickHistories.delete(pos.id);
        continue;
      }

      // 5. Stale Trade Time-Based Exit: If open for >= 45 min and price is stagnant (-2% <= pnl <= +2%)
      const openDurationMs = Date.now() - (pos.openedAt || Date.now());
      if (openDurationMs >= 45 * 60 * 1000 && Math.abs(pnlPct) <= 2.0) {
        await this.onExit(pos, 'TIME_EXPIRATION', currentPrice);
        this.lastPrices.delete(pos.id);
        this.tickHistories.delete(pos.id);
        continue;
      }
    }
  }

  public async evaluateSniperSafety(
    position: Position,
    signals: {
      currentPriceUsd: number;
      buyPressureRatio5m?: number;
      volumeDelta5m?: number;
      isEmergencyDump?: boolean;
    }
  ): Promise<boolean> {
    if (
      signals.isEmergencyDump ||
      (signals.buyPressureRatio5m !== undefined && signals.buyPressureRatio5m < 0.20 && (signals.volumeDelta5m ?? 0) < 0)
    ) {
      await this.onExit(position, 'EMERGENCY_DUMP_EXIT', signals.currentPriceUsd);
      this.lastPrices.delete(position.id);
      this.tickHistories.delete(position.id);
      return true;
    }
    return false;
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

  public getLastPrice(positionId: string): number | undefined {
    return this.lastPrices.get(positionId);
  }

  public getAllLastPrices(): Map<string, number> {
    return new Map(this.lastPrices);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }
}
