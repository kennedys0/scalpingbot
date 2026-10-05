import { Bot } from 'grammy';
import { registerCommands } from './handlers/commands.js';
import { registerCallbacks } from './handlers/callbacks.js';
import { registerSnipeInput } from './handlers/snipeInput.js';
import { InstantSniper } from '../core/sniper/instantSnipe.js';

export interface TelegramBotContext {
  token: string;
  allowedUserIds: number[];
  getDashboardData: () => any;
  getTradesHistory: () => any[];
  setEngineRunning: (running: boolean) => void;
  setTradingMode: (mode: 'paper' | 'live' | 'shadow') => void;
  setStrategyMode?: (mode: 'rules_only' | 'ai_veto' | 'dual_agent') => void;
  closeAllPositions: () => Promise<number>;
  getActivePositions: () => Promise<any[]>;
  sniper: InstantSniper;
  blacklistManager: any;
  getRecentActivities?: () => any[];
}

export function createTelegramBot(ctx: TelegramBotContext): Bot {
  const bot = new Bot(ctx.token);

  // Security authorization middleware: Only allow whitelisted users
  bot.use(async (telegramCtx, next) => {
    if (ctx.allowedUserIds.length > 0) {
      const fromId = telegramCtx.from?.id;
      if (!fromId || !ctx.allowedUserIds.includes(fromId)) {
        await telegramCtx.reply('⛔ <b>Access Denied</b>: You are not authorized to use this scalping bot.', {
          parse_mode: 'HTML',
        });
        return;
      }
    }
    await next();
  });

  registerCommands(bot, ctx);
  registerCallbacks(bot, ctx);
  registerSnipeInput(bot, ctx);

  bot.catch((err) => {
    console.error('⚠️ Telegram Bot Error caught:', err.message || err);
  });

  return bot;
}
