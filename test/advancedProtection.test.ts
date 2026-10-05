import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OnChainHoneypotSimulator } from '../src/core/screener/honeypotSimulator.js';
import { reconcilePositionsOnChain } from '../src/core/positions/reconciliation.js';
import { PositionTracker } from '../src/core/positions/tracker.js';
import { PositionTicker } from '../src/core/positions/ticker.js';
import { BlacklistManager } from '../src/core/screener/blacklist.js';
import { JsonStorage } from '../src/storage/db.js';

describe('Advanced Protection: Honeypot Simulation, State Reconciliation, TTL & Stale Trade', () => {
  let storage: JsonStorage;
  let tracker: PositionTracker;
  let blacklist: BlacklistManager;

  beforeEach(() => {
    storage = new JsonStorage(':memory:');
    tracker = new PositionTracker(storage);
    blacklist = new BlacklistManager(storage);
  });

  // 1. On-Chain Honeypot Simulation Test
  it('detects honeypot when on-chain sell simulation reverts or returns zero', async () => {
    const mockPublicClient = {
      readContract: vi.fn().mockImplementation(async ({ functionName, args }: any) => {
        if (functionName === 'totalSupply') return 1000000000n;
        if (functionName === 'decimals') return 18;
        if (functionName === 'WETH') return '0x4200000000000000000000000000000000000006';
        if (functionName === 'getAmountsOut') {
          // If simulating buy: returns tokens
          if (args[1][0] === '0x4200000000000000000000000000000000000006') {
            return [1000n, 500000n];
          }
          // If simulating sell: throws error (transfer blocked, honeypot!)
          throw new Error('TRANSFER_FAILED: TransferHelper: TRANSFER_FAILED');
        }
        return null;
      }),
    };

    const simulator = new OnChainHoneypotSimulator(mockPublicClient as any);
    const result = await simulator.simulateToken('0xhoneypot' as any);

    expect(result.isHoneypot).toBe(true);
    expect(result.canSell).toBe(false);
    expect(result.reason).toContain('TRANSFER_FAILED');
  });

  it('passes on-chain simulation when both buy and sell quotes succeed', async () => {
    const mockPublicClient = {
      readContract: vi.fn().mockImplementation(async ({ functionName, args }: any) => {
        if (functionName === 'totalSupply') return 1000000000n;
        if (functionName === 'decimals') return 18;
        if (functionName === 'WETH') return '0x4200000000000000000000000000000000000006';
        if (functionName === 'getAmountsOut') {
          return [1000n, 500000n];
        }
        return null;
      }),
    };

    const simulator = new OnChainHoneypotSimulator(mockPublicClient as any);
    const result = await simulator.simulateToken('0xlegit' as any);

    expect(result.isHoneypot).toBe(false);
    expect(result.canSell).toBe(true);
    expect(result.sellTaxPct).toBe(0);
  });

  // 2. On-Chain Position Reconciliation Test
  it('reconciles on-chain positions and closes ghost positions if wallet balance is 0', async () => {
    await tracker.openPosition({
      id: 'pos_ghost',
      chainId: 8453,
      tokenAddress: '0xghost',
      tokenSymbol: 'GHOST',
      entryPriceUsd: 1.0,
      amountTokens: 100,
      costEth: 0.02,
      takeProfitPct: 20,
      stopLossPct: 6,
      mode: 'live',
      status: 'OPEN',
      openedAt: Date.now(),
    });

    const mockViemManager = {
      getPublicClient: vi.fn().mockReturnValue({
        readContract: vi.fn().mockResolvedValue(0n), // 0 tokens in wallet on-chain!
      }),
      getWalletClient: vi.fn().mockReturnValue({
        account: { address: '0xwallet' },
      }),
    };

    const summary = await reconcilePositionsOnChain(tracker, mockViemManager as any);
    expect(summary.closedCount).toBe(1);
    expect(summary.activeCount).toBe(0);

    const pos = await tracker.getPositionById('pos_ghost');
    expect(pos?.status).toBe('CLOSED');
    expect(pos?.closeReason).toBe('RECONCILED_ON_CHAIN_ZERO_BALANCE');
  });

  // 3. Blacklist TTL Test
  it('respects temporary TTL on blacklist and unblocks token after expiry', async () => {
    const token = '0xtemporary';
    // Add to blacklist with TTL of 1 hour (simulated by setting expiresAt in past)
    await blacklist.addToBlacklist(token, 'Low liquidity temporary reject', 1);
    expect(blacklist.isBlacklisted(token)).toBe(true);

    // Simulate expiration
    storage.update((data) => {
      data.settings.blacklist[token].expiresAt = Date.now() - 1000;
    });

    // Checking after expiration automatically unblacklists
    expect(blacklist.isBlacklisted(token)).toBe(false);
  });

  // 4. Stale Trade Time-Based Exit Test
  it('triggers TIME_EXPIRATION exit when trade is open for >= 45m with flat/sideways price', async () => {
    await tracker.openPosition({
      id: 'pos_stale',
      chainId: 8453,
      tokenAddress: '0xstale',
      tokenSymbol: 'STALE',
      entryPriceUsd: 1.0,
      amountTokens: 1000,
      costEth: 0.02,
      takeProfitPct: 25,
      stopLossPct: 8,
      mode: 'paper',
      status: 'OPEN',
      openedAt: Date.now() - (46 * 60 * 1000), // Opened 46 minutes ago!
    });

    const onExit = vi.fn();
    const ticker = new PositionTicker(tracker, onExit);

    // Price is flat at $1.01 (+1% PnL, stagnant within +/-2%)
    await ticker.checkPositionsWithPrices({ '0xstale': 1.01 });

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pos_stale' }),
      'TIME_EXPIRATION',
      1.01
    );
  });
});
