export interface CircuitBreakerConfig {
  maxTakeProfitPct?: number;
  maxLossPerTradePct: number;
  maxDailyLossEth: number;
  maxConsecutiveLosses?: number;
  streakCooldownMinutes?: number;
}

export interface TradePnLEntry {
  timestamp: number;
  pnlEth: number;
}

export class CircuitBreaker {
  private maxTakeProfitPct: number;
  private maxLossPerTradePct: number;
  private maxDailyLossEth: number;
  private maxConsecutiveLosses: number;
  private streakCooldownMinutes: number;
  private consecutiveLosses: number = 0;
  private streakCooldownUntil: number = 0;
  private recentTrades: TradePnLEntry[] = [];
  private manuallyTripped: boolean = false;

  constructor(config: CircuitBreakerConfig) {
    this.maxTakeProfitPct = config.maxTakeProfitPct ?? 30.0;
    this.maxLossPerTradePct = config.maxLossPerTradePct;
    this.maxDailyLossEth = config.maxDailyLossEth;
    this.maxConsecutiveLosses = config.maxConsecutiveLosses ?? 3;
    this.streakCooldownMinutes = config.streakCooldownMinutes ?? 30;
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

    if (pnlEth < 0) {
      this.consecutiveLosses++;
      if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
        this.streakCooldownUntil = Date.now() + this.streakCooldownMinutes * 60 * 1000;
      }
    } else if (pnlEth > 0) {
      this.consecutiveLosses = 0;
    }
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

  public getConsecutiveLossCount(): number {
    return this.consecutiveLosses;
  }

  public isTripped(): boolean {
    if (this.manuallyTripped) return true;
    if (Date.now() < this.streakCooldownUntil) return true;
    return this.getDailyLossEth() >= this.maxDailyLossEth;
  }

  public canOpenTrade(): { allowed: boolean; reason?: string } {
    if (this.manuallyTripped) {
      return { allowed: false, reason: 'Circuit breaker tripped manually by operator.' };
    }

    if (Date.now() < this.streakCooldownUntil) {
      const remainingMin = Math.ceil((this.streakCooldownUntil - Date.now()) / (60 * 1000));
      return {
        allowed: false,
        reason: `Consecutive loss streak breaker active: ${this.consecutiveLosses} consecutive stop-losses incurred. Cooling down for ${remainingMin}m.`,
      };
    }

    if (this.getDailyLossEth() >= this.maxDailyLossEth) {
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
    this.consecutiveLosses = 0;
    this.streakCooldownUntil = 0;
    this.recentTrades = [];
  }
}
