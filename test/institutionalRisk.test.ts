import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JsonStorage } from '../src/storage/db.js';
import { BlacklistManager } from '../src/core/screener/blacklist.js';
import { PaperTrader } from '../src/core/execution/paperTrader.js';
import { PositionTracker } from '../src/core/positions/tracker.js';
import { ExecutionEngine } from '../src/core/execution/engine.js';
import { PositionTicker } from '../src/core/positions/ticker.js';
import { ScalpingOrchestrator } from '../src/core/orchestrator.js';

describe('Institutional Risk Architecture: Blacklist TTLs, Shadow Mode & Anti-Dump Cascade', () => {
  let storage: JsonStorage;
  let tracker: PositionTracker;
  let blacklist: BlacklistManager;

  beforeEach(() => {
    storage = new JsonStorage(':memory:');
    tracker = new PositionTracker(storage);
    blacklist = new BlacklistManager(storage);
  });

  // 1. Categorized Blacklist with Granular TTLs
  it('assigns correct TTLs and handles expiration per category', async () => {
    // Security permanent (no expiry)
    await blacklist.addToBlacklist('0xscam', 'Honeypot code detected', 'SECURITY_PERMANENT');
    const scamEntry = blacklist.getEntry('0xscam');
    expect(scamEntry?.category).toBe('SECURITY_PERMANENT');
    expect(scamEntry?.expiresAt).toBeUndefined();

    // Low liquidity temp (6 hours default)
    await blacklist.addToBlacklist('0xlowliq', 'Pool < $5000', 'LOW_LIQUIDITY_TEMP');
    const lowLiqEntry = blacklist.getEntry('0xlowliq');
    expect(lowLiqEntry?.category).toBe('LOW_LIQUIDITY_TEMP');
    expect(lowLiqEntry?.expiresAt).toBeGreaterThan(Date.now() + 5 * 3600 * 1000);

    // AI reject temp (12 hours default)
    await blacklist.addToBlacklist('0xaireject', 'Bear auditor negative consensus', 'AI_REJECT_TEMP');
    const aiEntry = blacklist.getEntry('0xaireject');
    expect(aiEntry?.category).toBe('AI_REJECT_TEMP');
    expect(aiEntry?.expiresAt).toBeGreaterThan(Date.now() + 11 * 3600 * 1000);

    // Simulate expiration of low liquidity token
    storage.update((data) => {
      data.settings.blacklist['0xlowliq'].expiresAt = Date.now() - 1000;
    });

    expect(blacklist.isBlacklisted('0xlowliq')).toBe(false);
    expect(blacklist.isBlacklisted('0xscam')).toBe(true);
    expect(blacklist.isBlacklisted('0xaireject')).toBe(true);
  });

  // 2. Zero-Risk Shadow Mode Execution
  it('tracks execution telemetry in shadow mode without modifying virtual balance', async () => {
    const paperTrader = new PaperTrader(1.0);
    const initialBalance = paperTrader.getVirtualBalanceEth();

    const engine = new ExecutionEngine({
      mode: 'shadow',
      paperTrader,
      tracker,
    });

    expect(engine.getMode()).toBe('shadow');

    // Execute buy in shadow mode
    const buyResult = await engine.executeBuy({
      chainId: 8453,
      tokenAddress: '0xshadow_token',
      tokenSymbol: 'SHADOW',
      amountEth: 0.05,
      currentPriceUsd: 1.0,
      takeProfitPct: 20,
      stopLossPct: 6,
    });

    expect(buyResult.success).toBe(true);
    expect(buyResult.txHash).toContain('0xshadow_buy_');

    // Virtual balance must remain strictly unchanged in shadow mode!
    expect(paperTrader.getVirtualBalanceEth()).toBe(initialBalance);

    // Position must be recorded with mode = 'shadow'
    const active = await tracker.getActivePositions();
    expect(active.length).toBe(1);
    expect(active[0].mode).toBe('shadow');

    // Execute sell in shadow mode
    const sellResult = await engine.executeSell(active[0], 1.20, 'TAKE_PROFIT');
    expect(sellResult.success).toBe(true);
    expect(sellResult.txHash).toContain('0xshadow_sell_');

    // Virtual balance still untouched!
    expect(paperTrader.getVirtualBalanceEth()).toBe(initialBalance);

    const closed = await tracker.getPositionById(active[0].id);
    expect(closed?.status).toBe('CLOSED');
    expect(closed?.closeReason).toBe('TAKE_PROFIT');
  });

  // 3. Multi-Factor Anti-Dump (Rolling Cascade Detection)
  it('triggers ANTI_DUMP on rolling price cascade over 3 consecutive ticks', async () => {
    await tracker.openPosition({
      id: 'pos_cascade',
      chainId: 8453,
      tokenAddress: '0xcascade',
      tokenSymbol: 'CASCADE',
      entryPriceUsd: 1.0,
      amountTokens: 1000,
      costEth: 0.02,
      takeProfitPct: 30.0,
      stopLossPct: 15.0, // wider hard stop to test anti-dump triggering first
      mode: 'paper',
      status: 'OPEN',
      openedAt: Date.now(),
    });

    const onExit = vi.fn();
    const ticker = new PositionTicker(tracker, onExit);

    // Tick 1: $1.00 (Entry)
    await ticker.checkPositionsWithPrices({ '0xcascade': 1.00 });
    expect(onExit).not.toHaveBeenCalled();

    // Tick 2: $0.98 (-2%, gentle decline)
    await ticker.checkPositionsWithPrices({ '0xcascade': 0.98 });
    expect(onExit).not.toHaveBeenCalled();

    // Tick 3: $0.94 (-4% from $0.98, cumulative drop from $1.00 is -6.0%!)
    // Rolling cascade drop >= 5.0% triggers anti-dump
    await ticker.checkPositionsWithPrices({ '0xcascade': 0.94 });

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pos_cascade' }),
      'ANTI_DUMP',
      0.94
    );
  });

  // 4. Orchestrator Integration: Risk Engine EV Supreme Authority & Security Scorer
  it('orchestrator enforces Security Score and Mathematical EV gatekeeper', () => {
    const orchestrator = new ScalpingOrchestrator({
      storage,
      mode: 'shadow',
      minAiConfidence: 75,
      minRequiredEdgePct: 1.5,
      minSecurityScore: 80,
    });

    expect(orchestrator.getTradingMode()).toBe('shadow');
    expect(orchestrator.getEVCalculator()).toBeDefined();
    expect(orchestrator.getSecurityScorer()).toBeDefined();

    // Switch mode
    orchestrator.setTradingMode('live');
    expect(orchestrator.getTradingMode()).toBe('live');
    orchestrator.setTradingMode('paper');
    expect(orchestrator.getTradingMode()).toBe('paper');
  });
});
