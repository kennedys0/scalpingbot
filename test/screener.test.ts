import { describe, it, expect, vi } from 'vitest';
import { DexScreenerScanner } from '../src/core/scanner/dexscreener.js';
import { SafetyScreener } from '../src/core/screener/safety.js';

describe('Market Scanner & Anti-Honeypot Safety Screener', () => {
  it('correctly filters out unsafe tokens with high tax or insufficient liquidity', () => {
    const screener = new SafetyScreener({ minLiquidityUsd: 5000, maxTaxPct: 7 });

    const safeToken = {
      pairAddress: '0xsafe',
      liquidityUsd: 15000,
      buyTax: 0,
      sellTax: 1,
      isHoneypot: false,
      isOpenTrading: true,
    };

    const unsafeLowLiq = {
      pairAddress: '0xlow',
      liquidityUsd: 2500, // < 5000
      buyTax: 0,
      sellTax: 0,
      isHoneypot: false,
      isOpenTrading: true,
    };

    const unsafeHighTax = {
      pairAddress: '0xtax',
      liquidityUsd: 20000,
      buyTax: 15, // > 7%
      sellTax: 15,
      isHoneypot: false,
      isOpenTrading: true,
    };

    const unsafeHoneypot = {
      pairAddress: '0xhoney',
      liquidityUsd: 50000,
      buyTax: 0,
      sellTax: 0,
      isHoneypot: true,
      isOpenTrading: true,
    };

    const unsafeDumpingToken = {
      pairAddress: '0xdumping',
      liquidityUsd: 20000,
      buyTax: 0,
      sellTax: 0,
      isHoneypot: false,
      isOpenTrading: true,
      priceChange5m: -9.5, // > 8% dump in 5m
      sellVolumeRatio: 0.70, // > 60% sell pressure
    };

    expect(screener.screenToken(safeToken).isSafe).toBe(true);
    expect(screener.screenToken(unsafeLowLiq).isSafe).toBe(false);
    expect(screener.screenToken(unsafeHighTax).isSafe).toBe(false);
    expect(screener.screenToken(unsafeHoneypot).isSafe).toBe(false);
    expect(screener.screenToken(unsafeDumpingToken).isSafe).toBe(false);
    expect(screener.screenToken(unsafeDumpingToken).reasons.some(r => r.includes('dump'))).toBe(true);
  });

  it('scans and transforms DexScreener pairs for Base and Robinhood', async () => {
    const scanner = new DexScreenerScanner();

    // Mock axios call
    vi.spyOn(scanner as any, 'fetchFromDexScreener').mockResolvedValue([
      {
        chainId: 'base',
        pairAddress: '0xpair1',
        baseToken: { address: '0xtok1', symbol: 'BRETT', name: 'Brett' },
        priceUsd: '0.08',
        liquidity: { usd: 25000 },
        volume: { m5: 12000, h1: 65000 },
        txns: { m5: { buys: 40, sells: 10 } },
        priceChange: { m5: 3.5 },
      },
    ]);

    const results = await scanner.scanTrendingPairs(8453);
    expect(results.length).toBe(1);
    expect(results[0].baseToken.symbol).toBe('BRETT');
  });
});
