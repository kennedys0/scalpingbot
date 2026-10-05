import { Bot, Context } from 'grammy';
import { formatDashboard } from '../messages/formatters.js';
import { buildMainMenuKeyboard } from '../keyboards/menus.js';

export function registerCommands(bot: Bot, getDashboardData: () => any): void {
  bot.command(['start', 'menu'], async (ctx: Context) => {
    const data = getDashboardData();
    const text = formatDashboard(data);
    const keyboard = buildMainMenuKeyboard(data.isRunning, data.mode);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  });

  bot.command('help', async (ctx: Context) => {
    const helpText = `📖 <b>AI Scalping Bot Guide</b>
────────────────────────
<b>Mekanisme Kerja:</b>
1. <b>Dex Scanner:</b> Memantau token trending & volume surge di Base & Robinhood Chain.
2. <b>Anti-Honeypot Screener:</b> Memeriksa likuiditas dan tax token sebelum diproses AI.
3. <b>Dual AI Engine (OpenRouter):</b> Menganalisis micro-structure & order flow untuk menentukan BUY/WAIT.
4. <b>TP/SL Auto Ticker:</b> Mengeksekusi profit target atau cut loss secara instan di latar belakang.
5. <b>Instant Snipe:</b> Kirim alamat token (CA) ke chat ini untuk membeli instan!

<b>Perintah Cepat:</b>
/menu - Tampilkan kontrol panel utama
/panic - Jual dan tutup semua posisi aktif seketika
/help - Panduan penggunaan bot`;

    await ctx.reply(helpText, { parse_mode: 'HTML' });
  });
}
