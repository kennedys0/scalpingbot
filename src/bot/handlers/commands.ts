import { Bot, Context, InlineKeyboard } from 'grammy';
import { formatDashboard, generatePerformanceReport, formatLiveFeedSummary, formatWalletCard, formatWithdrawGuide, formatActivePositionsCard, ActivePositionDisplayItem, formatPriceWithIdr, formatEthWithIdr, getDexScreenerUrl, getGeckoTerminalUrl } from '../messages/formatters.js';
import { buildMainMenuKeyboard, buildWalletKeyboard, buildPersistentReplyKeyboard } from '../keyboards/menus.js';
import { walletService } from '../../core/services/walletService.js';
import { rateService } from '../../core/services/rateService.js';
import { DEFAULT_CONFIG } from '../../config/constants.js';
import { fetchLiveTokenPrices } from '../../core/services/livePriceService.js';
import { getEnv } from '../../config/env.js';

export function registerCommands(
  bot: Bot,
  context: {
    getDashboardData: () => any;
    getTradesHistory: () => any[];
    blacklistManager: any;
    setEngineRunning?: (running: boolean) => void;
    closeAllPositions?: () => Promise<number>;
    getActivePositions?: () => Promise<any[]>;
    getRecentActivities?: () => any[];
    getSettings?: () => any;
  }
): void {
  const showPositions = async (ctx: Context) => {
    const positions = context.getActivePositions ? await context.getActivePositions() : [];
    const maxLimit = context.getSettings ? (context.getSettings().maxConcurrentPositions ?? 3) : 3;

    if (positions.length === 0) {
      await ctx.reply(formatActivePositionsCard([], maxLimit), {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('🔙 Menu Utama', 'refresh_status'),
      });
      return;
    }

    const priceMap = await fetchLiveTokenPrices(positions.map((p: any) => p.tokenAddress));
    const displayItems: ActivePositionDisplayItem[] = positions.map((p: any) => {
      const livePrice = priceMap[p.tokenAddress] || priceMap[p.tokenAddress.toLowerCase()] || p.highestPriceSeen || p.entryPriceUsd;
      return {
        id: p.id,
        chainId: p.chainId,
        tokenAddress: p.tokenAddress,
        tokenSymbol: p.tokenSymbol,
        mode: p.mode,
        entryPriceUsd: p.entryPriceUsd,
        currentPriceUsd: livePrice,
        costEth: p.costEth,
        takeProfitPct: p.takeProfitPct,
        stopLossPct: p.stopLossPct,
        trailingStopPct: p.trailingStopPct,
        highestPriceSeen: p.highestPriceSeen,
        openedAt: p.openedAt,
      };
    });

    const text = formatActivePositionsCard(displayItems, maxLimit);
    const keyboard = new InlineKeyboard().text('🔄 Refresh Harga Live', 'view_positions');
    for (const p of positions) {
      const dexUrl = getDexScreenerUrl(p.chainId, p.tokenAddress);
      const geckoUrl = getGeckoTerminalUrl(p.chainId, p.tokenAddress);
      keyboard
        .row()
        .text(`⚡ Market Sell $${p.tokenSymbol}`, `close_pos_${p.id}`)
        .url(`📈 DexScreener`, dexUrl)
        .url(`🦎 GeckoTerminal`, geckoUrl);
    }
    keyboard.row().text('🔙 Menu Utama', 'refresh_status');

    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  };

  const showStartMenu = async (ctx: Context) => {
    const data = context.getDashboardData();
    const text = formatDashboard(data);
    const keyboard = buildMainMenuKeyboard(data.isRunning, data.mode, data.strategyMode);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });

    // Persistent quick-access keyboard
    await ctx.reply('💡 <b>Menu Cepat:</b> Gunakan tombol di bawah untuk akses instan kapan saja:', {
      parse_mode: 'HTML',
      reply_markup: buildPersistentReplyKeyboard(),
    }).catch(() => {});
  };

  bot.command(['positions', 'pos'], showPositions);
  bot.hears('📊 Positions', showPositions);

  bot.command(['start', 'menu'], showStartMenu);
  bot.hears('▶️ Start / Menu', showStartMenu);

  bot.command(['run', 'start_engine'], async (ctx: Context) => {
    if (context.setEngineRunning) {
      context.setEngineRunning(true);
      await ctx.reply('🟢 <b>Scalping Engine BERJALAN</b>: Bot sedang aktif memindai dan mengevaluasi peluang trading baru.', {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('📊 Cek Posisi Aktif', 'view_positions').text('🔴 Stop Engine', 'engine_stop'),
      });
    }
  });

  bot.command(['stop', 'stop_engine'], async (ctx: Context) => {
    if (context.setEngineRunning) {
      context.setEngineRunning(false);
      await ctx.reply('🔴 <b>Scalping Engine DIJEDA</b>: Pemindaian dan pembukaan posisi baru dihentikan sementara. <i>Catatan: TP/SL tetap aktif mengawal posisi yang terbuka.</i>', {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('🟢 Start Engine Kembali', 'engine_start'),
      });
    }
  });

  const showReport = async (ctx: Context) => {
    const trades = context.getTradesHistory();
    const reportText = generatePerformanceReport(trades);
    await ctx.reply(reportText, { parse_mode: 'HTML' });
  };
  bot.command('report', showReport);
  bot.hears('📜 Report', showReport);

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

  const showFeed = async (ctx: Context) => {
    const activities = context.getRecentActivities ? context.getRecentActivities() : [];
    const text = formatLiveFeedSummary(activities);
    const keyboard = new InlineKeyboard()
      .text('🔄 Refresh Feed', 'view_feed')
      .text('🔙 Back to Menu', 'refresh_status');
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  };
  bot.command(['feed', 'live'], showFeed);
  bot.hears('📡 Live Feed', showFeed);

  const showSettings = async (ctx: Context) => {
    const settings = context.getSettings ? context.getSettings() : DEFAULT_CONFIG;
    const tradeSize = settings.defaultTradeSizeEth ?? settings.DEFAULT_TRADE_SIZE_ETH ?? 0.02;
    const maxDailyLoss = settings.maxDailyLossEth ?? settings.MAX_DAILY_LOSS_ETH ?? 0.10;
    const minLiquidity = settings.minLiquidityUsd ?? settings.MIN_LIQUIDITY_USD ?? 5000;
    const maxLossTrade = settings.maxLossPerTradePct ?? settings.MAX_LOSS_PER_TRADE_PCT ?? 10.0;
    const takeProfitMax = settings.maxTakeProfitPct ?? settings.MAX_TAKE_PROFIT_PCT ?? 30.0;
    const slippage = settings.defaultSlippagePct ?? settings.DEFAULT_SLIPPAGE_PCT ?? 1.5;
    const sniperSlippage = settings.sniperSlippagePct ?? settings.SNIPER_SLIPPAGE_PCT ?? 15.0;
    const maxPositions = settings.maxConcurrentPositions ?? settings.MAX_CONCURRENT_POSITIONS ?? 3;

    const tradeSizeIdr = formatEthWithIdr(tradeSize);
    const maxLossIdr = formatEthWithIdr(maxDailyLoss);
    const minLiqIdr = formatPriceWithIdr(minLiquidity);
    const rates = rateService.getRates();
    const sourceLabel = rates.source === 'coingecko' ? '🟢 CoinGecko Real-Time' : '🟡 Fallback';

    const text = `⚙️ <b>BOT SETTINGS & RISK LIMITS</b>
────────────────────────
• <b>Max Concurrent Positions:</b> <code>${maxPositions}</code>
• <b>Default Trade Size:</b> <code>${tradeSizeIdr}</code>
• <b>Max Take Profit:</b> <code>+${takeProfitMax}%</code>
• <b>Max Loss / Trade (Hard Stop):</b> <code>-${maxLossTrade}%</code>
• <b>Max Daily Loss Limit:</b> <code>${maxLossIdr}</code>
• <b>Min Pool Liquidity:</b> <code>${minLiqIdr}</code>
• <b>DEX Slippage (Base):</b> <code>${slippage}%</code>
• <b>Sniper Slippage:</b> <code>${sniperSlippage}%</code>
• <b>Kurs ETH:</b> $${rates.ethPriceUsd.toLocaleString('en-US')} (~Rp ${Math.round(rates.ethPriceIdr).toLocaleString('id-ID')})
• <b>Kurs Rate Engine:</b> ${sourceLabel}
────────────────────────
<i>Ubah konfigurasi melalui file .env atau menu dashboard.</i>`;

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('🔙 Kembali ke Menu', 'refresh_status'),
    });
  };
  bot.command('settings', showSettings);
  bot.hears('⚙️ Settings', showSettings);

  // ══════════════════ WALLET COMMANDS ══════════════════

  const showWallet = async (ctx: Context) => {
    await ctx.reply('💼 <i>Mengambil saldo wallet dari blockchain...</i>', { parse_mode: 'HTML' });
    const snapshot = await walletService.fetchBalance();
    if (!snapshot) {
      await ctx.reply(
        '⚠️ <b>Gagal mengambil saldo wallet.</b>\n\nPastikan <code>WALLET_PRIVATE_KEY</code> dan RPC dikonfigurasi di file <code>.env</code>.',
        { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔙 Menu Utama', 'refresh_status') }
      );
      return;
    }
    const history = walletService.getHistory();
    const text = formatWalletCard({
      address: snapshot.address,
      balanceBaseEth: snapshot.balanceBaseEth,
      balanceRobinhoodEth: snapshot.balanceRobinhoodEth,
      balanceTotalEth: snapshot.balanceTotalEth,
      balanceEth: snapshot.balanceEth,
      balanceUsd: snapshot.balanceUsd,
      balanceIdr: snapshot.balanceIdr,
      pnl24hEth: history.pnl24hEth,
      pnl24hIdr: history.pnl24hIdr,
      pnl24hPct: history.pnl24hPct,
      snapshotCount: history.snapshots.length,
      lastUpdated: snapshot.timestamp,
    });
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: buildWalletKeyboard() });
  };
  bot.command('wallet', showWallet);
  bot.hears('💼 Wallet', showWallet);

  bot.command('deposit', async (ctx: Context) => {
    const address = walletService.getCachedAddress() ?? await walletService.deriveAddress();
    if (!address) {
      await ctx.reply('⚠️ Wallet belum dikonfigurasi. Set <code>WALLET_PRIVATE_KEY</code> di .env', { parse_mode: 'HTML' });
      return;
    }
    const qrUrl = walletService.generateDepositQrUrl(address, 300);
    const caption = `📥 <b>DEPOSIT ETH KE WALLET</b>
────────────────────────
🔵 <b>Network:</b> Base Chain (Base Mainnet)
⚠️ <b>Hanya kirim ETH di jaringan Base!</b>

📋 <b>Alamat Wallet:</b>
<code>${address}</code>

<i>Scan QR Code atau salin alamat di atas.</i>
────────────────────────
<i>💡 Pilih jaringan "Base" saat transfer dari exchange.</i>`;
    const backKeyboard = new InlineKeyboard().text('🔙 Kembali ke Wallet', 'wallet_overview');
    try {
      await ctx.replyWithPhoto(qrUrl, { caption, parse_mode: 'HTML', reply_markup: backKeyboard });
    } catch {
      await ctx.reply(`${caption}\n\n🔗 <a href="${qrUrl}">Buka QR Code</a>`, { parse_mode: 'HTML', reply_markup: backKeyboard });
    }
  });

  bot.command('withdraw', async (ctx: Context) => {
    const args = ctx.message?.text?.split(' ').slice(1) ?? [];
    const toAddress = args[0]?.trim();
    const amountStr = args[1]?.trim();

    const address = walletService.getCachedAddress() ?? await walletService.deriveAddress();
    if (!address) {
      await ctx.reply('⚠️ Wallet belum dikonfigurasi.', { parse_mode: 'HTML' });
      return;
    }

    if (!toAddress || !amountStr) {
      const last = walletService.getLastSnapshot();
      await ctx.reply(formatWithdrawGuide(address, last?.balanceEth ?? 0), {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('🔙 Wallet', 'wallet_overview'),
      });
      return;
    }

    if (!toAddress.startsWith('0x') || toAddress.length !== 42) {
      await ctx.reply('⚠️ Alamat tujuan tidak valid. Harus berformat <code>0x...</code> (42 karakter)', { parse_mode: 'HTML' });
      return;
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('⚠️ Jumlah ETH tidak valid. Contoh: <code>/withdraw 0xAbc... 0.05</code>', { parse_mode: 'HTML' });
      return;
    }

    const last = walletService.getLastSnapshot();
    if (last && amount > last.balanceEth) {
      await ctx.reply(`⚠️ Saldo tidak cukup. Tersedia: <code>${last.balanceEth.toFixed(6)} ETH</code>`, { parse_mode: 'HTML' });
      return;
    }

    const env = getEnv();
    if (env.DEFAULT_TRADING_MODE !== 'live') {
      await ctx.reply(
        `🚫 <b>Withdraw diblokir!</b>\nBot sedang dalam mode <code>${env.DEFAULT_TRADING_MODE.toUpperCase()}</code>.\n\nSet <code>DEFAULT_TRADING_MODE=live</code> di .env untuk mengaktifkan transaksi nyata.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    await ctx.reply(`⏳ <b>Memproses withdraw...</b>\n• Tujuan: <code>${toAddress}</code>\n• Jumlah: <code>${amount} ETH</code>`, { parse_mode: 'HTML' });

    try {
      const { createWalletClient, http: viemHttp, parseEther } = await import('viem');
      const { privateKeyToAccount } = await import('viem/accounts');
      const { base } = await import('viem/chains');

      const pk = env.WALLET_PRIVATE_KEY;
      const normalizedKey = pk.startsWith('0x') ? pk : `0x${pk}`;
      const account = privateKeyToAccount(normalizedKey as `0x${string}`);
      const walletClient = createWalletClient({
        account,
        chain: base,
        transport: viemHttp(env.BASE_RPC_URL),
      });

      const txHash = await walletClient.sendTransaction({
        to: toAddress as `0x${string}`,
        value: parseEther(amount.toString()),
      });

      await ctx.reply(
        `✅ <b>Withdraw Berhasil!</b>
────────────────────────
• Tujuan: <code>${toAddress}</code>
• Jumlah: <code>${amount} ETH</code>
• TX Hash: <code>${txHash}</code>
• Explorer: <a href="https://basescan.org/tx/${txHash}">Lihat di BaseScan</a>`,
        { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('💼 Wallet', 'wallet_overview') }
      );

      // Refresh balance after withdrawal
      setTimeout(() => walletService.fetchBalance().catch(() => {}), 5000);
    } catch (err: any) {
      await ctx.reply(
        `❌ <b>Withdraw Gagal!</b>\n\n<code>${err?.message ?? 'Unknown error'}</code>`,
        { parse_mode: 'HTML' }
      );
    }
  });

  bot.command('help', async (ctx: Context) => {
    const helpText = `📖 <b>AI Scalping Bot Guide</b>
────────────────────────
<b>Mekanisme Kerja:</b>
1. <b>Dex Scanner:</b> Memantau token trending &amp; volume surge di Base &amp; Robinhood Chain.
2. <b>Anti-Honeypot Screener:</b> Memeriksa likuiditas dan tax token sebelum diproses AI.
3. <b>Dual AI Engine (OpenRouter):</b> Menganalisis micro-structure &amp; order flow untuk menentukan BUY/WAIT.
4. <b>TP/SL Auto Ticker:</b> Mengeksekusi profit target (+30% max), stop loss (-10% max), trailing stop, dan partial TP laddering (+15%).
5. <b>Instant Snipe:</b> Kirim alamat token (CA) ke chat ini untuk membeli instan!

<b>Perintah Cepat:</b>
/menu - Tampilkan kontrol panel utama
/wallet - Lihat saldo &amp; info wallet (ETH + IDR)
/deposit - Tampilkan QR Code untuk deposit ETH
/withdraw &lt;alamat&gt; &lt;jumlah&gt; - Kirim ETH ke alamat lain
/feed - Tampilkan aktivitas real-time scanner &amp; debat AI terbaru
/report - Tampilkan ringkasan performa trading harian &amp; win rate
/blacklist &lt;CA&gt; - Masukkan token ke daftar hitam
/whitelist &lt;CA&gt; - Hapus token dari daftar hitam
/panic - Jual dan tutup semua posisi aktif seketika
/help - Panduan penggunaan bot`;

    await ctx.reply(helpText, { parse_mode: 'HTML' });
  });
}


