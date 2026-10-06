import { describe, it, expect, vi, afterEach } from 'vitest';
import { ExecutionEngine } from '../src/core/execution/engine.js';
import { PaperTrader } from '../src/core/execution/paperTrader.js';
import { PositionTracker } from '../src/core/positions/tracker.js';
import { JsonStorage } from '../src/storage/db.js';
import fs from 'fs';
import path from 'path';

describe('Robinhood Chain Safety Guard', () => {
  const dbPath = path.join(process.cwd(), 'test-data-rhguard.json');

  afterEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('diverts Robinhood chain live orders to paper simulation to prevent V4 router revert', async () => {
    const storage = new JsonStorage(dbPath);
    const tracker = new PositionTracker(storage);
    const paperTrader = new PaperTrader(1.0);
    const spySimulateBuy = vi.spyOn(paperTrader, 'simulateBuy');

    const mockRhRouter = {
      executeBuy: vi.fn(),
      executeSell: vi.fn(),
    };

    const engine = new ExecutionEngine({
      mode: 'live',
      paperTrader,
      tracker,
      rhRouter: mockRhRouter as any,
    });

    const result = await engine.executeBuy({
      chainId: 4663,
      tokenAddress: '0x1111111111111111111111111111111111111111',
      tokenSymbol: 'RHCOIN',
      amountEth: 0.01,
      currentPriceUsd: 0.5,
      takeProfitPct: 15,
      stopLossPct: 7,
    });

    expect(spySimulateBuy).toHaveBeenCalled();
    expect(mockRhRouter.executeBuy).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    const active = await tracker.getActivePositions();
    expect(active.length).toBe(1);
    expect(active[0].mode).toBe('paper');
  });
});
