import { describe, it, expect } from 'vitest';
import { ExpectedValueCalculator } from '../src/core/risk/evCalculator.js';

describe('ExpectedValueCalculator - Risk Engine Supreme Authority', () => {
  const evCalc = new ExpectedValueCalculator(1.5); // min 1.5% edge required

  it('calibrates overconfident LLM scores into realistic win probabilities', () => {
    // 75% LLM confidence -> ~61%
    const prob75 = evCalc.calibrateProbability(75);
    expect(prob75).toBeCloseTo(0.61, 2);

    // 85% LLM confidence -> ~65%
    const prob85 = evCalc.calibrateProbability(85);
    expect(prob85).toBeCloseTo(0.65, 2);

    // 50% LLM confidence -> ~0.52 - 0.53
    const prob50 = evCalc.calibrateProbability(50);
    expect(prob50).toBeGreaterThanOrEqual(0.52);
    expect(prob50).toBeLessThanOrEqual(0.53);
  });

  it('vetoes trade when net EV is lower than required edge (+1.5%) due to friction', () => {
    // Marginal trade: 75% confidence, TP 10%, SL 8%, small size $25 (high relative gas friction)
    const result = evCalc.calculateEV({
      confidence: 75,
      takeProfitPct: 10,
      stopLossPct: 8,
      positionSizeEth: 0.01,
      ethPriceUsd: 2500, // $25 position size
      estimatedGasEth: 0.0004, // 0.0008 roundtrip = $2 = 8% of $25!
      estimatedSlippagePct: 1.0, // 2% roundtrip
      minRequiredEdgePct: 1.5,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Insufficient Expected Value');
    expect(result.totalEstimatedCostPct).toBeGreaterThan(5.0);
  });

  it('approves trades with statistically robust edge after full round-trip friction', () => {
    // Solid trade: 85% confidence, TP 25%, SL 6%, reasonable size $100
    const result = evCalc.calculateEV({
      confidence: 85,
      takeProfitPct: 25,
      stopLossPct: 6,
      positionSizeEth: 0.04,
      ethPriceUsd: 2500, // $100 position size
      estimatedGasEth: 0.0004,
      estimatedSlippagePct: 1.0,
      minRequiredEdgePct: 1.5,
    });

    expect(result.allowed).toBe(true);
    expect(result.expectedValuePct).toBeGreaterThanOrEqual(1.5);
    expect(result.calibratedWinProbability).toBeCloseTo(0.65, 2);
  });
});
