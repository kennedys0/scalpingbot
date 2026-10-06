import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PositionTracker } from '../src/core/positions/tracker.js';
import { JsonStorage } from '../src/storage/db.js';
import fs from 'fs';
import path from 'path';

describe('Token Deduplication & Copycat Shield', () => {
  const testDbPath = path.join(process.cwd(), 'test-data-dedup.json');
  let storage: JsonStorage;
  let tracker: PositionTracker;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    storage = new JsonStorage(testDbPath);
    tracker = new PositionTracker(storage);
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('detects existing open position by normalized symbol', async () => {
    await tracker.openPosition({
      id: 'pos_1',
      chainId: 8453,
      tokenAddress: '0x1111111111111111111111111111111111111111',
      tokenSymbol: 'OPENHUMAN',
      entryPriceUsd: 1.0,
      amountTokens: 100,
      costEth: 0.01,
      takeProfitPct: 10,
      stopLossPct: 5,
      mode: 'paper',
      status: 'OPEN',
      openedAt: Date.now(),
    });

    // Check same symbol lowercase
    const hasOpenLower = await tracker.hasOpenPositionForSymbol('openhuman');
    expect(hasOpenLower).toBe(true);

    // Check same symbol with punctuation
    const hasOpenPunct = await tracker.hasOpenPositionForSymbol('$OPENHUMAN');
    expect(hasOpenPunct).toBe(true);

    // Check unrelated symbol
    const hasOther = await tracker.hasOpenPositionForSymbol('OTHER');
    expect(hasOther).toBe(false);
  });
});
