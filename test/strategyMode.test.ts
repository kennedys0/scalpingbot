import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScalpingOrchestrator } from '../src/core/orchestrator.js';
import { JsonStorage } from '../src/storage/db.js';
import { generatePerformanceReport } from '../src/bot/messages/formatters.js';

describe('Strategy Modes & Calibration Testing', () => {
  let storage: JsonStorage;
  let orchestrator: ScalpingOrchestrator;

  beforeEach(() => {
    storage = new JsonStorage(':memory:');
    orchestrator = new ScalpingOrchestrator({
      storage,
      mode: 'paper',
      strategyMode: 'rules_only',
      openRouterKeyBase: 'test-key',
      openRouterKeyRobinhood: 'test-key',
      defaultTradeSizeEth: 0.02,
    });
  });

  // 1. Rules-Only Mode Test (Zero LLM, Fast Execution)
  it('executes buy in rules_only mode without calling LLM when CVD and buy pressure are strong', async () => {
    // Spy on LLM call to ensure it is NOT called
    const llmSpy = vi.spyOn(orchestrator['aiBase'] as any, 'callLlmApi');

    vi.spyOn(orchestrator['scanner'], 'scanTrendingPairs').mockResolvedValue([
      {
        pairAddress: '0xpair_quant',
        baseToken: { address: '0xquant', symbol: 'QUANT', name: 'Quant Token' },
        priceUsd: '1.0',
        priceChange: { m5: 4.0, h1: 10.0 },
        volume: { m5: 15000, h1: 50000 },
        txns: { m5: { buys: 40, sells: 10 } }, // 80% buy ratio
        liquidity: { usd: 20000 },
        fdv: 500000,
      },
    ]);

    const tradesOpened = await orchestrator.runScanCycle(8453);
    expect(tradesOpened).toBe(1);
    expect(llmSpy).not.toHaveBeenCalled();

    const active = await orchestrator.getPositionTracker().getActivePositions();
    expect(active.length).toBe(1);
    expect(active[0].strategyMode).toBe('rules_only');
  });

  // 2. AI Veto Mode Test: Veto on high risk
  it('vetoes trade in ai_veto mode when Auditor flags AVOID', async () => {
    orchestrator.setStrategyMode('ai_veto');

    vi.spyOn(orchestrator['scanner'], 'scanTrendingPairs').mockResolvedValue([
      {
        pairAddress: '0xpair_scam',
        baseToken: { address: '0xscam', symbol: 'SCAM', name: 'Scam Token' },
        priceUsd: '0.50',
        priceChange: { m5: 3.0, h1: 8.0 },
        volume: { m5: 10000, h1: 30000 },
        txns: { m5: { buys: 35, sells: 15 } },
        liquidity: { usd: 15000 },
        fdv: 300000,
      },
    ]);

    // Auditor evaluates as AVOID (red flag detected)
    vi.spyOn(orchestrator['aiBase'], 'evaluateToken').mockResolvedValue({
      action: 'AVOID',
      confidence: 30,
      takeProfitPct: 0,
      stopLossPct: 0,
      suggestedAllocEth: 0,
      timeframeMinutes: 0,
      riskRewardRatio: 0,
      reasoning: 'Dev wallet dumping tokens via multi-sig.',
      signalsDetected: ['High dev sell pressure'],
    });

    const tradesOpened = await orchestrator.runScanCycle(8453);
    expect(tradesOpened).toBe(0);

    // Verify token was blacklisted due to veto
    expect(orchestrator.getBlacklistManager().isBlacklisted('0xscam')).toBe(true);
  });

  // 3. AI Score Calibration Breakdown in Performance Report
  it('correctly calculates AI calibration breakdown across confidence score tiers in /report', () => {
    const mockTrades = [
      // High score tier (>=85%): 2 Wins, 0 Losses -> 100% Win Rate
      { tokenSymbol: 'PEPE', realizedPnlEth: 0.005, realizedPnlPct: 25.0, status: 'CLOSED', aiScore: 90 },
      { tokenSymbol: 'DOGE', realizedPnlEth: 0.003, realizedPnlPct: 15.0, status: 'CLOSED', aiScore: 88 },
      // Moderate score tier (75-84%): 1 Win, 1 Loss -> 50% Win Rate
      { tokenSymbol: 'BRETT', realizedPnlEth: 0.002, realizedPnlPct: 10.0, status: 'CLOSED', aiScore: 78 },
      { tokenSymbol: 'MOG', realizedPnlEth: -0.002, realizedPnlPct: -6.0, status: 'CLOSED', aiScore: 80 },
      // Rules-only tier: 1 Win, 0 Loss -> 100% Win Rate
      { tokenSymbol: 'DEGEN', realizedPnlEth: 0.004, realizedPnlPct: 20.0, status: 'CLOSED', strategyMode: 'rules_only' },
    ];

    const report = generatePerformanceReport(mockTrades);
    expect(report).toContain('AI Calibration (Score vs Win Rate)');
    expect(report).toContain('High Score (≥85%): <code>100% (2/2)</code>');
    expect(report).toContain('Moderate (75-84%): <code>50% (1/2)</code>');
    expect(report).toContain('Rules-Only: <code>100% (1/1)</code>');
  });
});
