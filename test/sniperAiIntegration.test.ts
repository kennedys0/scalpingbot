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
        buys5m: 5,
        sells5m: 1,
        volume5m: 500,
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
        buys5m: 10,
        sells5m: 2,
        volume5m: 2000,
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

  it('triggers EMERGENCY_DUMP_EXIT when negative volume delta spikes on a sniper position', async () => {
    const position = await orchestrator['tracker'].openPosition({
      id: 'pos_sniper_1',
      chainId: 8453,
      tokenAddress: '0xgem_token',
      tokenSymbol: 'GEM',
      entryPriceUsd: 0.05,
      amountTokens: 200,
      costEth: 0.01,
      takeProfitPct: 30,
      stopLossPct: 15,
      trailingStopPct: 5,
      mode: 'paper',
      status: 'OPEN',
      openedAt: Date.now(),
      isSniperPosition: true,
    });

    const exitSpy = vi.fn();
    (orchestrator['ticker'] as any).onExit = exitSpy;

    // Simulate severe sell delta dump via evaluateSniperSafety
    const didExit = await orchestrator['ticker'].evaluateSniperSafety(position, {
      currentPriceUsd: 0.048,
      buyPressureRatio5m: 0.15,
      volumeDelta5m: -50000,
      isEmergencyDump: true,
    });

    expect(didExit).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: position.id,
      }),
      'EMERGENCY_DUMP_EXIT',
      0.048
    );
  });

  it('rejects candidate when phantom liquidity trap is detected (real quote reserve < $1500)', async () => {
    vi.spyOn(orchestrator['newTokenScanner'], 'scanNewPools').mockResolvedValue([
      {
        chainId: 8453,
        poolAddress: '0xpool_trap',
        baseTokenAddress: '0xtrap_token',
        tokenSymbol: 'TRAP',
        tokenName: 'Trap Token',
        createdAtMs: Date.now() - 60000,
        ageMinutes: 1,
        priceUsd: 0.000025,
        liquidityUsd: 25000, // Fake reported liquidity
        realQuoteReserveUsd: 0.05, // Only 0.000019 ETH (<$1 real reserve)
        source: 'geckoterminal',
      },
    ]);

    const snipeSpy = vi.spyOn(orchestrator['sniper'], 'executeSnipe');
    const result = await orchestrator.evaluateAndSnipeNewPools(8453);

    expect(result.snipedCount).toBe(0);
    expect(snipeSpy).not.toHaveBeenCalled();
    expect(orchestrator['blacklist'].isBlacklisted('0xtrap_token')).toBe(true);
  });

  it('rejects candidate when pool is on unsupported Uniswap V4', async () => {
    vi.spyOn(orchestrator['newTokenScanner'], 'scanNewPools').mockResolvedValue([
      {
        chainId: 8453,
        poolAddress: '0xpool_v4',
        baseTokenAddress: '0xv4_token',
        tokenSymbol: 'V4TOK',
        tokenName: 'V4 Token',
        dexId: 'uniswap-v4-base',
        createdAtMs: Date.now() - 60000,
        ageMinutes: 1,
        priceUsd: 0.01,
        liquidityUsd: 50000,
        source: 'geckoterminal',
      },
    ]);

    const snipeSpy = vi.spyOn(orchestrator['sniper'], 'executeSnipe');
    const result = await orchestrator.evaluateAndSnipeNewPools(8453);

    expect(result.snipedCount).toBe(0);
    expect(snipeSpy).not.toHaveBeenCalled();
    expect(orchestrator['blacklist'].isBlacklisted('0xv4_token')).toBe(true);
  });
});
