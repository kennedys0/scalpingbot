import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PositionTracker, Position } from '../src/core/positions/tracker.js';
import { PositionTicker } from '../src/core/positions/ticker.js';
import { JsonStorage } from '../src/storage/db.js';

describe('Position Tracker & Real-Time TP/SL Ticker', () => {
  let tracker: PositionTracker;
  let storage: JsonStorage;

  beforeEach(() => {
    storage = new JsonStorage(':memory:');
    tracker = new PositionTracker(storage);
  });

  it('opens and retrieves active positions', async () => {
    const pos = await tracker.openPosition({
      id: 'pos_1',
      chainId: 8453,
      tokenAddress: '0xabc',
      tokenSymbol: 'TEST',
      entryPriceUsd: 1.0,
      amountTokens: 1000,
      costEth: 0.02,
      takeProfitPct: 15.0,
      stopLossPct: 6.0,
      trailingStopPct: 3.0,
      mode: 'paper',
      status: 'OPEN',
      openedAt: Date.now(),
    });

    expect(pos.id).toBe('pos_1');
    const active = await tracker.getActivePositions();
    expect(active.length).toBe(1);
    expect(active[0].tokenSymbol).toBe('TEST');
  });

  it('triggers Take-Profit when current price exceeds TP target', async () => {
    await tracker.openPosition({
      id: 'pos_tp',
      chainId: 8453,
      tokenAddress: '0xabc',
      tokenSymbol: 'TP_COIN',
      entryPriceUsd: 1.0,
      amountTokens: 1000,
      costEth: 0.02,
      takeProfitPct: 15.0, // Target: $1.15
      stopLossPct: 6.0,   // Stop: $0.94
      mode: 'paper',
      status: 'OPEN',
      openedAt: Date.now(),
    });

    const onExit = vi.fn();
    const ticker = new PositionTicker(tracker, onExit);

    // Current price moves up to $1.16 (+16% > +15%)
    await ticker.checkPositionsWithPrices({ '0xabc': 1.16 });

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pos_tp',
      }),
      'TAKE_PROFIT',
      1.16
    );
  });

  it('triggers Stop-Loss when current price drops below SL target', async () => {
    await tracker.openPosition({
      id: 'pos_sl',
      chainId: 4663,
      tokenAddress: '0xxyz',
      tokenSymbol: 'SL_COIN',
      entryPriceUsd: 2.0,
      amountTokens: 500,
      costEth: 0.03,
      takeProfitPct: 20.0,
      stopLossPct: 5.0, // Stop: $1.90 (-5%)
      mode: 'paper',
      status: 'OPEN',
      openedAt: Date.now(),
    });

    const onExit = vi.fn();
    const ticker = new PositionTicker(tracker, onExit);

    // Current price drops to $1.88 (-6% < -5%)
    await ticker.checkPositionsWithPrices({ '0xxyz': 1.88 });

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pos_sl',
      }),
      'STOP_LOSS',
      1.88
    );
  });
});
