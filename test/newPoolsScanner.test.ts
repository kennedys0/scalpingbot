import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NewPoolsScanner } from '../src/core/scanner/newPools.js';
import axios from 'axios';

vi.mock('axios');

describe('NewPoolsScanner', () => {
  let scanner: NewPoolsScanner;

  beforeEach(() => {
    vi.clearAllMocks();
    scanner = new NewPoolsScanner({ maxAgeMinutes: 30, minLiquidityUsd: 2000 });
  });

  it('filters out pools that exceed max age or fall below min liquidity', async () => {
    const now = Date.now();
    const mockGeckoResponse = {
      data: {
        data: [
          {
            id: 'base_0x111',
            attributes: {
              address: '0xpool1',
              pool_created_at: new Date(now - 10 * 60 * 1000).toISOString(), // 10 mins ago (VALID)
              reserve_in_usd: '5000', // (VALID)
              base_token_price_usd: '0.05',
              name: 'ValidToken / WETH',
            },
            relationships: {
              base_token: { data: { id: 'base_0xvalidtoken' } },
            },
          },
          {
            id: 'base_0x222',
            attributes: {
              address: '0xpool2',
              pool_created_at: new Date(now - 50 * 60 * 1000).toISOString(), // 50 mins ago (TOO OLD)
              reserve_in_usd: '8000',
              base_token_price_usd: '1.0',
              name: 'OldToken / WETH',
            },
            relationships: {
              base_token: { data: { id: 'base_0xoldtoken' } },
            },
          },
          {
            id: 'base_0x333',
            attributes: {
              address: '0xpool3',
              pool_created_at: new Date(now - 5 * 60 * 1000).toISOString(), // 5 mins ago
              reserve_in_usd: '500', // (TOO LOW LIQUIDITY)
              base_token_price_usd: '0.01',
              name: 'LowLiq / WETH',
            },
            relationships: {
              base_token: { data: { id: 'base_0xlowliq' } },
            },
          },
        ],
      },
    };

    (axios.get as any).mockResolvedValue(mockGeckoResponse);

    const candidates = await scanner.scanNewPools(8453);
    expect(candidates.length).toBe(1);
    expect(candidates[0].tokenSymbol).toBe('ValidToken');
    expect(candidates[0].liquidityUsd).toBe(5000);
    expect(candidates[0].ageMinutes).toBeLessThanOrEqual(15);
  });

  it('deduplicates pools so already processed tokens are not returned again', async () => {
    const now = Date.now();
    (axios.get as any).mockResolvedValue({
      data: {
        data: [
          {
            id: 'base_0x111',
            attributes: {
              address: '0xpool1',
              pool_created_at: new Date(now - 5 * 60 * 1000).toISOString(),
              reserve_in_usd: '5000',
              base_token_price_usd: '0.05',
              name: 'ValidToken / WETH',
            },
            relationships: {
              base_token: { data: { id: 'base_0xvalidtoken' } },
            },
          },
        ],
      },
    });

    const firstRun = await scanner.scanNewPools(8453);
    expect(firstRun.length).toBe(1);

    scanner.markProcessed(firstRun[0].baseTokenAddress);

    const secondRun = await scanner.scanNewPools(8453);
    expect(secondRun.length).toBe(0);
  });
});
