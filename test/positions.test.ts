import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PositionTracker, Position } from '../src/core/positions/tracker.js';
import { PositionTicker } from '../src/core/positions/ticker.js';
import { JsonStorage } from '../src/storage/db.js';
import { formatActivePositionsCard, getDexScreenerUrl } from '../src/bot/messages/formatters.js';

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

  it('triggers Trailing Stop when profit reached +8% and then pulls back by trailing threshold', async () => {
    await tracker.openPosition({
      id: 'pos_trail',
      chainId: 8453,
      tokenAddress: '0xtrail',
      tokenSymbol: 'TRAIL_COIN',
      entryPriceUsd: 1.0,
      amountTokens: 1000,
      costEth: 0.02,
      takeProfitPct: 30.0,
      stopLossPct: 10.0,
      trailingStopPct: 3.0,
      mode: 'paper',
      status: 'OPEN',
      openedAt: Date.now(),
    });

    const onExit = vi.fn();
    const ticker = new PositionTicker(tracker, onExit);

    // 1. Price runs up to $1.15 (+15% profit, above 8% threshold)
    await ticker.checkPositionsWithPrices({ '0xtrail': 1.15 });
    expect(onExit).not.toHaveBeenCalled();

    // 2. Price retraces from peak of $1.15 to $1.11 (drop of ~3.47% > 3% trailing limit)
    await ticker.checkPositionsWithPrices({ '0xtrail': 1.11 });
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pos_trail' }),
      'TRAILING_STOP',
      1.11
    );
  });

  it('triggers emergency Anti-Dump exit when flash dump drop >= 5% occurs abruptly', async () => {
    await tracker.openPosition({
      id: 'pos_dump',
      chainId: 8453,
      tokenAddress: '0xdump',
      tokenSymbol: 'DUMP_COIN',
      entryPriceUsd: 1.0,
      amountTokens: 1000,
      costEth: 0.02,
      takeProfitPct: 30.0,
      stopLossPct: 10.0,
      mode: 'paper',
      status: 'OPEN',
      openedAt: Date.now(),
    });

    const onExit = vi.fn();
    const ticker = new PositionTicker(tracker, onExit);

    // Initial price check at entry
    await ticker.checkPositionsWithPrices({ '0xdump': 1.0 });

    // Sudden flash dump in next tick: price plunges to $0.94 (-6% flash dump in single tick)
    await ticker.checkPositionsWithPrices({ '0xdump': 0.94 });
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pos_dump' }),
      'ANTI_DUMP',
      0.94
    );
  });

  it('prevents opening duplicate positions for the same token address', async () => {
    await tracker.openPosition({
      id: 'pos_dup_1',
      chainId: 8453,
      tokenAddress: '0xduplicate_token',
      tokenSymbol: 'DUP',
      entryPriceUsd: 1.0,
      amountTokens: 100,
      costEth: 0.01,
      takeProfitPct: 20,
      stopLossPct: 6,
      mode: 'paper',
      status: 'OPEN',
      openedAt: Date.now(),
    });

    // Opening another position with the same address (case-insensitive) should be ignored
    await tracker.openPosition({
      id: 'pos_dup_2',
      chainId: 8453,
      tokenAddress: '0xDUPLICATE_TOKEN',
      tokenSymbol: 'DUP',
      entryPriceUsd: 1.05,
      amountTokens: 100,
      costEth: 0.01,
      takeProfitPct: 20,
      stopLossPct: 6,
      mode: 'paper',
      status: 'OPEN',
      openedAt: Date.now(),
    });

    const active = await tracker.getActivePositions();
    expect(active.length).toBe(1);
    expect(await tracker.hasOpenPositionForToken('0xduplicate_token')).toBe(true);
    expect(await tracker.hasOpenPositionForToken('0xother_token')).toBe(false);
  });

  it('formats active positions card with real-time live prices and floating PnL', () => {
    const card = formatActivePositionsCard(
      [
        {
          id: 'pos_card_1',
          chainId: 8453,
          tokenAddress: '0x123',
          tokenSymbol: 'WINNER',
          mode: 'paper',
          entryPriceUsd: 1.0,
          currentPriceUsd: 1.15, // +15% profit live
          costEth: 0.02,
          takeProfitPct: 25,
          stopLossPct: 8,
          highestPriceSeen: 1.15,
          openedAt: Date.now() - 300000,
        },
      ],
      3
    );

    expect(card).toContain('ACTIVE POSITIONS (1/3)');
    expect(card).toContain('WINNER');
    expect(card).toContain('+15.00%');
    expect(card).toContain('Harga Real-Time');
    expect(card).toContain('Slot tersedia: 2 posisi lagi');
    expect(card).toContain('https://dexscreener.com/base/0x123');
    expect(card).toContain('📈 Buka Chart DexScreener');
  });

  it('generates correct DexScreener URL for different networks', () => {
    expect(getDexScreenerUrl(8453, '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed')).toBe(
      'https://dexscreener.com/base/0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed'
    );
    expect(getDexScreenerUrl(4663, '0xCustomToken')).toBe(
      'https://dexscreener.com/search?q=0xCustomToken'
    );
  });

  it('indicates limit reached when active positions hit max concurrent limit', () => {
    const card = formatActivePositionsCard(
      [
        { id: '1', chainId: 8453, tokenAddress: '0x1', tokenSymbol: 'T1', mode: 'paper', entryPriceUsd: 1, currentPriceUsd: 1, costEth: 0.01, takeProfitPct: 20, stopLossPct: 6, openedAt: Date.now() },
        { id: '2', chainId: 8453, tokenAddress: '0x2', tokenSymbol: 'T2', mode: 'paper', entryPriceUsd: 1, currentPriceUsd: 1, costEth: 0.01, takeProfitPct: 20, stopLossPct: 6, openedAt: Date.now() },
        { id: '3', chainId: 8453, tokenAddress: '0x3', tokenSymbol: 'T3', mode: 'paper', entryPriceUsd: 1, currentPriceUsd: 1, costEth: 0.01, takeProfitPct: 20, stopLossPct: 6, openedAt: Date.now() },
      ],
      3
    );

    expect(card).toContain('ACTIVE POSITIONS (3/3)');
    expect(card).toContain('BATAS MAKSIMAL TERCAPAI (3/3)');
  });
});
