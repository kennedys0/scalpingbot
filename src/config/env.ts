import { z } from 'zod';
import { DEFAULT_CONFIG } from './constants.js';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_ALLOWED_USER_IDS: z.string().default('').transform((val) => {
    if (!val || val.trim() === '') return [];
    return val.split(',').map((id) => parseInt(id.trim(), 10)).filter((n) => !isNaN(n));
  }),
  OPENROUTER_BASE_URL: z.string().default('https://openrouter.ai/api/v1'),
  OPENROUTER_API_KEY_BASE: z.string().default(''),
  OPENROUTER_API_KEY_ROBINHOOD: z.string().default(''),
  AI_MODEL_BASE: z.string().default('deepseek/deepseek-chat'),
  AI_MODEL_ROBINHOOD: z.string().default('anthropic/claude-3.5-sonnet'),
  WALLET_PRIVATE_KEY: z.string().default(''),
  BASE_RPC_URL: z.string().default('https://mainnet.base.org'),
  BASE_RPC_FALLBACK: z.string().default('https://1rpc.io/base'),
  ROBINHOOD_RPC_URL: z.string().default('https://rpc.mainnet.chain.robinhood.com'),
  ROBINHOOD_RPC_FALLBACK: z.string().default('https://robinhood-rpc.publicnode.com'),
  DEFAULT_TRADING_MODE: z.enum(['paper', 'live', 'shadow']).default(DEFAULT_CONFIG.DEFAULT_TRADING_MODE),
  MAX_TAKE_PROFIT_PCT: z.coerce.number().default(DEFAULT_CONFIG.MAX_TAKE_PROFIT_PCT),
  MAX_LOSS_PER_TRADE_PCT: z.coerce.number().default(DEFAULT_CONFIG.MAX_LOSS_PER_TRADE_PCT),
  MAX_DAILY_LOSS_ETH: z.coerce.number().default(DEFAULT_CONFIG.MAX_DAILY_LOSS_ETH),
  DEFAULT_TRADE_SIZE_ETH: z.coerce.number().default(DEFAULT_CONFIG.DEFAULT_TRADE_SIZE_ETH),
  MAX_CONCURRENT_POSITIONS: z.coerce.number().default(DEFAULT_CONFIG.MAX_CONCURRENT_POSITIONS),
  DEFAULT_SLIPPAGE_PCT: z.coerce.number().default(DEFAULT_CONFIG.DEFAULT_SLIPPAGE_PCT),
  SNIPER_SLIPPAGE_PCT: z.coerce.number().default(DEFAULT_CONFIG.SNIPER_SLIPPAGE_PCT),
  MIN_LIQUIDITY_USD: z.coerce.number().default(DEFAULT_CONFIG.MIN_LIQUIDITY_USD),
  MIN_AI_CONFIDENCE: z.coerce.number().default(DEFAULT_CONFIG.MIN_AI_CONFIDENCE),
  AUTO_SNIPER_ENABLED: z.string().optional().transform((v) => v === 'true').default('false'),
  SNIPER_TRADE_SIZE_ETH: z.coerce.number().default(DEFAULT_CONFIG.SNIPER_TRADE_SIZE_ETH),
  SNIPER_MIN_LIQUIDITY_USD: z.coerce.number().default(DEFAULT_CONFIG.SNIPER_MIN_LIQUIDITY_USD),
  SNIPER_MAX_AGE_MINUTES: z.coerce.number().default(DEFAULT_CONFIG.SNIPER_MAX_AGE_MINUTES),
  SNIPER_MIN_SECURITY_SCORE: z.coerce.number().default(DEFAULT_CONFIG.SNIPER_MIN_SECURITY_SCORE),
  SNIPER_AI_PRE_VETO: z.string().optional().transform((v) => v !== 'false').default('true'),
  SNIPER_AI_ACTIVE_MONITOR: z.string().optional().transform((v) => v !== 'false').default('true'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(rawEnv: Record<string, string | undefined> = process.env): Env {
  return envSchema.parse(rawEnv);
}

let cachedEnv: Env | null = null;
export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = parseEnv(process.env);
  }
  return cachedEnv;
}
