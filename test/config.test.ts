import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { CHAIN_CONFIG, getChainConfig } from '../src/config/chains.js';

describe('Environment and Chain Configuration', () => {
  it('parses valid environment variables with defaults', () => {
    const mockEnv = {
      TELEGRAM_BOT_TOKEN: '123456:test_token',
      TELEGRAM_ALLOWED_USER_IDS: '111,222',
      OPENROUTER_API_KEY_BASE: 'sk-base-123',
      OPENROUTER_API_KEY_ROBINHOOD: 'sk-rh-456',
    };

    const env = parseEnv(mockEnv);
    expect(env.TELEGRAM_BOT_TOKEN).toBe('123456:test_token');
    expect(env.TELEGRAM_ALLOWED_USER_IDS).toEqual([111, 222]);
    expect(env.DEFAULT_TRADING_MODE).toBe('paper');
    expect(env.MAX_TAKE_PROFIT_PCT).toBe(30.0);
    expect(env.MAX_LOSS_PER_TRADE_PCT).toBe(10.0);
    expect(env.MAX_DAILY_LOSS_ETH).toBe(0.10);
  });

  it('throws an error when mandatory environment variables are missing', () => {
    const invalidEnv = {
      TELEGRAM_BOT_TOKEN: '',
    };
    expect(() => parseEnv(invalidEnv)).toThrow();
  });

  it('defines valid Base and Robinhood Chain configs', () => {
    const baseConfig = getChainConfig(8453);
    expect(baseConfig.chainId).toBe(8453);
    expect(baseConfig.name).toBe('Base');
    expect(baseConfig.nativeCurrency.symbol).toBe('ETH');
    expect(baseConfig.defaultRouter).toBeDefined();

    const rhConfig = getChainConfig(4663);
    expect(rhConfig.chainId).toBe(4663);
    expect(rhConfig.name).toBe('Robinhood');
    expect(rhConfig.nativeCurrency.symbol).toBe('ETH');
    expect(rhConfig.uniswapV4PoolManager).toBeDefined();
  });
});
