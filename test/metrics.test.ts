import { describe, it, expect } from 'vitest';
import { calculateMicrostructureMetrics, DexPairData } from '../src/core/scanner/metrics.js';
import { ORDER_FLOW_KNOWLEDGE } from '../src/core/ai/knowledge/orderflow.js';
import { LIQUIDITY_KNOWLEDGE } from '../src/core/ai/knowledge/liquidity.js';
import { CHAIN_SPECIFIC_KNOWLEDGE } from '../src/core/ai/knowledge/chains.js';

describe('Market Microstructure Metrics & Domain Knowledge', () => {
  it('correctly calculates volume delta, buy pressure ratio, and liquidity to FDV ratio', () => {
    const mockPair: DexPairData = {
      pairAddress: '0x123',
      baseToken: { address: '0xabc', symbol: 'TEST', name: 'Test Token' },
      priceUsd: '1.50',
      priceChange: { m5: 4.5, h1: 12.0, h24: 35.0 },
      volume: { m5: 15000, h1: 120000, h24: 850000 },
      txns: {
        m5: { buys: 45, sells: 15 },
        h1: { buys: 300, sells: 120 },
      },
      liquidity: { usd: 65000 },
      fdv: 500000,
    };

    const metrics = calculateMicrostructureMetrics(mockPair);

    // Buy ratio = 45 / (45 + 15) = 0.75 (75%)
    expect(metrics.buyPressureRatio5m).toBe(0.75);
    // Estimated buy volume ~ 75% of 15000 = 11250, sell volume ~ 3750, delta = +7500
    expect(metrics.volumeDelta5m).toBeGreaterThan(0);
    // Liquidity to FDV ratio = 65000 / 500000 = 0.13 (13%)
    expect(metrics.liquidityToFdvRatio).toBeCloseTo(0.13, 2);
    expect(metrics.isOrderFlowBullish).toBe(true);
  });

  it('embeds specialized crypto scalping domain knowledge', () => {
    expect(ORDER_FLOW_KNOWLEDGE).toContain('Cumulative Volume Delta');
    expect(LIQUIDITY_KNOWLEDGE).toContain('Uniswap V4');
    expect(CHAIN_SPECIFIC_KNOWLEDGE.base).toContain('Base');
    expect(CHAIN_SPECIFIC_KNOWLEDGE.robinhood).toContain('Robinhood');
  });
});
