export interface TokenSecurityData {
  pairAddress: string;
  liquidityUsd: number;
  buyTax: number;
  sellTax: number;
  isHoneypot: boolean;
  isOpenTrading: boolean;
  isLiquidityLocked?: boolean;
}

export interface ScreeningResult {
  isSafe: boolean;
  reasons: string[];
}

export class SafetyScreener {
  private minLiquidityUsd: number;
  private maxTaxPct: number;

  constructor(options: { minLiquidityUsd?: number; maxTaxPct?: number } = {}) {
    this.minLiquidityUsd = options.minLiquidityUsd ?? 5000;
    this.maxTaxPct = options.maxTaxPct ?? 7;
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

    return {
      isSafe: reasons.length === 0,
      reasons,
    };
  }
}
