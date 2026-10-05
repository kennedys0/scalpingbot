import { Bot, Context } from 'grammy';
import { formatDashboard } from '../messages/formatters.js';
import { buildMainMenuKeyboard } from '../keyboards/menus.js';

export function registerCallbacks(
  bot: Bot,
  context: {
    getDashboardData: () => any;
    setEngineRunning: (running: boolean) => void;
    setTradingMode: (mode: 'paper' | 'live') => void;
    closeAllPositions: () => Promise<number>;
    getActivePositions: () => Promise<any[]>;
  }
): void {
  bot.callbackQuery('refresh_status', async (ctx: Context) => {
    const data = context.getDashboardData();
    const text = formatDashboard(data);
    const keyboard = buildMainMenuKeyboard(data.isRunning, data.mode);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery('Status refreshed! 🔄');
  });

  bot.callbackQuery('engine_start', async (ctx: Context) => {
    context.setEngineRunning(true);
    const data = context.getDashboardData();
    const text = formatDashboard(data);
    const keyboard = buildMainMenuKeyboard(data.isRunning, data.mode);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery('🟢 Scalping Engine STARTED!');
  });

  bot.callbackQuery('engine_stop', async (ctx: Context) => {
    context.setEngineRunning(false);
    const data = context.getDashboardData();
    const text = formatDashboard(data);
    const keyboard = buildMainMenuKeyboard(data.isRunning, data.mode);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery('🔴 Scalping Engine STOPPED!');
  });

  bot.callbackQuery('mode_live', async (ctx: Context) => {
    context.setTradingMode('live');
    const data = context.getDashboardData();
    const text = formatDashboard(data);
    const keyboard = buildMainMenuKeyboard(data.isRunning, data.mode);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery('⚡ Switched to LIVE ON-CHAIN Trading Mode!');
  });

  bot.callbackQuery('mode_paper', async (ctx: Context) => {
    context.setTradingMode('paper');
    const data = context.getDashboardData();
    const text = formatDashboard(data);
    const keyboard = buildMainMenuKeyboard(data.isRunning, data.mode);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery('📝 Switched to PAPER Simulation Mode!');
  });

  bot.callbackQuery('panic_sell_all', async (ctx: Context) => {
    await ctx.answerCallbackQuery('🚨 EXECUTING PANIC SELL ALL...');
    const closedCount = await context.closeAllPositions();
    await ctx.reply(`🚨 <b>PANIC SELL COMPLETE</b>: ${closedCount} active positions closed at market price!`, {
      parse_mode: 'HTML',
    });
  });

  bot.callbackQuery('view_positions', async (ctx: Context) => {
    const positions = await context.getActivePositions();
    if (positions.length === 0) {
      await ctx.answerCallbackQuery('No active positions currently.');
      return;
    }

    let summary = `📊 <b>Active Positions (${positions.length})</b>\n────────────────────────\n`;
    for (const p of positions) {
      const chainName = p.chainId === 8453 ? 'Base' : 'Robinhood';
      summary += `• <b>$${p.tokenSymbol}</b> (${chainName})\n  Entry: $${p.entryPriceUsd} | Cost: ${p.costEth} ETH\n  TP: +${p.takeProfitPct}% | SL: -${p.stopLossPct}%\n\n`;
    }
    await ctx.reply(summary, { parse_mode: 'HTML' });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('dismiss', async (ctx: Context) => {
    await ctx.deleteMessage().catch(() => {});
  });
}
