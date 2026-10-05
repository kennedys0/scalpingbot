import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DualAgentDebateEngine } from '../src/core/ai/debate.js';
import { SelfReflectiveMemory } from '../src/core/ai/memory.js';
import { MacroEthSentinel } from '../src/core/scanner/macroRegime.js';
import { SmartMoneyRadar } from '../src/core/screener/smartMoney.js';
import { JsonStorage } from '../src/storage/db.js';

describe('Superpower AI Modules', () => {
  let storage: JsonStorage;

  beforeEach(() => {
    storage = new JsonStorage(':memory:');
  });

  // 1. Dual-Agent Debate Test
  it('reaches consensus only when both Bullish Hunter and Bearish Auditor agree with high confidence', async () => {
    const mockHunter = {
      evaluateToken: vi.fn().mockResolvedValue({
        action: 'BUY',
        confidence: 85,
        takeProfitPct: 25,
        stopLossPct: 6,
        reasoning: 'Explosive breakout pattern.',
      }),
    };

    const mockAuditor = {
      evaluateToken: vi.fn().mockResolvedValue({
        action: 'BUY',
        confidence: 80,
        takeProfitPct: 20,
        stopLossPct: 7,
        reasoning: 'Checked contract, no honeypot, low holder concentration.',
      }),
    };

    const debateEngine = new DualAgentDebateEngine(mockHunter as any, mockAuditor as any, 78);
    const consensus = await debateEngine.debateToken({} as any);

    expect(consensus.action).toBe('BUY');
    expect(consensus.consensusScore).toBeGreaterThanOrEqual(80);
    expect(consensus.hunterReasoning).toContain('Explosive breakout');
    expect(consensus.auditorReasoning).toContain('Checked contract');
  });

  it('rejects trade when Bearish Auditor flags critical risks even if Hunter is bullish', async () => {
    const mockHunter = {
      evaluateToken: vi.fn().mockResolvedValue({
        action: 'BUY',
        confidence: 90,
      }),
    };

    const mockAuditor = {
      evaluateToken: vi.fn().mockResolvedValue({
        action: 'AVOID',
        confidence: 30,
        reasoning: 'Hidden sell tax or sudden dev wallet transfers detected.',
      }),
    };

    const debateEngine = new DualAgentDebateEngine(mockHunter as any, mockAuditor as any, 78);
    const consensus = await debateEngine.debateToken({} as any);

    expect(consensus.action).toBe('AVOID');
    expect(consensus.consensusScore).toBeLessThan(78);
  });

  // 2. Self-Reflective Memory Test
  it('stores trade post-mortems and injects relevant learned lessons into prompts', async () => {
    const memory = new SelfReflectiveMemory(storage);

    // Record a winning trade post-mortem
    await memory.recordPostMortem({
      tokenSymbol: 'ALPHA',
      outcome: 'WIN',
      pnlPct: 22.0,
      lessonLearned: 'Tokens with high initial 5m CVD and LP locked > 6 months sustain pumps.',
    });

    // Record a losing trade post-mortem
    await memory.recordPostMortem({
      tokenSymbol: 'BETA',
      outcome: 'LOSS',
      pnlPct: -8.0,
      lessonLearned: 'Avoid tokens where 1m volume delta diverges negatively on the second green candle.',
    });

    const lessons = memory.getRecentLessons(5);
    expect(lessons.length).toBe(2);
    expect(lessons.some((l) => l.includes('ALPHA'))).toBe(true);
    expect(lessons.some((l) => l.includes('BETA'))).toBe(true);

    const promptContext = memory.formatLessonsForPrompt();
    expect(promptContext).toContain('PAST LESSONS LEARNED');
    expect(promptContext).toContain('Avoid tokens where 1m volume delta diverges');
  });

  // 3. Macro ETH Sentinel Test
  it('detects macro market regime and flags Defensive Mode during ETH flash crashes', () => {
    const sentinel = new MacroEthSentinel();

    // Normal healthy market
    expect(sentinel.evaluateRegime(3200, 3215, 0.47)).toBe('BULLISH');

    // ETH flash crash (-2.5% in 5m)
    expect(sentinel.evaluateRegime(3200, 3120, -2.5)).toBe('DEFENSIVE_CRASH');
  });

  // 4. Smart Money Radar Test
  it('identifies smart money wallet activity and calculates confidence boost', () => {
    const radar = new SmartMoneyRadar();
    radar.addSmartWallet('0xwhale1', 'Top Base Scalper 84% Winrate');

    const hasWhaleInflow = radar.checkTransaction('0xwhale1', '0xtokenA', 3.5);
    expect(hasWhaleInflow.isSmartMoney).toBe(true);
    expect(hasWhaleInflow.label).toContain('Top Base Scalper');
    expect(hasWhaleInflow.suggestedConfidenceBoost).toBe(10);
  });
});
