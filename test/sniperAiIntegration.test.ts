import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScalpingOrchestrator } from '../src/core/orchestrator.js';
import { JsonStorage } from '../src/storage/db.js';

describe('New Token Auto-Sniper with AI Pre-Veto Gate', () => {
  let orchestrator: any;
  let mockStorage: any;

  beforeEach(() => {
    mockStorage = new JsonStorage(`test/scratch/test_db_sniper_${Date.now()}_${Math.random()}.json`);
    orchestrator = new ScalpingOrchestrator({
      storage: mockStorage,
      mode: 'paper',
      minSecurityScore: 80,
    });
  });

  it('vetoes auto-snipe when AI Auditor returns AVOID', async () => {
    vi.spyOn(orchestrator['newTokenScanner'], 'scanNewPools').mockResolvedValue([
      {
        chainId: 8453,
        poolAddress: '0xpool_scam',
        baseTokenAddress: '0xscam_token',
        tokenSymbol: 'SCAM',
        tokenName: 'Scam Coin',
        createdAtMs: Date.now() - 60000,
        ageMinutes: 1,
        priceUsd: 0.01,
        liquidityUsd: 10000,
        source: 'geckoterminal',
      },
    ]);

    vi.spyOn(orchestrator['securityScorer'], 'calculateScore').mockReturnValue({
      totalScore: 85,
      passed: true,
      minRequiredScore: 80,
      reasons: [],
      breakdown: {} as any,
    });

    vi.spyOn(orchestrator['aiBase'], 'evaluateToken').mockResolvedValue({
      action: 'AVOID',
      confidence: 90,
      takeProfitPct: 0,
      stopLossPct: 0,
      suggestedAllocEth: 0,
      timeframeMinutes: 0,
      riskRewardRatio: 0,
      reasoning: 'Suspicious distribution pattern, likely rug pull.',
      signalsDetected: ['High Dump Risk'],
    });

    const snipeSpy = vi.spyOn(orchestrator['sniper'], 'executeSnipe');

    const result = await orchestrator.evaluateAndSnipeNewPools(8453);

    expect(result.snipedCount).toBe(0);
    expect(result.vetoedCount).toBe(1);
    expect(snipeSpy).not.toHaveBeenCalled();
  });

  it('executes auto-snipe when security score passes and AI Auditor approves', async () => {
    vi.spyOn(orchestrator['newTokenScanner'], 'scanNewPools').mockResolvedValue([
      {
        chainId: 8453,
        poolAddress: '0xpool_gem',
        baseTokenAddress: '0xgem_token',
        tokenSymbol: 'GEM',
        tokenName: 'Gem Coin',
        createdAtMs: Date.now() - 120000,
        ageMinutes: 2,
        priceUsd: 0.05,
        liquidityUsd: 25000,
        source: 'geckoterminal',
      },
    ]);

    vi.spyOn(orchestrator['securityScorer'], 'calculateScore').mockReturnValue({
      totalScore: 92,
      passed: true,
      minRequiredScore: 80,
      reasons: [],
      breakdown: {} as any,
    });

    vi.spyOn(orchestrator['aiBase'], 'evaluateToken').mockResolvedValue({
      action: 'BUY',
      confidence: 85,
      takeProfitPct: 30,
      stopLossPct: 8,
      suggestedAllocEth: 0.01,
      timeframeMinutes: 15,
      riskRewardRatio: 3.75,
      reasoning: 'Clean tokenomics, locked liquidity, high organic interest.',
      signalsDetected: ['Clean Contract'],
    });

    const snipeSpy = vi.spyOn(orchestrator['sniper'], 'executeSnipe').mockResolvedValue({
      success: true,
      txHash: '0xmock_hash',
      tokenAddress: '0xgem_token',
      tokenSymbol: 'GEM',
      entryPriceUsd: 0.05,
      amountEth: 0.01,
      tokensReceived: 200,
    });

    const result = await orchestrator.evaluateAndSnipeNewPools(8453);

    expect(result.snipedCount).toBe(1);
    expect(snipeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenAddress: '0xgem_token',
        amountEth: 0.01,
      })
    );
  });
});
