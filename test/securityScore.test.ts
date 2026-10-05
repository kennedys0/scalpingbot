import { describe, it, expect } from 'vitest';
import { TokenSecurityScorer } from '../src/core/screener/securityScore.js';

describe('TokenSecurityScorer - Multi-Factor Security Evaluation (0-100)', () => {
  const scorer = new TokenSecurityScorer(80);

  it('awards high score (>=80) to clean tokens with healthy metrics', () => {
    const result = scorer.calculateScore({
      canSell: true,
      isHoneypot: false,
      buyTaxPct: 0,
      sellTaxPct: 0,
      liquidityUsd: 60000,
      fdvUsd: 300000, // 20% ratio
      isOpenTrading: true,
    });

    expect(result.passed).toBe(true);
    expect(result.totalScore).toBe(100);
    expect(result.breakdown.simulationScore).toBe(35);
    expect(result.breakdown.taxScore).toBe(25);
    expect(result.breakdown.liquidityScore).toBe(25);
    expect(result.breakdown.fdvRatioScore).toBe(15);
  });

  it('immediately returns 0 score if token is honeypot or cannot sell', () => {
    const result = scorer.calculateScore({
      canSell: false,
      isHoneypot: true,
      buyTaxPct: 0,
      sellTaxPct: 0,
      liquidityUsd: 100000,
      fdvUsd: 500000,
      isOpenTrading: true,
    });

    expect(result.passed).toBe(false);
    expect(result.totalScore).toBe(0);
    expect(result.reasons.some((r) => r.includes('CRITICAL'))).toBe(true);
  });

  it('penalizes high taxes and low liquidity', () => {
    const result = scorer.calculateScore({
      canSell: true,
      isHoneypot: false,
      buyTaxPct: 6.0,
      sellTaxPct: 7.0,
      liquidityUsd: 4000, // < $5k
      fdvUsd: 200000,     // 2% ratio (extreme dilution risk)
      isOpenTrading: true,
    });

    expect(result.passed).toBe(false);
    expect(result.totalScore).toBeLessThan(80);
    expect(result.reasons.some((r) => r.includes('Tax penalty') || r.includes('Moderate tax penalty'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('Low liquidity warning'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('dilution'))).toBe(true);
  });
});
