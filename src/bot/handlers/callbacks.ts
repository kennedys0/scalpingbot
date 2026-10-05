import { Bot, Context, InlineKeyboard } from 'grammy';
import { formatDashboard, formatLiveFeedSummary, formatPriceWithIdr, formatEthWithIdr, generatePerformanceReport, formatWalletCard, formatDepositCard, formatWithdrawGuide, formatActivePositionsCard, ActivePositionDisplayItem, getDexScreenerUrl, getGeckoTerminalUrl, escapeHtml } from '../messages/formatters.js';
import { buildMainMenuKeyboard, buildWalletKeyboard } from '../keyboards/menus.js';
import { DEFAULT_CONFIG } from '../../config/constants.js';
import { rateService } from '../../core/services/rateService.js';
import { walletService } from '../../core/services/walletService.js';
import { fetchLiveTokenPrices } from '../../core/services/livePriceService.js';

export function registerCallbacks(
  bot: Bot,
  context: {
    getDashboardData: () => any;
    setEngineRunning: (running: boolean) => void;
    setTradingMode: (mode: 'paper' | 'live' | 'shadow') => void;
    setStrategyMode?: (mode: 'rules_only' | 'ai_veto' | 'dual_agent') => void;
    closeAllPositions: () => Promise<number>;
    closePosition?: (positionId: string) => Promise<{
      success: boolean;
      realizedPnlPct?: number;
      realizedPnlEth?: number;
      closePriceUsd?: number;
      isRugpullWriteOff?: boolean;
      error?: string;
    }>;
    getActivePositions: () => Promise<any[]>;
    getRecentActivities?: () => any[];
    getTradesHistory?: () => any[];
    getSettings?: () => any;
  }
): void {
  bot.callbackQuery('refresh_status', async (ctx: Context) => {
    const data = context.getDashboardData();
    const text = formatDashboard(data);
    const keyboard = buildMainMenuKeyboard(data.isRunning, data.mode, data.strategyMode);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery('Status refreshed! 🔄');
  });

  bot.callbackQuery('engine_start', async (ctx: Context) => {
    context.setEngineRunning(true);
    const data = context.getDashboardData();
    const text = formatDashboard(data);
    const keyboard = buildMainMenuKeyboard(data.isRunning, data.mode, data.strategyMode);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery('🟢 Scalping Engine STARTED!');
  });

  bot.callbackQuery('engine_stop', async (ctx: Context) => {
    context.setEngineRunning(false);
    const data = context.getDashboardData();
    const text = formatDashboard(data);
    const keyboard = buildMainMenuKeyboard(data.isRunning, data.mode, data.strategyMode);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery('🔴 Scalping Engine STOPPED!');
  });

  bot.callbackQuery('mode_live', async (ctx: Context) => {
    context.setTradingMode('live');
    const data = context.getDashboardData();
    const text = formatDashboard(data);
    const keyboard = buildMainMenuKeyboard(data.isRunning, data.mode, data.strategyMode);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery('⚡ Switched to LIVE ON-CHAIN Trading Mode!');
  });

  bot.callbackQuery('mode_paper', async (ctx: Context) => {
    context.setTradingMode('paper');
    const data = context.getDashboardData();
    const text = formatDashboard(data);
    const keyboard = buildMainMenuKeyboard(data.isRunning, data.mode, data.strategyMode);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery('📝 Switched to PAPER Simulation Mode!');
  });

  bot.callbackQuery('mode_shadow', async (ctx: Context) => {
    context.setTradingMode('shadow');
    const data = context.getDashboardData();
    const text = formatDashboard(data);
    const keyboard = buildMainMenuKeyboard(data.isRunning, data.mode, data.strategyMode);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery('👻 Switched to SHADOW Zero-Risk Tracking Mode!');
  });

  bot.callbackQuery('strat_rules_only', async (ctx: Context) => {
    if (context.setStrategyMode) context.setStrategyMode('rules_only');
    const data = context.getDashboardData();
    const text = formatDashboard(data);
    const keyboard = buildMainMenuKeyboard(data.isRunning, data.mode, data.strategyMode);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery('⚡ Switched to RULES-ONLY Mode (Zero LLM, Pure Quant)!');
  });

  bot.callbackQuery('strat_ai_veto', async (ctx: Context) => {
    if (context.setStrategyMode) context.setStrategyMode('ai_veto');
    const data = context.getDashboardData();
    const text = formatDashboard(data);
    const keyboard = buildMainMenuKeyboard(data.isRunning, data.mode, data.strategyMode);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery('🛡️ Switched to AI RISK VETO Mode (Auditor Safety Layer)!');
  });

  bot.callbackQuery('strat_dual_agent', async (ctx: Context) => {
    if (context.setStrategyMode) context.setStrategyMode('dual_agent');
    const data = context.getDashboardData();
    const text = formatDashboard(data);
    const keyboard = buildMainMenuKeyboard(data.isRunning, data.mode, data.strategyMode);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery('⚔️ Switched to DUAL AGENT DEBATE Mode (Hunter vs Auditor)!');
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
    const maxLimit = context.getSettings?.().MAX_CONCURRENT_POSITIONS ?? 3;

    if (positions.length === 0) {
      await ctx.reply(formatActivePositionsCard([], maxLimit), {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('🔙 Menu Utama', 'refresh_status'),
      });
      await ctx.answerCallbackQuery('Tidak ada posisi aktif saat ini.');
      return;
    }

    // Fetch real-time live prices from DexScreener batch
    const priceMap = await fetchLiveTokenPrices(positions.map((p) => p.tokenAddress));

    const displayItems: ActivePositionDisplayItem[] = positions.map((p) => {
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
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('view_feed', async (ctx: Context) => {
    const activities = context.getRecentActivities ? context.getRecentActivities() : [];
    const text = formatLiveFeedSummary(activities);
    const keyboard = new InlineKeyboard()
      .text('🔄 Refresh Feed', 'view_feed')
      .text('🔙 Back to Menu', 'refresh_status');
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('view_history', async (ctx: Context) => {
    const trades = context.getTradesHistory ? context.getTradesHistory() : [];
    const reportText = generatePerformanceReport(trades);
    const keyboard = new InlineKeyboard().text('🔙 Back to Menu', 'refresh_status');
    await ctx.reply(reportText, { parse_mode: 'HTML', reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('view_settings', async (ctx: Context) => {
    const settings = context.getSettings ? context.getSettings() : DEFAULT_CONFIG;
    const tradeSize = settings.defaultTradeSizeEth ?? settings.DEFAULT_TRADE_SIZE_ETH ?? 0.02;
    const maxDailyLoss = settings.maxDailyLossEth ?? settings.MAX_DAILY_LOSS_ETH ?? 0.10;
    const minLiquidity = settings.minLiquidityUsd ?? settings.MIN_LIQUIDITY_USD ?? 5000;
    const maxLossTrade = settings.maxLossPerTradePct ?? settings.MAX_LOSS_PER_TRADE_PCT ?? 10.0;
    const takeProfitMax = settings.maxTakeProfitPct ?? settings.MAX_TAKE_PROFIT_PCT ?? 30.0;
    const slippage = settings.defaultSlippagePct ?? settings.DEFAULT_SLIPPAGE_PCT ?? 1.5;
    const sniperSlippage = settings.sniperSlippagePct ?? settings.SNIPER_SLIPPAGE_PCT ?? 15.0;

    const tradeSizeIdr = formatEthWithIdr(tradeSize);
    const maxLossIdr = formatEthWithIdr(maxDailyLoss);
    const minLiqIdr = formatPriceWithIdr(minLiquidity);
    const rates = rateService.getRates();
    const sourceLabel = rates.source === 'coingecko' ? '🟢 CoinGecko Real-Time' : '🟡 Fallback';

    const text = `⚙️ <b>BOT SETTINGS & RISK LIMITS</b>
────────────────────────
• <b>Default Trade Size:</b> ${tradeSizeIdr}
• <b>Max Daily Loss:</b> ${maxLossIdr}
• <b>Min Liquidity Floor:</b> ${minLiqIdr}
• <b>Max Loss per Trade:</b> -${maxLossTrade}%
• <b>Take Profit Max:</b> +${takeProfitMax}%
• <b>Slippage:</b> ${slippage}% (Snipe: ${sniperSlippage}%)
• <b>Trailing Stop:</b> Trigger +${DEFAULT_CONFIG.TRAILING_STOP_TRIGGER_PCT}%, Pullback ${DEFAULT_CONFIG.TRAILING_STOP_PULLBACK_PCT}%

📊 <b>Live Exchange Rate (${sourceLabel}):</b>
• 1 ETH = $${rates.ethPriceUsd.toLocaleString('en-US')} (~Rp ${rates.ethPriceIdr.toLocaleString('id-ID')})
• 1 USD = Rp ${rates.usdToIdrRate.toLocaleString('id-ID')}
────────────────────────`;
    const keyboard = new InlineKeyboard().text('🔙 Back to Menu', 'refresh_status');
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  });

  // ══════════════════ WALLET HANDLERS ══════════════════

  bot.callbackQuery('wallet_overview', async (ctx: Context) => {
    await ctx.answerCallbackQuery('💼 Mengambil data wallet...');
    const snapshot = await walletService.fetchBalance();
    if (!snapshot) {
      await ctx.reply(
        '⚠️ <b>Gagal mengambil saldo wallet.</b>\nPastikan <code>WALLET_PRIVATE_KEY</code> dan RPC sudah dikonfigurasi dengan benar.',
        { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔙 Kembali', 'refresh_status') }
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
  });

  bot.callbackQuery('wallet_refresh', async (ctx: Context) => {
    await ctx.answerCallbackQuery('🔄 Memperbarui saldo...');
    const snapshot = await walletService.fetchBalance();
    if (!snapshot) {
      await ctx.reply('⚠️ Gagal refresh saldo. Periksa konfigurasi RPC.', { parse_mode: 'HTML' });
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
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: buildWalletKeyboard() }).catch(async () => {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: buildWalletKeyboard() });
    });
  });

  bot.callbackQuery('wallet_deposit', async (ctx: Context) => {
    await ctx.answerCallbackQuery('📥 Membuat QR Code deposit...');
    const address = walletService.getCachedAddress() ?? await walletService.deriveAddress();
    if (!address) {
      await ctx.reply('⚠️ Wallet belum dikonfigurasi. Set <code>WALLET_PRIVATE_KEY</code> di .env', { parse_mode: 'HTML' });
      return;
    }
    const qrUrl = walletService.generateDepositQrUrl(address, 300);
    const caption = formatDepositCard(address);
    const backKeyboard = new InlineKeyboard()
      .text('🔙 Kembali ke Wallet', 'wallet_overview');
    try {
      await ctx.replyWithPhoto(qrUrl, {
        caption,
        parse_mode: 'HTML',
        reply_markup: backKeyboard,
      });
    } catch {
      // Fallback: send as text with the QR URL if photo fails
      await ctx.reply(
        `${caption}\n\n🔗 <a href="${qrUrl}">Buka QR Code</a>`,
        { parse_mode: 'HTML', reply_markup: backKeyboard }
      );
    }
  });

  bot.callbackQuery('wallet_withdraw', async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    const address = walletService.getCachedAddress() ?? await walletService.deriveAddress();
    if (!address) {
      await ctx.reply('⚠️ Wallet belum dikonfigurasi.', { parse_mode: 'HTML' });
      return;
    }
    const last = walletService.getLastSnapshot();
    const balanceEth = last?.balanceEth ?? 0;
    const text = formatWithdrawGuide(address, balanceEth);
    const keyboard = new InlineKeyboard()
      .text('🔙 Kembali ke Wallet', 'wallet_overview');
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  bot.callbackQuery('wallet_history', async (ctx: Context) => {
    await ctx.answerCallbackQuery('📈 Memuat riwayat saldo...');
    const address = walletService.getCachedAddress();
    if (!address) {
      await ctx.reply('⚠️ Data wallet belum tersedia. Buka <b>Wallet</b> terlebih dahulu untuk mulai tracking.', { parse_mode: 'HTML' });
      return;
    }
    const history = walletService.getHistory();
    const snapshots = history.snapshots;
    if (snapshots.length === 0) {
      await ctx.reply('📭 Belum ada riwayat saldo. Buka halaman Wallet beberapa kali untuk mulai tracking.', { parse_mode: 'HTML' });
      return;
    }

    // Build compact timeline from available snapshots (max 8 entries)
    const display = snapshots.length > 8
      ? [snapshots[0], ...snapshots.slice(-7)]
      : snapshots;

    const rates = rateService.getRates();
    const rows = display.map((s) => {
      const t = new Date(s.timestamp);
      const timeStr = `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`;
      const ethStr = s.balanceEth.toFixed(5);
      const idrStr = `~Rp ${Math.round(s.balanceIdr / 1000)}rb`;
      return `<code>${timeStr}</code> | <code>${ethStr} ETH</code> | ${idrStr}`;
    }).join('\n');

    const pnlSign = history.pnl24hEth >= 0 ? '+' : '';
    const pnlEmoji = history.pnl24hEth >= 0 ? '📈' : '📉';
    const pnlIdrSign = history.pnl24hIdr >= 0 ? '+' : '-';
    const pnlIdrFmt = Math.abs(Math.round(history.pnl24hIdr)).toLocaleString('id-ID');

    const text = `📈 <b>RIWAYAT SALDO WALLET</b>
────────────────────────
<b>Alamat:</b> <code>${address.substring(0, 8)}...${address.substring(address.length - 6)}</code>

<b>Timeline Saldo:</b>
${rows}

────────────────────────
${pnlEmoji} <b>PnL 24 Jam:</b>
• ETH: <code>${pnlSign}${history.pnl24hEth.toFixed(6)} ETH</code>
• IDR: <code>${pnlIdrSign}Rp ${pnlIdrFmt}</code>
• %: <b>${pnlSign}${history.pnl24hPct.toFixed(2)}%</b>

<i>Total: ${snapshots.length} data point direkam</i>`;

    const keyboard = new InlineKeyboard()
      .text('🔄 Refresh Saldo', 'wallet_refresh')
      .text('🔙 Kembali ke Wallet', 'wallet_overview');
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  // ══════════════════ MISSING HANDLERS FIX (L-01, L-02, L-03) ══════════════════

  // L-01 FIX: Handle AI Deep Audit button from snipe keyboard: `audit_<chainId>_<tokenAddress>`
  bot.callbackQuery(/^audit_(\d+)_(0x[a-fA-F0-9]{40})$/, async (ctx: Context) => {
    const match = ctx.match as RegExpMatchArray;
    const chainId = parseInt(match[1], 10);
    const tokenAddress = match[2];
    const chainName = chainId === 8453 ? 'Base' : 'Robinhood';

    await ctx.answerCallbackQuery('🤖 AI Audit sedang berjalan...');
    await ctx.reply(
      `🤖 <b>AI DEEP AUDIT</b>\n────────────────────────\n<b>Token:</b> <code>${tokenAddress}</code>\n<b>Network:</b> ${chainName}\n\n<i>Untuk audit mendalam, gunakan fitur snipe dan pantau Live Feed untuk melihat hasil evaluasi AI (Security Score, EV, dan Debate).</i>\n\n💡 Kirim CA ke chat untuk memulai snipe dengan audit otomatis.`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔙 Kembali', 'refresh_status') }
    );
  });

  // L-03 FIX: Handle Close Position button: `close_pos_<positionId>`
  bot.callbackQuery(/^close_pos_(.+)$/, async (ctx: Context) => {
    const match = ctx.match as RegExpMatchArray;
    const positionId = match[1];

    await ctx.answerCallbackQuery('⚡ Menutup posisi...');
    try {
      const positions = await context.getActivePositions();
      const pos = positions.find((p: any) => p.id === positionId);
      if (!pos) {
        await ctx.reply('⚠️ Posisi tidak ditemukan atau sudah tertutup.', { parse_mode: 'HTML' });
        return;
      }

      if (context.closePosition) {
        const res = await context.closePosition(positionId);
        if (!res.success) {
          await ctx.reply(`❌ Gagal menutup posisi $${pos.tokenSymbol}: ${res.error || 'Unknown error'}.`, { parse_mode: 'HTML' });
          return;
        }

        if (res.isRugpullWriteOff) {
          await ctx.reply(
            `⚠️ <b>Posisi <code>$${pos.tokenSymbol}</code> Ditutup Paksa (Rugpull Write-Off)</b>\n` +
            `────────────────────────\n` +
            `❌ On-chain swap gagal karena token terindikasi rugpull / likuiditas ditarik / kontrak revert.\n` +
            `📝 <b>Detail Error:</b> <code>${escapeHtml(res.error || 'Execution reverted on swap')}</code>\n` +
            `✅ <b>Slot trading telah berhasil dibebaskan!</b> Token otomatis masuk ke Blacklist permanen.`,
            { parse_mode: 'HTML' }
          );
          return;
        }

        const pnlPct = res.realizedPnlPct ?? 0;
        const sign = pnlPct >= 0 ? '+' : '';
        const ethPnl = res.realizedPnlEth !== undefined ? ` (${sign}${res.realizedPnlEth.toFixed(4)} ETH)` : '';
        await ctx.reply(
          `✅ <b>Posisi <code>$${pos.tokenSymbol}</code> berhasil ditutup!</b>\n` +
          `Harga Jual: ${formatPriceWithIdr(res.closePriceUsd ?? pos.entryPriceUsd)}\n` +
          `Realized PnL: <b>${sign}${pnlPct.toFixed(2)}%${ethPnl}</b>`,
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.reply('⚠️ Fitur penutupan posisi individual belum terhubung.', { parse_mode: 'HTML' });
      }
    } catch (err: any) {
      await ctx.reply(`❌ Gagal menutup posisi: ${err?.message ?? 'Unknown error'}`, { parse_mode: 'HTML' });
    }
  });

  // L-02 FIX: Handle View Chart button: `chart_<positionId>` — redirect to DexScreener
  bot.callbackQuery(/^chart_(.+)$/, async (ctx: Context) => {
    await ctx.answerCallbackQuery('📈 Membuka chart...');
    // Chart cannot be embedded in Telegram; redirect to DexScreener
    await ctx.reply(
      `📈 <b>View Chart</b>\n────────────────────────\nGunakan link DexScreener untuk melihat chart token:\n<a href="https://dexscreener.com">🔗 dexscreener.com</a>\n\n<i>Cari token berdasarkan contract address.</i>`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔙 Kembali', 'refresh_status') }
    );
  });

  bot.callbackQuery('dismiss', async (ctx: Context) => {
    await ctx.deleteMessage().catch(() => {});
  });
}
