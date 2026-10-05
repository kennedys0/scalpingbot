import { getEnv } from './config/env.js';
import { JsonStorage } from './storage/db.js';
import { ScalpingOrchestrator } from './core/orchestrator.js';
import { createTelegramBot } from './bot/index.js';
import { formatTradeSignalCard, formatNewTokenSnipeCard, formatExitCard, formatAiDebateCard, formatRiskEvaluationCard, formatPriceWithIdr, formatDepositNotificationCard } from './bot/messages/formatters.js';
import { rateService } from './core/services/rateService.js';
import { walletService } from './core/services/walletService.js';
import { fetchLiveTokenPrices } from './core/services/livePriceService.js';
import axios from 'axios';

async function bootstrap() {
  console.log('🚀 Starting Multi-Chain AI Scalping Bot...');
  const env = getEnv();
  const storage = new JsonStorage('./data/store.json');

  let botInstance: any = null;

  const orchestrator = new ScalpingOrchestrator({
    storage,
    mode: env.DEFAULT_TRADING_MODE,
    initialVirtualEth: 1.0,
    openRouterBaseUrl: env.OPENROUTER_BASE_URL,
    openRouterKeyBase: env.OPENROUTER_API_KEY_BASE,
    openRouterKeyRobinhood: env.OPENROUTER_API_KEY_ROBINHOOD || env.OPENROUTER_API_KEY_BASE,
    aiModelBase: env.AI_MODEL_BASE,
    aiModelRobinhood: env.AI_MODEL_ROBINHOOD,
    walletPrivateKey: env.WALLET_PRIVATE_KEY,
    minAiConfidence: env.MIN_AI_CONFIDENCE,
    minSecurityScore: env.SNIPER_MIN_SECURITY_SCORE,
    defaultTradeSizeEth: env.DEFAULT_TRADE_SIZE_ETH,
    sniperTradeSizeEth: env.SNIPER_TRADE_SIZE_ETH,
    sniperMaxAgeMinutes: env.SNIPER_MAX_AGE_MINUTES,
    sniperMinLiquidityUsd: env.SNIPER_MIN_LIQUIDITY_USD,
    sniperAiPreVeto: env.SNIPER_AI_PRE_VETO,
    maxConcurrentPositions: env.MAX_CONCURRENT_POSITIONS,
    maxLossPerTradePct: env.MAX_LOSS_PER_TRADE_PCT,
    maxDailyLossEth: env.MAX_DAILY_LOSS_ETH,

    onTradeSignal: async (signal) => {
      if (botInstance && env.TELEGRAM_ALLOWED_USER_IDS.length > 0) {
        const text = signal.isSnipe
          ? formatNewTokenSnipeCard({
              chainName: signal.chainName,
              tokenName: signal.tokenSymbol,
              tokenSymbol: signal.tokenSymbol,
              tokenAddress: signal.tokenAddress,
              entryPriceUsd: signal.entryPriceUsd,
              amountEth: signal.amountEth,
              initialLiquidityUsd: 5000,
              poolAgeMinutes: 2,
              securityScore: env.SNIPER_MIN_SECURITY_SCORE,
              aiConfidence: signal.confidence,
              aiReasoning: signal.reasoning,
              takeProfitPct: signal.takeProfitPct,
              stopLossPct: signal.stopLossPct,
            })
          : formatTradeSignalCard(signal);
        for (const userId of env.TELEGRAM_ALLOWED_USER_IDS) {
          await botInstance.api.sendMessage(userId, text, { parse_mode: 'HTML' }).catch(() => {});
        }
      }
    },

    onTradeExit: async (exit) => {
      if (botInstance && env.TELEGRAM_ALLOWED_USER_IDS.length > 0) {
        const text = formatExitCard(exit);
        for (const userId of env.TELEGRAM_ALLOWED_USER_IDS) {
          await botInstance.api.sendMessage(userId, text, { parse_mode: 'HTML' }).catch(() => {});
        }
      }
    },

    onPartialTradeExit: async (partial) => {
      if (botInstance && env.TELEGRAM_ALLOWED_USER_IDS.length > 0) {
        const text = `🪜 <b>[PARTIAL TAKE-PROFIT (+15%)]</b>\nToken: $${partial.tokenSymbol}\nSold: <b>50% of position</b>\nPrice: ${formatPriceWithIdr(partial.currentPriceUsd)}\n🛡️ <b>Stop Loss otomatis dinaikkan ke Breakeven (+1%)</b>!\nSisa 50% posisi dibiarkan berjalan risk-free.`;
        for (const userId of env.TELEGRAM_ALLOWED_USER_IDS) {
          await botInstance.api.sendMessage(userId, text, { parse_mode: 'HTML' }).catch(() => {});
        }
      }
    },

    onAiDebate: async (debate) => {
      if (botInstance && env.TELEGRAM_ALLOWED_USER_IDS.length > 0) {
        const text = formatAiDebateCard(debate);
        for (const userId of env.TELEGRAM_ALLOWED_USER_IDS) {
          await botInstance.api.sendMessage(userId, text, { parse_mode: 'HTML' }).catch(() => {});
        }
      }
    },

    onRiskEvaluation: async (risk) => {
      if (botInstance && env.TELEGRAM_ALLOWED_USER_IDS.length > 0) {
        // Only broadcast if the risk check FAILED (don't flood with passing EV results)
        if (!risk.passed) {
          const text = formatRiskEvaluationCard(risk);
          for (const userId of env.TELEGRAM_ALLOWED_USER_IDS) {
            await botInstance.api.sendMessage(userId, text, { parse_mode: 'HTML' }).catch(() => {});
          }
        }
      }
    },
  });

  // Reconcile open positions against on-chain wallet balance upon startup
  const reconcileReport = await orchestrator.reconcileOnChain();
  if (reconcileReport.closedCount > 0) {
    console.log(`🔄 Reconciled on-chain positions: Closed ${reconcileReport.closedCount} external/zero-balance positions.`);
  }

  // Setup Telegram Bot
  botInstance = createTelegramBot({
    token: env.TELEGRAM_BOT_TOKEN,
    allowedUserIds: env.TELEGRAM_ALLOWED_USER_IDS,
    getDashboardData: () => {
      return {
        isRunning: orchestrator.isRunning(),
        mode: orchestrator.getExecutionEngine().getMode(),
        strategyMode: orchestrator.getStrategyMode(),
        dailyNetPnlEth: orchestrator.getCircuitBreaker().getDailyNetPnLEth(),
        openPositionsCount: storage.getData().positions.filter((p: any) => p.status === 'OPEN').length,
        baseScannerActive: orchestrator.isRunning(),
        rhScannerActive: orchestrator.isRunning(),
        circuitBreakerTripped: orchestrator.getCircuitBreaker().isTripped(),
      };
    },
    getTradesHistory: () => storage.getData().trades || [],
    blacklistManager: orchestrator.getBlacklistManager(),
    setEngineRunning: (running: boolean) => orchestrator.setRunning(running),
    setTradingMode: (mode: 'paper' | 'live' | 'shadow') => orchestrator.getExecutionEngine().setMode(mode),
    setStrategyMode: (mode: 'rules_only' | 'ai_veto' | 'dual_agent') => orchestrator.setStrategyMode(mode),
    closeAllPositions: async () => {
      const active = await orchestrator.getPositionTracker().getActivePositions();
      let closedCount = 0;
      for (const pos of active) {
        const res = await orchestrator.closePosition(pos.id, 'PANIC_SELL');
        if (res.success) closedCount++;
      }
      return closedCount;
    },
    closePosition: async (positionId: string) => {
      return await orchestrator.closePosition(positionId, 'MANUAL_SELL');
    },
    getActivePositions: () => orchestrator.getPositionTracker().getActivePositions(),
    sniper: orchestrator.getSniper(),
    getRecentActivities: () => orchestrator.getRecentActivities(),
    getSettings: () => ({
      defaultTradeSizeEth: env.DEFAULT_TRADE_SIZE_ETH,
      maxDailyLossEth: env.MAX_DAILY_LOSS_ETH,
      maxLossPerTradePct: env.MAX_LOSS_PER_TRADE_PCT,
      maxTakeProfitPct: env.MAX_TAKE_PROFIT_PCT,
      defaultSlippagePct: env.DEFAULT_SLIPPAGE_PCT,
      sniperSlippagePct: env.SNIPER_SLIPPAGE_PCT,
      minLiquidityUsd: env.MIN_LIQUIDITY_USD,
      maxConcurrentPositions: env.MAX_CONCURRENT_POSITIONS,
    }),
  });

  // Initialize real-time CoinGecko rate service
  await rateService.fetchRates().catch(() => {});
  rateService.startPeriodicRefresh(60000);

  // BUG-01 FIX: Pre-warm wallet address derivation and initialize baseline balance
  await walletService.deriveAddress().catch(() => {});
  await walletService.fetchBalance().catch(() => {});

  // Listen for real-time incoming deposits on Base and Robinhood
  walletService.onDeposit(async (deposit) => {
    if (botInstance && env.TELEGRAM_ALLOWED_USER_IDS.length > 0) {
      const text = formatDepositNotificationCard(deposit);
      for (const userId of env.TELEGRAM_ALLOWED_USER_IDS) {
        await botInstance.api.sendMessage(userId, text, { parse_mode: 'HTML' }).catch(() => {});
      }
    }
  });

  // Start periodic background balance watcher (every 20s) to detect incoming deposits
  walletService.startPeriodicWatcher(20000);

  // BUG-02 FIX: Start the position ticker (TP/SL/Trailing Stop/Anti-Dump engine)
  // Uses ultra-fast batch DexScreener to get live prices for all open positions
  orchestrator.startPositionTicker(5000, async () => {
    const positions = await orchestrator.getPositionTracker().getActivePositions();
    if (positions.length === 0) return {};
    return await fetchLiveTokenPrices(positions.map((p) => p.tokenAddress));
  });

  // Start background scanner
  orchestrator.startPeriodicScanner(30000);

  // Start new token auto-sniper loop if enabled
  if (env.AUTO_SNIPER_ENABLED) {
    console.log('🎯 New Token Auto-Sniper is ENABLED. Starting fast pools scanner...');
    orchestrator.startNewPoolsScanner(10000);
  } else {
    console.log('ℹ️ New Token Auto-Sniper is idle (AUTO_SNIPER_ENABLED=false).');
  }

  // Start Telegram bot long-polling if valid token is provided
  if (env.TELEGRAM_BOT_TOKEN && !env.TELEGRAM_BOT_TOKEN.includes('test_token')) {
    const startBotWithRetry = async () => {
      let isStopping = false;
      while (!isStopping) {
        try {
          // Register native Telegram command menu list (makes the Start/Menu button appear in Telegram UI)
          await botInstance.api.setMyCommands([
            { command: 'start', description: '🚀 Buka menu utama & dashboard' },
            { command: 'positions', description: '📊 Cek posisi aktif & harga live' },
            { command: 'wallet', description: '💼 Cek saldo wallet ETH & IDR' },
            { command: 'report', description: '📜 Laporan performa harian' },
            { command: 'feed', description: '📡 Live feed aktivitas AI scanner' },
            { command: 'settings', description: '⚙️ Pengaturan limit & risk' },
            { command: 'run', description: '🟢 Start scalping engine' },
            { command: 'stop', description: '🔴 Stop scalping engine' },
            { command: 'panic', description: '🚨 Emergency sell semua posisi' },
          ]).catch(() => {});

          await botInstance.start({
            onStart: (botInfo: any) => {
              console.log(`🤖 Telegram Bot @${botInfo.username} is active and ready!`);
            },
          });
          break;
        } catch (err: any) {
          console.warn(`⚠️ Telegram connection warning: ${err.message || err}. Reconnecting in 4s...`);
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
    };
    startBotWithRetry().catch((err) => console.error('Telegram bot runner error:', err));
  } else {
    console.log('ℹ️ Running in headless mode (TELEGRAM_BOT_TOKEN is dummy or not configured).');
  }

  console.log('✅ Scalping Bot Orchestrator initialized successfully.');

  // Graceful shutdown handling
  const shutdown = () => {
    console.log('\n🛑 Stopping bot gracefully...');
    rateService.stopPeriodicRefresh();
    walletService.stopPeriodicWatcher();
    orchestrator.stopPeriodicScanner();
    orchestrator.stopNewPoolsScanner();
    orchestrator.stopPositionTicker();
    if (botInstance) botInstance.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
