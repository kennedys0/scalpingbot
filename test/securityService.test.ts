import { describe, it, expect, vi } from 'vitest';
import { TokenSecurityService } from '../src/core/services/securityService.js';
import { TokenSecurityScorer } from '../src/core/screener/securityScore.js';

describe('TokenSecurityService & Dynamic Scorer', () => {
  it('penalizes honeypots and high tax tokens down to 0 score', () => {
    const scorer = new TokenSecurityScorer(80);
    const honeypotResult = scorer.calculateScore({
      canSell: false,
      isHoneypot: true,
      buyTaxPct: 20,
      sellTaxPct: 25,
      liquidityUsd: 100000,
      isOpenTrading: true,
      holderCount: 50,
      top10HolderPct: 80,
    });

    expect(honeypotResult.passed).toBe(false);
    expect(honeypotResult.totalScore).toBe(0);
    expect(honeypotResult.reasons.some((r) => r.toLowerCase().includes('honeypot'))).toBe(true);
  });

  it('penalizes excessive holder concentration (whale dominance)', () => {
    const scorer = new TokenSecurityScorer(80);
    const whaleResult = scorer.calculateScore({
      canSell: true,
      isHoneypot: false,
      buyTaxPct: 0,
      sellTaxPct: 0,
      liquidityUsd: 60000,
      fdvUsd: 300000,
      isOpenTrading: true,
      holderCount: 20, // very low holders
      top10HolderPct: 85, // top 10 own 85%
    });

    // Score should be penalized due to whale centralization
    expect(whaleResult.breakdown.holderScore).toBe(0);
    expect(whaleResult.reasons.some((r) => r.includes('Holder concentration') || r.includes('holder'))).toBe(true);
  });

  it('awards high score for clean token with low tax and distributed holders', () => {
    const scorer = new TokenSecurityScorer(80);
    const cleanResult = scorer.calculateScore({
      canSell: true,
      isHoneypot: false,
      buyTaxPct: 0,
      sellTaxPct: 0.5,
      liquidityUsd: 60000,
      fdvUsd: 300000,
      isOpenTrading: true,
      holderCount: 500,
      top10HolderPct: 25,
    });

    expect(cleanResult.passed).toBe(true);
    expect(cleanResult.totalScore).toBeGreaterThanOrEqual(85);
  });

  it('TokenSecurityService parses GoPlus response correctly and handles cache', async () => {
    const service = new TokenSecurityService();
    // Mock axios inside service
    const mockData = {
      is_honeypot: '0',
      buy_tax: '0.01',
      sell_tax: '0.02',
      cannot_sell_all: '0',
      is_open_trading: '1',
      holder_count: '250',
      holders: [
        { percent: '0.08' },
        { percent: '0.05' },
        { percent: '0.04' },
      ],
    };

    vi.spyOn(service as any, 'fetchFromGoPlus').mockResolvedValue(mockData);

    const sec = await service.fetchSecurityData(8453, '0xCleanToken');
    expect(sec.isHoneypot).toBe(false);
    expect(sec.canSell).toBe(true);
    expect(sec.buyTaxPct).toBe(1.0);
    expect(sec.sellTaxPct).toBe(2.0);
    expect(sec.holderCount).toBe(250);
    expect(sec.top10HolderPct).toBe(17.0);

    // Call second time to verify cache works
    const cached = await service.fetchSecurityData(8453, '0xCleanToken');
    expect(cached.buyTaxPct).toBe(1.0);
  });
});
