import { describe, it, expect, vi, afterEach } from 'vitest';
import { BaseRouterExecutor } from '../src/core/execution/routers/baseRouter.js';
import { ExecutionEngine } from '../src/core/execution/engine.js';
import { PaperTrader } from '../src/core/execution/paperTrader.js';
import { PositionTracker } from '../src/core/positions/tracker.js';
import { JsonStorage } from '../src/storage/db.js';
import fs from 'fs';
import path from 'path';

describe('Anti-Phantom Receipt Confirmation', () => {
  const dbPath = path.join(process.cwd(), 'test-data-receipt.json');

  afterEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('rejects buy order and does not open position when receipt status is reverted', async () => {
    const mockPublicClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'reverted' }),
      readContract: vi.fn().mockResolvedValue(0n),
    };
    const mockWalletClient = {
      account: { address: '0x1234567890123456789012345678901234567890' },
      sendTransaction: vi.fn().mockResolvedValue('0xrevertedtxhash'),
    };
    const mockViemManager = {
      getPublicClient: vi.fn().mockReturnValue(mockPublicClient),
      getWalletClient: vi.fn().mockReturnValue(mockWalletClient),
    } as any;

    const baseRouter = new BaseRouterExecutor(mockViemManager);
    const storage = new JsonStorage(dbPath);
    const tracker = new PositionTracker(storage);
    const paperTrader = new PaperTrader(1.0);
    const engine = new ExecutionEngine({
      mode: 'live',
      paperTrader,
      tracker,
      baseRouter,
    });

    const buyResult = await engine.executeBuy({
      chainId: 8453,
      tokenAddress: '0x1111111111111111111111111111111111111111',
      tokenSymbol: 'REVERT',
      amountEth: 0.01,
      currentPriceUsd: 1.0,
      takeProfitPct: 10,
      stopLossPct: 5,
    });

    expect(buyResult.success).toBe(false);
    expect(buyResult.error).toContain('reverted');
    const positions = await tracker.getActivePositions();
    expect(positions.length).toBe(0);
  });

  it('verifies on-chain tokens received via balanceOf upon successful buy', async () => {
    const mockPublicClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
      readContract: vi.fn().mockImplementation(({ functionName }) => {
        if (functionName === 'decimals') return Promise.resolve(18);
        if (functionName === 'balanceOf') return Promise.resolve(95000000000000000000n); // 95 tokens post 5% tax
        return Promise.resolve(0n);
      }),
    };
    const mockWalletClient = {
      account: { address: '0x1234567890123456789012345678901234567890' },
      sendTransaction: vi.fn().mockResolvedValue('0xsuccesstxhash'),
    };
    const mockViemManager = {
      getPublicClient: vi.fn().mockReturnValue(mockPublicClient),
      getWalletClient: vi.fn().mockReturnValue(mockWalletClient),
    } as any;

    const baseRouter = new BaseRouterExecutor(mockViemManager);
    const storage = new JsonStorage(dbPath);
    const tracker = new PositionTracker(storage);
    const paperTrader = new PaperTrader(1.0);
    const engine = new ExecutionEngine({
      mode: 'live',
      paperTrader,
      tracker,
      baseRouter,
    });

    const buyResult = await engine.executeBuy({
      chainId: 8453,
      tokenAddress: '0x2222222222222222222222222222222222222222',
      tokenSymbol: 'TAXED',
      amountEth: 0.01,
      currentPriceUsd: 1.0,
      takeProfitPct: 10,
      stopLossPct: 5,
    });

    expect(buyResult.success).toBe(true);
    expect(buyResult.amountTokens).toBe(95); // accurately reflects post-tax on-chain balance!
    const positions = await tracker.getActivePositions();
    expect(positions.length).toBe(1);
    expect(positions[0].amountTokens).toBe(95);
  });
});
