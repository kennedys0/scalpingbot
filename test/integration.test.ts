import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScalpingOrchestrator } from '../src/core/orchestrator.js';
import { JsonStorage } from '../src/storage/db.js';

describe('End-to-End Scalping Orchestrator Loop', () => {
  let orchestrator: ScalpingOrchestrator;
  let storage: JsonStorage;

  beforeEach(() => {
    storage = new JsonStorage(':memory:');
    orchestrator = new ScalpingOrchestrator({
      storage,
      mode: 'paper',
      initialVirtualEth: 1.0,
      openRouterKeyBase: 'mock-base-key',
      openRouterKeyRobinhood: 'mock-rh-key',
      minAiConfidence: 75,
      defaultTradeSizeEth: 0.02,
      maxLossPerTradePct: 7.0,
      maxDailyLossEth: 0.10,
    });
  });

  it('completes a full automated cycle: scan -> screen -> AI evaluate -> enter trade -> TP exit', async () => {
    // 1. Mock DexScreener returning a trending token on Base
    vi.spyOn(orchestrator['scanner'], 'scanTrendingPairs').mockResolvedValue([
      {
        pairAddress: '0xpair_brett',
        baseToken: { address: '0xbrett', symbol: 'BRETT', name: 'Brett' },
        priceUsd: '0.10',
        priceChange: { m5: 5.0, h1: 15.0 },
        volume: { m5: 20000, h1: 100000 },
        txns: { m5: { buys: 50, sells: 15 } },
        liquidity: { usd: 50000 },
        fdv: 1000000,
      },
    ]);

    // 2. Mock AI evaluating a confident BUY
    vi.spyOn(orchestrator['aiBase'] as any, 'callLlmApi').mockResolvedValue(
      JSON.stringify({
        action: 'BUY',
        confidence: 88,
        takeProfitPct: 15.0,
        stopLossPct: 5.0,
        suggestedAllocEth: 0.02,
        timeframeMinutes: 15,
        riskRewardRatio: 3.0,
        reasoning: 'Massive buy pressure on Base.',
        signalsDetected: ['Buy Ratio 77%'],
      })
    );

    // Run one iteration of the scan cycle for Base
    const tradesOpened = await orchestrator.runScanCycle(8453);
    expect(tradesOpened).toBe(1);

    const activePositions = await orchestrator.getPositionTracker().getActivePositions();
    expect(activePositions.length).toBe(1);
    expect(activePositions[0].tokenSymbol).toBe('BRETT');
    expect(activePositions[0].takeProfitPct).toBe(15.0);

    // 3. Price jumps +16% -> Simulate Position Ticker check
    await orchestrator.getPositionTicker().checkPositionsWithPrices({
      '0xbrett': 0.116,
    });

    // Active position should be closed via TAKE_PROFIT
    const remainingPositions = await orchestrator.getPositionTracker().getActivePositions();
    expect(remainingPositions.length).toBe(0);

    const pnl = orchestrator.getCircuitBreaker().getDailyNetPnLEth();
    expect(pnl).toBeGreaterThan(0);
  });
});
