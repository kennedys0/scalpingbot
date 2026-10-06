import { describe, it, expect, vi } from 'vitest';
import { BaseRouterExecutor } from '../src/core/execution/routers/baseRouter.js';
import { parseEther } from 'viem';

describe('Real Balance Delta & Gas Accounting', () => {
  it('calculates realized PnL from wallet balance difference instead of nominal price', async () => {
    // Initial balance: 1.0 ETH
    // Cost of position: 0.02 ETH
    // DEX returned 0.018 ETH after sell fees/gas -> Balance after: 1.018 ETH
    // Real delta: +0.018 ETH received. PnL: 0.018 - 0.02 = -0.002 ETH (-10%)
    const mockPublicClient = {
      readContract: vi.fn().mockResolvedValue(1000n), // balance & allowance
      getBalance: vi.fn()
        .mockResolvedValueOnce(parseEther('1.0')) // before sell
        .mockResolvedValueOnce(parseEther('1.018')), // after sell
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        gasUsed: 50000n,
        effectiveGasPrice: 1000000000n, // 1 gwei
      }),
    };
    const mockWalletClient = {
      account: { address: '0x1234567890123456789012345678901234567890' },
      sendTransaction: vi.fn().mockResolvedValue('0xselltxhash'),
    };
    const mockViemManager = {
      getPublicClient: vi.fn().mockReturnValue(mockPublicClient),
      getWalletClient: vi.fn().mockReturnValue(mockWalletClient),
    } as any;

    const baseRouter = new BaseRouterExecutor(mockViemManager);
    const result = await baseRouter.executeSell(
      {
        id: 'pos_1',
        chainId: 8453,
        tokenAddress: '0x1111111111111111111111111111111111111111',
        tokenSymbol: 'NFTM',
        entryPriceUsd: 1.0,
        amountTokens: 100,
        costEth: 0.02,
        takeProfitPct: 10,
        stopLossPct: 5,
        mode: 'live',
        status: 'OPEN',
        openedAt: Date.now(),
      },
      1.30 // Token price nominally pumped +30%!
    );

    expect(result.success).toBe(true);
    // Realized PnL must be net ETH received (0.018 ETH) - cost (0.02 ETH) = -0.002 ETH
    // NOT naive nominal +30% (+0.006 ETH)!
    expect(result.realizedPnlEth).toBeCloseTo(-0.002, 5);
    expect(result.realizedPnlPct).toBeCloseTo(-10.0, 1);
  });
});
