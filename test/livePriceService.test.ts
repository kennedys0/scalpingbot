import { describe, it, expect, vi } from 'vitest';
import { fetchLiveTokenPrices } from '../src/core/services/livePriceService.js';
import axios from 'axios';

describe('livePriceService: DexScreener with GeckoTerminal Fallback', () => {
  it('falls back to GeckoTerminal when DexScreener returns no pairs for token', async () => {
    const mockHookprog = '0xf3a3f219293b1ac59a4f27d06627da6882691308';

    vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
      if (url.includes('dexscreener.com')) {
        return { data: { pairs: null } };
      }
      if (url.includes('geckoterminal.com') && url.includes('robinhood')) {
        return {
          data: {
            data: [
              {
                id: `robinhood_${mockHookprog}`,
                attributes: {
                  address: mockHookprog,
                  name: 'Hook Prog',
                  symbol: 'HOOKPROG',
                  price_usd: '0.00001610',
                },
              },
            ],
          },
        };
      }
      return { data: {} };
    });

    const prices = await fetchLiveTokenPrices([mockHookprog]);
    expect(prices[mockHookprog.toLowerCase()]).toBe(0.0000161);
  });
});
