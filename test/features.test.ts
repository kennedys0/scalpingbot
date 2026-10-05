import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BlacklistManager } from '../src/core/screener/blacklist.js';
import { PositionTracker } from '../src/core/positions/tracker.js';
import { PositionTicker } from '../src/core/positions/ticker.js';
import { JsonStorage } from '../src/storage/db.js';
import { generatePerformanceReport } from '../src/bot/messages/formatters.js';
import { getChainConfig } from '../src/config/chains.js';

describe('New Features: Blacklist, Partial TP, MEV Protection & Report', () => {
  let storage: JsonStorage;
  let blacklist: BlacklistManager;

  beforeEach(() => {
    storage = new JsonStorage(':memory:');
    blacklist = new BlacklistManager(storage);
  });

  it('auto-blacklists rejected/bad tokens and prevents re-scanning', async () => {
    const badTokenCA = '0xbad1111111111111111111111111111111111111';
    expect(blacklist.isBlacklisted(badTokenCA)).toBe(false);

    // Auto-blacklist due to honeypot or AI AVOID
    await blacklist.addToBlacklist(badTokenCA, 'Low liquidity and AI rejected');
    expect(blacklist.isBlacklisted(badTokenCA)).toBe(true);

    // Whitelist removes from blacklist
    await blacklist.removeFromBlacklist(badTokenCA);
    expect(blacklist.isBlacklisted(badTokenCA)).toBe(false);
  });

  it('executes partial take-profit laddering at +15% and sets breakeven stop loss', async () => {
    const tracker = new PositionTracker(storage);
    await tracker.openPosition({
      id: 'pos_ladder',
      chainId: 8453,
      tokenAddress: '0xladder',
      tokenSymbol: 'LADDER',
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
    const onPartialTP = vi.fn();
    const ticker = new PositionTicker(tracker, onExit, onPartialTP);

    // Price reaches +15% -> triggers Partial TP (50% sell)
    await ticker.checkPositionsWithPrices({ '0xladder': 1.15 });

    expect(onPartialTP).toHaveBeenCalledTimes(1);
    expect(onPartialTP).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pos_ladder' }),
      1.15,
      50 // 50% partial exit
    );

    // Verify stop loss is moved to +1.0% (breakeven) and partial flag is set
    const updatedPos = await tracker.getPositionById('pos_ladder');
    expect(updatedPos?.partialTakeProfitDone).toBe(true);
    expect(updatedPos?.stopLossPct).toBe(-1.0); // Stop at +1% profit (Breakeven)

    // Price continues up to +30% -> triggers final TAKE_PROFIT exit for remaining 50%
    await ticker.checkPositionsWithPrices({ '0xladder': 1.30 });
    expect(onExit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pos_ladder' }),
      'TAKE_PROFIT',
      1.30
    );
  });

  it('generates a comprehensive daily performance report', () => {
    const trades = [
      { id: '1', tokenSymbol: 'BRETT', realizedPnlEth: 0.005, realizedPnlPct: 25.0, status: 'CLOSED' },
      { id: '2', tokenSymbol: 'DEGEN', realizedPnlEth: 0.003, realizedPnlPct: 15.0, status: 'CLOSED' },
      { id: '3', tokenSymbol: 'RUG', realizedPnlEth: -0.002, realizedPnlPct: -10.0, status: 'CLOSED' },
    ];

    const report = generatePerformanceReport(trades);
    expect(report).toContain('DAILY PERFORMANCE REPORT');
    expect(report).toContain('66.7%');
    expect(report).toContain('+0.0060 ETH');
    expect(report).toContain('BRETT');
  });

  it('includes MEV-protected RPC endpoint in Base chain config', () => {
    const baseConfig = getChainConfig(8453);
    expect(baseConfig.rpcUrls.mevProtected).toBeDefined();
    expect(baseConfig.rpcUrls.mevProtected).toContain('mevblocker');
  });
});
