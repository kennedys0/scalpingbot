import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rateService } from '../src/core/services/rateService.js';
import { formatEthWithIdr, formatPriceWithIdr } from '../src/bot/messages/formatters.js';

describe('CurrencyRateService (CoinGecko Live Integration)', () => {
  beforeEach(() => {
    // Reset to test baseline
    rateService.setMockRates({
      ethPriceUsd: 2600,
      ethPriceIdr: 42000000,
      usdToIdrRate: 16150,
      source: 'fallback',
    });
  });

  it('provides baseline rates before fetching', () => {
    const rates = rateService.getRates();
    expect(rates.ethPriceUsd).toBe(2600);
    expect(rates.usdToIdrRate).toBe(16150);
    expect(rates.ethPriceIdr).toBe(42000000);
  });

  it('updates live rates dynamically and affects formatters immediately', () => {
    rateService.setMockRates({
      ethPriceUsd: 2700,
      ethPriceIdr: 45000000,
      usdToIdrRate: 16666,
      source: 'coingecko',
    });

    const rates = rateService.getRates();
    expect(rates.source).toBe('coingecko');
    expect(rates.ethPriceUsd).toBe(2700);

    // Formatter should reflect 1 ETH = Rp 45.000.000
    const ethFormatted = formatEthWithIdr(0.01);
    expect(ethFormatted).toContain('0.0100 ETH');
    expect(ethFormatted).toContain('Rp 450.000');

    // USD formatter should reflect 1 USD = Rp 16.666
    const priceFormatted = formatPriceWithIdr(2.0);
    expect(priceFormatted).toContain('$2.00');
    expect(priceFormatted).toContain('Rp 33.332');
  });

  it('handles CoinGecko API network failure gracefully without throwing', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('Network offline or rate limit'));

    const rates = await rateService.fetchRates();
    expect(rates).toBeDefined();
    expect(rates.ethPriceUsd).toBeGreaterThan(0);

    global.fetch = originalFetch;
  });
});
