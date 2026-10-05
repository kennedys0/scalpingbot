import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScalpingOrchestrator } from '../src/core/orchestrator.js';
import { JsonStorage } from '../src/storage/db.js';

describe('ScalpingOrchestrator: Individual Position Close', () => {
  let orchestrator: ScalpingOrchestrator;
  let storage: JsonStorage;

  beforeEach(() => {
    storage = new JsonStorage(':memory:');
    orchestrator = new ScalpingOrchestrator({
      storage,
      mode: 'paper',
      initialVirtualEth: 1.0,
      openRouterKeyBase: 'mock-base-key',
      openRouterKeyRobinhood: 'mock-rh-key',
      minAiConfidence: 75,
      defaultTradeSizeEth: 0.02,
      maxLossPerTradePct: 7.0,
      maxDailyLossEth: 0.10,
    });
  });

  it('closes only the targeted position without affecting other active positions', async () => {
    // Open two paper positions
    const pos1 = await orchestrator.getExecutionEngine().executeBuy({
      chainId: 8453,
      tokenAddress: '0xdomains',
      tokenSymbol: 'DOMAINS',
      amountEth: 0.02,
      currentPriceUsd: 1.0,
      takeProfitPct: 20,
      stopLossPct: 6,
      trailingStopPct: 3,
    });

    const pos2 = await orchestrator.getExecutionEngine().executeBuy({
      chainId: 8453,
      tokenAddress: '0xbrett',
      tokenSymbol: 'BRETT',
      amountEth: 0.02,
      currentPriceUsd: 0.5,
      takeProfitPct: 20,
      stopLossPct: 6,
      trailingStopPct: 3,
    });

    expect(pos1.success).toBe(true);
    expect(pos2.success).toBe(true);

    const activeBefore = await orchestrator.getPositionTracker().getActivePositions();
    expect(activeBefore.length).toBe(2);

    // Close ONLY pos1 ($DOMAINS)
    const closeRes = await orchestrator.closePosition(pos1.positionId!, 'MANUAL_SELL', 1.10);
    expect(closeRes.success).toBe(true);
    expect(closeRes.realizedPnlPct).toBeGreaterThan(5.0);

    // Verify remaining active positions
    const activeAfter = await orchestrator.getPositionTracker().getActivePositions();
    expect(activeAfter.length).toBe(1);
    expect(activeAfter[0].tokenSymbol).toBe('BRETT');
    expect(activeAfter[0].id).toBe(pos2.positionId);
  });

  it('automatically writes off rugged position when sell execution fails and frees up the trading slot', async () => {
    // Open a position
    const buyRes = await orchestrator.getExecutionEngine().executeBuy({
      chainId: 8453,
      tokenAddress: '0xscamtoken',
      tokenSymbol: 'SCAM',
      amountEth: 0.02,
      currentPriceUsd: 1.0,
      takeProfitPct: 20,
      stopLossPct: 6,
      trailingStopPct: 3,
    });
    expect(buyRes.success).toBe(true);
    const posId = buyRes.positionId!;

    // Mock executeSell to fail as if the on-chain contract reverted (honeypot/rugpull)
    vi.spyOn(orchestrator.getExecutionEngine(), 'executeSell').mockResolvedValueOnce({
      success: false,
      error: 'Base sell swap failed: execution reverted: TransferHelper: TRANSFER_FROM_FAILED',
    });

    const activeBefore = await orchestrator.getPositionTracker().getActivePositions();
    expect(activeBefore.length).toBe(1);

    // Call closePosition
    const closeRes = await orchestrator.closePosition(posId, 'MANUAL_SELL', 0);

    // Should succeed via rugpull write-off
    expect(closeRes.success).toBe(true);
    expect(closeRes.isRugpullWriteOff).toBe(true);
    expect(closeRes.error).toContain('TRANSFER_FROM_FAILED');
    expect(closeRes.realizedPnlPct).toBe(-100);

    // Position MUST be closed in tracker (slot freed!)
    const activeAfter = await orchestrator.getPositionTracker().getActivePositions();
    expect(activeAfter.length).toBe(0);

    // Token must be blacklisted
    const isBlacklisted = await orchestrator.getBlacklistManager().isBlacklisted('0xscamtoken');
    expect(isBlacklisted).toBe(true);
  });
});

