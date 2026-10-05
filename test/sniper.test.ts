import { describe, it, expect, vi } from 'vitest';
import { InstantSniper } from '../src/core/sniper/instantSnipe.js';
import { ExecutionEngine } from '../src/core/execution/engine.js';
import { PaperTrader } from '../src/core/execution/paperTrader.js';
import { PositionTracker } from '../src/core/positions/tracker.js';
import { JsonStorage } from '../src/storage/db.js';

describe('Sniper Engine (Instant Manual Snipe & Event Listener)', () => {
  let sniper: InstantSniper;
  let engine: ExecutionEngine;

  beforeEach(() => {
    const storage = new JsonStorage(':memory:');
    const tracker = new PositionTracker(storage);
    const paperTrader = new PaperTrader(1.0);
    engine = new ExecutionEngine({
      mode: 'paper',
      paperTrader,
      tracker,
    });
    sniper = new InstantSniper(engine, {
      defaultSnipeEth: 0.03,
      sniperSlippagePct: 15.0,
    });
  });

  it('validates and executes an instant manual snipe on contract address', async () => {
    const result = await sniper.executeSnipe({
      chainId: 8453,
      tokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
      tokenSymbol: 'SNIPED',
      currentPriceUsd: 0.05,
      amountEth: 0.03,
    });

    expect(result.success).toBe(true);
    expect(result.positionId).toBeDefined();
  });

  it('rejects snipe when token address is invalid', async () => {
    const result = await sniper.executeSnipe({
      chainId: 8453,
      tokenAddress: 'invalid-address',
      tokenSymbol: 'BAD',
      currentPriceUsd: 0.05,
      amountEth: 0.03,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid EVM contract address');
  });
});
