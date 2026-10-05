import { Bot, Context } from 'grammy';
import { formatDashboard, generatePerformanceReport } from '../messages/formatters.js';
import { buildMainMenuKeyboard } from '../keyboards/menus.js';

export function registerCommands(
  bot: Bot,
  context: {
    getDashboardData: () => any;
    getTradesHistory: () => any[];
    blacklistManager: any;
    closeAllPositions?: () => Promise<number>;
  }
): void {
  bot.command(['start', 'menu'], async (ctx: Context) => {
    const data = context.getDashboardData();
    const text = formatDashboard(data);
    const keyboard = buildMainMenuKeyboard(data.isRunning, data.mode);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  });

  bot.command('report', async (ctx: Context) => {
    const trades = context.getTradesHistory();
    const reportText = generatePerformanceReport(trades);
    await ctx.reply(reportText, { parse_mode: 'HTML' });
  });

  bot.command('panic', async (ctx: Context) => {
    if (context.closeAllPositions) {
      await ctx.reply('🚨 <b>EXECUTING PANIC SELL ALL POSITIONS...</b>', { parse_mode: 'HTML' });
      const closedCount = await context.closeAllPositions();
      await ctx.reply(`🚨 <b>PANIC SELL COMPLETE</b>: ${closedCount} active positions closed at market price!`, {
        parse_mode: 'HTML',
      });
    } else {
      await ctx.reply('⚠️ Panic sell not configured.', { parse_mode: 'HTML' });
    }
  });

  bot.command('blacklist', async (ctx: Context) => {
    const args = ctx.message?.text?.split(' ').slice(1);
    const targetCA = args?.[0]?.trim();
    if (!targetCA || !targetCA.startsWith('0x')) {
      await ctx.reply('⚠️ Format salah. Gunakan: <code>/blacklist 0xContractAddress</code>', { parse_mode: 'HTML' });
      return;
    }

    await context.blacklistManager.addToBlacklist(targetCA, 'Manual user blacklist via Telegram');
    await ctx.reply(`🚫 <b>TOKEN BLACKLISTED</b>: <code>${targetCA}</code> tidak akan dipindai lagi oleh AI.`, {
      parse_mode: 'HTML',
    });
  });

  bot.command('whitelist', async (ctx: Context) => {
    const args = ctx.message?.text?.split(' ').slice(1);
    const targetCA = args?.[0]?.trim();
    if (!targetCA || !targetCA.startsWith('0x')) {
      await ctx.reply('⚠️ Format salah. Gunakan: <code>/whitelist 0xContractAddress</code>', { parse_mode: 'HTML' });
      return;
    }

    await context.blacklistManager.removeFromBlacklist(targetCA);
    await ctx.reply(`✅ <b>TOKEN WHITELISTED</b>: <code>${targetCA}</code> dihapus dari blacklist dan dapat dipindai kembali.`, {
      parse_mode: 'HTML',
    });
  });

  bot.command('help', async (ctx: Context) => {
    const helpText = `📖 <b>AI Scalping Bot Guide</b>
────────────────────────
<b>Mekanisme Kerja:</b>
1. <b>Dex Scanner:</b> Memantau token trending & volume surge di Base & Robinhood Chain.
2. <b>Anti-Honeypot Screener:</b> Memeriksa likuiditas dan tax token sebelum diproses AI.
3. <b>Dual AI Engine (OpenRouter):</b> Menganalisis micro-structure & order flow untuk menentukan BUY/WAIT.
4. <b>TP/SL Auto Ticker:</b> Mengeksekusi profit target (+30% max), stop loss (-10% max), trailing stop, dan partial TP laddering (+15%).
5. <b>Instant Snipe:</b> Kirim alamat token (CA) ke chat ini untuk membeli instan!

<b>Perintah Cepat:</b>
/menu - Tampilkan kontrol panel utama
/report - Tampilkan ringkasan performa trading harian & win rate
/blacklist &lt;CA&gt; - Masukkan token ke daftar hitam
/whitelist &lt;CA&gt; - Hapus token dari daftar hitam
/panic - Jual dan tutup semua posisi aktif seketika
/help - Panduan penggunaan bot`;

    await ctx.reply(helpText, { parse_mode: 'HTML' });
  });
}
