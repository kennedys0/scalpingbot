import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker } from '../src/core/risk/circuitBreaker.js';

describe('Risk Management & Circuit Breakers', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker({
      maxLossPerTradePct: 7.0,
      maxDailyLossEth: 0.10,
    });
  });

  it('clamps proposed stop loss to the maximum configured safety threshold', () => {
    // If AI proposes 12% SL, it should be clamped to 7.0%
    const clampedSL = circuitBreaker.clampStopLoss(12.0);
    expect(clampedSL).toBe(7.0);

    // If AI proposes a tighter 4% SL, keep 4.0%
    expect(circuitBreaker.clampStopLoss(4.0)).toBe(4.0);
  });

  it('trips the circuit breaker when daily losses exceed threshold', () => {
    expect(circuitBreaker.isTripped()).toBe(false);

    // Loss 1: -0.04 ETH
    circuitBreaker.recordClosedTrade(-0.04);
    expect(circuitBreaker.isTripped()).toBe(false);
    expect(circuitBreaker.getDailyLossEth()).toBeCloseTo(0.04, 3);

    // Loss 2: -0.07 ETH (Total: -0.11 ETH > 0.10 ETH limit)
    circuitBreaker.recordClosedTrade(-0.07);
    expect(circuitBreaker.isTripped()).toBe(true);
    expect(circuitBreaker.canOpenTrade().allowed).toBe(false);
    expect(circuitBreaker.canOpenTrade().reason).toContain('Circuit breaker tripped');
  });

  it('allows manual reset of the circuit breaker', () => {
    circuitBreaker.recordClosedTrade(-0.15);
    expect(circuitBreaker.isTripped()).toBe(true);

    circuitBreaker.reset();
    expect(circuitBreaker.isTripped()).toBe(false);
    expect(circuitBreaker.canOpenTrade().allowed).toBe(true);
  });
});
