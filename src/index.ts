import { getEnv } from './config/env.js';
import { JsonStorage } from './storage/db.js';
import { ScalpingOrchestrator } from './core/orchestrator.js';
import { createTelegramBot } from './bot/index.js';
import { formatTradeSignalCard, formatExitCard } from './bot/messages/formatters.js';

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
    defaultTradeSizeEth: env.DEFAULT_TRADE_SIZE_ETH,
    maxLossPerTradePct: env.MAX_LOSS_PER_TRADE_PCT,
    maxDailyLossEth: env.MAX_DAILY_LOSS_ETH,

    onTradeSignal: async (signal) => {
      if (botInstance && env.TELEGRAM_ALLOWED_USER_IDS.length > 0) {
        const text = formatTradeSignalCard(signal);
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
        const text = `🪜 <b>[PARTIAL TAKE-PROFIT (+15%)]</b>\nToken: $${partial.tokenSymbol}\nSold: <b>50% of position</b>\nPrice: $${partial.currentPriceUsd.toFixed(6)}\n🛡️ <b>Stop Loss otomatis dinaikkan ke Breakeven (+1%)</b>!\nSisa 50% posisi dibiarkan berjalan risk-free.`;
        for (const userId of env.TELEGRAM_ALLOWED_USER_IDS) {
          await botInstance.api.sendMessage(userId, text, { parse_mode: 'HTML' }).catch(() => {});
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
      for (const pos of active) {
        await orchestrator.getExecutionEngine().executeSell(pos, pos.entryPriceUsd, 'PANIC_SELL');
      }
      return active.length;
    },
    getActivePositions: () => orchestrator.getPositionTracker().getActivePositions(),
    sniper: orchestrator.getSniper(),
  });

  // Start background scanner
  orchestrator.startPeriodicScanner(30000);

  // Start Telegram bot long-polling if valid token is provided
  if (env.TELEGRAM_BOT_TOKEN && !env.TELEGRAM_BOT_TOKEN.includes('test_token')) {
    botInstance.start({
      onStart: (botInfo: any) => {
        console.log(`🤖 Telegram Bot @${botInfo.username} is active and ready!`);
      },
    });
  } else {
    console.log('ℹ️ Running in headless mode (TELEGRAM_BOT_TOKEN is dummy or not configured).');
  }

  console.log('✅ Scalping Bot Orchestrator initialized successfully.');

  // Graceful shutdown handling
  const shutdown = () => {
    console.log('\n🛑 Stopping bot gracefully...');
    orchestrator.stopPeriodicScanner();
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
