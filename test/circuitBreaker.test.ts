import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker } from '../src/core/risk/circuitBreaker.js';

describe('Risk Management & Circuit Breakers', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker({
      maxTakeProfitPct: 30.0,
      maxLossPerTradePct: 10.0,
      maxDailyLossEth: 0.10,
    });
  });

  it('clamps proposed take profit to the maximum 30% threshold', () => {
    expect(circuitBreaker.clampTakeProfit(50.0)).toBe(30.0);
    expect(circuitBreaker.clampTakeProfit(25.0)).toBe(25.0);
  });

  it('clamps proposed stop loss to the maximum 10% safety threshold', () => {
    // If AI proposes 15% SL, it should be clamped to 10.0%
    const clampedSL = circuitBreaker.clampStopLoss(15.0);
    expect(clampedSL).toBe(10.0);

    // If AI proposes 6% SL, keep 6.0%
    expect(circuitBreaker.clampStopLoss(6.0)).toBe(6.0);
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

  it('trips circuit breaker on consecutive loss streak (e.g. 3 consecutive losses)', () => {
    circuitBreaker.recordClosedTrade(-0.01);
    circuitBreaker.recordClosedTrade(-0.01);
    expect(circuitBreaker.getConsecutiveLossCount()).toBe(2);
    expect(circuitBreaker.canOpenTrade().allowed).toBe(true);

    // 3rd consecutive loss
    circuitBreaker.recordClosedTrade(-0.01);
    expect(circuitBreaker.getConsecutiveLossCount()).toBe(3);
    expect(circuitBreaker.isTripped()).toBe(true);
    expect(circuitBreaker.canOpenTrade().allowed).toBe(false);
    expect(circuitBreaker.canOpenTrade().reason).toContain('Consecutive loss streak');

    // Win resets streak
    circuitBreaker.reset();
    circuitBreaker.recordClosedTrade(0.02);
    expect(circuitBreaker.getConsecutiveLossCount()).toBe(0);
  });
});
