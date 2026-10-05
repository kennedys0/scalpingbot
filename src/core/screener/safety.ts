export interface TokenSecurityData {
  pairAddress: string;
  liquidityUsd: number;
  buyTax: number;
  sellTax: number;
  isHoneypot: boolean;
  isOpenTrading: boolean;
  isLiquidityLocked?: boolean;
  priceChange5m?: number;
  sellVolumeRatio?: number;
}

export interface ScreeningResult {
  isSafe: boolean;
  reasons: string[];
}

export class SafetyScreener {
  private minLiquidityUsd: number;
  private maxTaxPct: number;
  private max5mDropPct: number;
  private maxSellRatio: number;

  constructor(options: {
    minLiquidityUsd?: number;
    maxTaxPct?: number;
    max5mDropPct?: number;
    maxSellRatio?: number;
  } = {}) {
    this.minLiquidityUsd = options.minLiquidityUsd ?? 5000;
    this.maxTaxPct = options.maxTaxPct ?? 7;
    this.max5mDropPct = options.max5mDropPct ?? 8.0;
    this.maxSellRatio = options.maxSellRatio ?? 0.60;
  }

  public screenToken(data: TokenSecurityData): ScreeningResult {
    const reasons: string[] = [];

    if (data.isHoneypot) {
      reasons.push('Token is identified as a honeypot (cannot sell).');
    }

    if (!data.isOpenTrading) {
      reasons.push('Trading is paused or not yet open for this token.');
    }

    if (data.liquidityUsd < this.minLiquidityUsd) {
      reasons.push(
        `Insufficient pool liquidity: $${data.liquidityUsd} is less than minimum $${this.minLiquidityUsd}.`
      );
    }

    if (data.buyTax > this.maxTaxPct) {
      reasons.push(`Buy tax too high: ${data.buyTax}% exceeds max ${this.maxTaxPct}%.`);
    }

    if (data.sellTax > this.maxTaxPct) {
      reasons.push(`Sell tax too high: ${data.sellTax}% exceeds max ${this.maxTaxPct}%.`);
    }

    // Anti-Dump Check
    if (data.priceChange5m !== undefined && data.priceChange5m <= -this.max5mDropPct) {
      reasons.push(`Anti-dump filter triggered: 5m price drop (${data.priceChange5m}%) exceeds -${this.max5mDropPct}%.`);
    }

    if (data.sellVolumeRatio !== undefined && data.sellVolumeRatio >= this.maxSellRatio) {
      reasons.push(`Anti-dump filter triggered: sell pressure (${(data.sellVolumeRatio * 100).toFixed(1)}%) indicates whale dumping.`);
    }

    return {
      isSafe: reasons.length === 0,
      reasons,
    };
  }
}
