export interface CircuitBreakerConfig {
  maxTakeProfitPct?: number;
  maxLossPerTradePct: number;
  maxDailyLossEth: number;
}

export interface TradePnLEntry {
  timestamp: number;
  pnlEth: number;
}

export class CircuitBreaker {
  private maxTakeProfitPct: number;
  private maxLossPerTradePct: number;
  private maxDailyLossEth: number;
  private recentTrades: TradePnLEntry[] = [];
  private manuallyTripped: boolean = false;

  constructor(config: CircuitBreakerConfig) {
    this.maxTakeProfitPct = config.maxTakeProfitPct ?? 30.0;
    this.maxLossPerTradePct = config.maxLossPerTradePct;
    this.maxDailyLossEth = config.maxDailyLossEth;
  }

  public clampTakeProfit(proposedTakeProfitPct: number): number {
    return Math.min(proposedTakeProfitPct, this.maxTakeProfitPct);
  }

  public clampStopLoss(proposedStopLossPct: number): number {
    return Math.min(proposedStopLossPct, this.maxLossPerTradePct);
  }

  public recordClosedTrade(pnlEth: number): void {
    this.recentTrades.push({
      timestamp: Date.now(),
      pnlEth,
    });
    this.cleanupOldTrades();
  }

  private cleanupOldTrades(): void {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    this.recentTrades = this.recentTrades.filter((t) => t.timestamp >= oneDayAgo);
  }

  public getDailyLossEth(): number {
    this.cleanupOldTrades();
    let totalLoss = 0;
    for (const trade of this.recentTrades) {
      if (trade.pnlEth < 0) {
        totalLoss += Math.abs(trade.pnlEth);
      }
    }
    return totalLoss;
  }

  public getDailyNetPnLEth(): number {
    this.cleanupOldTrades();
    return this.recentTrades.reduce((acc, t) => acc + t.pnlEth, 0);
  }

  public isTripped(): boolean {
    if (this.manuallyTripped) return true;
    return this.getDailyLossEth() >= this.maxDailyLossEth;
  }

  public canOpenTrade(): { allowed: boolean; reason?: string } {
    if (this.isTripped()) {
      return {
        allowed: false,
        reason: `Circuit breaker tripped: 24h loss (${this.getDailyLossEth().toFixed(4)} ETH) hit or exceeded threshold (${this.maxDailyLossEth} ETH).`,
      };
    }
    return { allowed: true };
  }

  public tripManually(): void {
    this.manuallyTripped = true;
  }

  public reset(): void {
    this.manuallyTripped = false;
    this.recentTrades = [];
  }
}
