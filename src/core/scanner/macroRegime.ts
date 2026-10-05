export type MarketRegime = 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'DEFENSIVE_CRASH';

export class MacroEthSentinel {
  private lastEthPrice: number = 0;
  private currentRegime: MarketRegime = 'NEUTRAL';

  public evaluateRegime(previousPrice: number, currentPrice: number, priceChange5mPct: number): MarketRegime {
    this.lastEthPrice = currentPrice;

    // Flash Crash Guard: If ETH drops 2.0% or more in 5 minutes, trigger defensive mode immediately
    if (priceChange5mPct <= -2.0) {
      this.currentRegime = 'DEFENSIVE_CRASH';
      return 'DEFENSIVE_CRASH';
    }

    if (priceChange5mPct >= 0.3) {
      this.currentRegime = 'BULLISH';
      return 'BULLISH';
    }

    if (priceChange5mPct <= -0.5) {
      this.currentRegime = 'BEARISH';
      return 'BEARISH';
    }

    this.currentRegime = 'NEUTRAL';
    return 'NEUTRAL';
  }

  public getRegime(): MarketRegime {
    return this.currentRegime;
  }

  public getCurrentRegime(): MarketRegime {
    return this.currentRegime;
  }

  public shouldPauseNewBuys(): boolean {
    return this.currentRegime === 'DEFENSIVE_CRASH';
  }
}
