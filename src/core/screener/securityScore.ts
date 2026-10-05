export interface TokenSecurityFactors {
  canSell: boolean;
  isHoneypot: boolean;
  buyTaxPct: number;
  sellTaxPct: number;
  liquidityUsd: number;
  fdvUsd?: number;
  isOpenTrading?: boolean;
}

export interface SecurityScoreBreakdown {
  simulationScore: number; // max 35 pts
  taxScore: number;        // max 25 pts
  liquidityScore: number;  // max 25 pts
  fdvRatioScore: number;   // max 15 pts
}

export interface TokenSecurityScoreResult {
  totalScore: number; // 0 - 100
  passed: boolean;
  minRequiredScore: number;
  breakdown: SecurityScoreBreakdown;
  reasons: string[];
}

export class TokenSecurityScorer {
  private minRequiredScore: number;

  constructor(minRequiredScore: number = 80) {
    this.minRequiredScore = minRequiredScore;
  }

  public calculateScore(factors: TokenSecurityFactors): TokenSecurityScoreResult {
    const reasons: string[] = [];

    // 1. Simulation & Honeypot Check (Max 35 pts)
    let simulationScore = 35;
    if (factors.isHoneypot || !factors.canSell) {
      simulationScore = 0;
      reasons.push('CRITICAL: Simulation failed or token flagged as honeypot (cannot sell).');
    }
    if (factors.isOpenTrading === false) {
      simulationScore = 0;
      reasons.push('CRITICAL: Trading is paused or not open.');
    }

    // 2. Tax Score (Max 25 pts)
    let taxScore = 25;
    const maxTax = Math.max(factors.buyTaxPct, factors.sellTaxPct);
    if (maxTax > 10) {
      taxScore = 0;
      reasons.push(`Tax penalty: Tax (${maxTax.toFixed(1)}%) is above maximum 10% threshold.`);
    } else if (maxTax > 5) {
      taxScore = 10;
      reasons.push(`Moderate tax penalty: Tax (${maxTax.toFixed(1)}%) is between 5% and 10%.`);
    } else if (maxTax > 2) {
      taxScore = 20;
    }

    // 3. Liquidity Score (Max 25 pts)
    let liquidityScore = 0;
    if (factors.liquidityUsd >= 50000) {
      liquidityScore = 25;
    } else if (factors.liquidityUsd >= 20000) {
      liquidityScore = 20;
    } else if (factors.liquidityUsd >= 10000) {
      liquidityScore = 15;
    } else if (factors.liquidityUsd >= 5000) {
      liquidityScore = 10;
    } else {
      liquidityScore = 0;
      reasons.push(`Low liquidity warning: Pool depth ($${Math.round(factors.liquidityUsd)}) is below $5,000.`);
    }

    // 4. Liquidity / FDV Ratio Score (Max 15 pts)
    let fdvRatioScore = 15;
    if (factors.fdvUsd && factors.fdvUsd > 0) {
      const ratio = factors.liquidityUsd / factors.fdvUsd;
      if (ratio < 0.03) {
        // Less than 3% pool backed by liquidity = high dump/dilution risk
        fdvRatioScore = 2;
        reasons.push(`Extreme FDV dilution risk: Liquidity/FDV ratio is ${(ratio * 100).toFixed(2)}% (<3%).`);
      } else if (ratio < 0.08) {
        fdvRatioScore = 8;
        reasons.push(`FDV dilution warning: Liquidity/FDV ratio is ${(ratio * 100).toFixed(1)}% (<8%).`);
      } else {
        fdvRatioScore = 15;
      }
    }

    // If critical simulation fails, total score is forced to 0
    let totalScore = simulationScore + taxScore + liquidityScore + fdvRatioScore;
    if (simulationScore === 0) {
      totalScore = 0;
    }

    const passed = totalScore >= this.minRequiredScore && simulationScore > 0;

    return {
      totalScore,
      passed,
      minRequiredScore: this.minRequiredScore,
      breakdown: {
        simulationScore,
        taxScore,
        liquidityScore,
        fdvRatioScore,
      },
      reasons,
    };
  }
}
