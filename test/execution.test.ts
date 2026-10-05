import { describe, it, expect, beforeEach } from 'vitest';
import { PaperTrader } from '../src/core/execution/paperTrader.js';
import { ExecutionEngine } from '../src/core/execution/engine.js';
import { PositionTracker } from '../src/core/positions/tracker.js';
import { JsonStorage } from '../src/storage/db.js';

describe('Execution Engine: Paper Trading & Viem DEX Swaps', () => {
  let paperTrader: PaperTrader;
  let tracker: PositionTracker;
  let engine: ExecutionEngine;

  beforeEach(() => {
    const storage = new JsonStorage(':memory:');
    tracker = new PositionTracker(storage);
    paperTrader = new PaperTrader(1.0); // Starting with 1.0 virtual ETH
    engine = new ExecutionEngine({
      mode: 'paper',
      paperTrader,
      tracker,
    });
  });

  it('simulates a buy order in paper trading with realistic fill and balance deduction', async () => {
    const buyResult = await engine.executeBuy({
      chainId: 8453,
      tokenAddress: '0xabc',
      tokenSymbol: 'PAPER',
      amountEth: 0.05,
      currentPriceUsd: 2.0,
      takeProfitPct: 15,
      stopLossPct: 6,
      slippagePct: 1.0,
    });

    expect(buyResult.success).toBe(true);
    expect(buyResult.positionId).toBeDefined();
    expect(paperTrader.getVirtualBalanceEth()).toBeLessThan(1.0);
    expect(buyResult.amountTokens).toBeGreaterThan(0);

    const positions = await tracker.getActivePositions();
    expect(positions.length).toBe(1);
    expect(positions[0].tokenSymbol).toBe('PAPER');
  });

  it('simulates a sell order in paper trading and credits PnL', async () => {
    const buyResult = await engine.executeBuy({
      chainId: 8453,
      tokenAddress: '0xabc',
      tokenSymbol: 'PAPER',
      amountEth: 0.05,
      currentPriceUsd: 2.0,
      takeProfitPct: 15,
      stopLossPct: 6,
      slippagePct: 1.0,
    });

    const active = await tracker.getActivePositions();
    const pos = active[0];

    // Sell at $2.30 (+15% gain)
    const sellResult = await engine.executeSell(pos, 2.30, 'TAKE_PROFIT');
    expect(sellResult.success).toBe(true);
    expect(sellResult.realizedPnlEth).toBeGreaterThan(0);

    const activeAfter = await tracker.getActivePositions();
    expect(activeAfter.length).toBe(0);
  });
});
