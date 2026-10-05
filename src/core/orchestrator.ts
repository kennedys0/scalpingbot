import { JsonStorage } from '../storage/db.js';
import { PositionTracker, Position } from './positions/tracker.js';
import { PositionTicker, ExitReason } from './positions/ticker.js';
import { PaperTrader } from './execution/paperTrader.js';
import { ExecutionEngine } from './execution/engine.js';
import { DexScreenerScanner } from './scanner/dexscreener.js';
import { calculateMicrostructureMetrics, DexPairData } from './scanner/metrics.js';
import { SafetyScreener } from './screener/safety.js';
import { AiScalpEngine } from './ai/client.js';
import { CircuitBreaker } from './risk/circuitBreaker.js';
import { InstantSniper } from './sniper/instantSnipe.js';
import { ViemClientManager } from './execution/viemClient.js';
import { BaseRouterExecutor } from './execution/routers/baseRouter.js';
import { RobinhoodRouterExecutor } from './execution/routers/rhRouter.js';

import { BlacklistManager } from './screener/blacklist.js';
import { DualAgentDebateEngine } from './ai/debate.js';
import { SelfReflectiveMemory } from './ai/memory.js';
import { MacroEthSentinel } from './scanner/macroRegime.js';
import { SmartMoneyRadar } from './screener/smartMoney.js';

export interface OrchestratorConfig {
  storage: JsonStorage;
  mode?: 'paper' | 'live';
  initialVirtualEth?: number;
  openRouterBaseUrl?: string;
  openRouterKeyBase?: string;
  openRouterKeyRobinhood?: string;
  aiModelBase?: string;
  aiModelRobinhood?: string;
  walletPrivateKey?: string;
  minAiConfidence?: number;
  defaultTradeSizeEth?: number;
  maxLossPerTradePct?: number;
  maxDailyLossEth?: number;
  onTradeSignal?: (signal: any) => Promise<void>;
  onTradeExit?: (exit: any) => Promise<void>;
  onPartialTradeExit?: (exit: any) => Promise<void>;
}

export class ScalpingOrchestrator {
  private storage: JsonStorage;
  private tracker: PositionTracker;
  private ticker: PositionTicker;
  private paperTrader: PaperTrader;
  private engine: ExecutionEngine;
  private scanner: DexScreenerScanner;
  private screener: SafetyScreener;
  private circuitBreaker: CircuitBreaker;
  private sniper: InstantSniper;
  private blacklist: BlacklistManager;
  private aiBase: AiScalpEngine;
  private aiRobinhood: AiScalpEngine;
  private debateEngine: DualAgentDebateEngine;
  private memory: SelfReflectiveMemory;
  private macroSentinel: MacroEthSentinel;
  private smartMoneyRadar: SmartMoneyRadar;

  private minAiConfidence: number;
  private defaultTradeSizeEth: number;
  private isEngineRunning: boolean = true;
  private scanTimer: NodeJS.Timeout | null = null;
  private onTradeSignal?: (signal: any) => Promise<void>;
  private onTradeExit?: (exit: any) => Promise<void>;
  private onPartialTradeExit?: (exit: any) => Promise<void>;

  constructor(config: OrchestratorConfig) {
    this.storage = config.storage;
    this.tracker = new PositionTracker(this.storage);
    this.paperTrader = new PaperTrader(config.initialVirtualEth ?? 1.0);
    this.circuitBreaker = new CircuitBreaker({
      maxLossPerTradePct: config.maxLossPerTradePct ?? 10.0,
      maxDailyLossEth: config.maxDailyLossEth ?? 0.10,
    });

    const viemManager = new ViemClientManager(config.walletPrivateKey);
    const baseRouter = new BaseRouterExecutor(viemManager);
    const rhRouter = new RobinhoodRouterExecutor(viemManager);

    this.engine = new ExecutionEngine({
      mode: config.mode ?? 'paper',
      paperTrader: this.paperTrader,
      tracker: this.tracker,
      baseRouter,
      rhRouter,
    });

    this.scanner = new DexScreenerScanner();
    this.screener = new SafetyScreener();
    this.sniper = new InstantSniper(this.engine);
    this.blacklist = new BlacklistManager(this.storage);
    this.memory = new SelfReflectiveMemory(this.storage);
    this.macroSentinel = new MacroEthSentinel();
    this.smartMoneyRadar = new SmartMoneyRadar();

    this.aiBase = new AiScalpEngine({
      apiKey: config.openRouterKeyBase || '',
      baseUrl: config.openRouterBaseUrl,
      model: config.aiModelBase,
      chainId: 8453,
    });

    this.aiRobinhood = new AiScalpEngine({
      apiKey: config.openRouterKeyRobinhood || '',
      baseUrl: config.openRouterBaseUrl,
      model: config.aiModelRobinhood,
      chainId: 4663,
    });

    // Dual-Agent Debate Engine: Bull Hunter (aiBase) vs Bear Auditor (aiRobinhood)
    this.debateEngine = new DualAgentDebateEngine(
      this.aiBase,
      this.aiRobinhood,
      config.minAiConfidence ?? 78
    );

    this.minAiConfidence = config.minAiConfidence ?? 75;
    this.defaultTradeSizeEth = config.defaultTradeSizeEth ?? 0.02;
    this.onTradeSignal = config.onTradeSignal;
    this.onTradeExit = config.onTradeExit;
    this.onPartialTradeExit = config.onPartialTradeExit;

    // Initialize real-time position ticker with partial TP support
    this.ticker = new PositionTicker(
      this.tracker,
      async (position, reason, currentPrice) => {
        await this.handleExitTrigger(position, reason, currentPrice);
      },
      async (position, currentPrice, pctToSell) => {
        await this.handlePartialTPTrigger(position, currentPrice, pctToSell);
      }
    );
  }

  public getBlacklistManager(): BlacklistManager {
    return this.blacklist;
  }

  public getMemory(): SelfReflectiveMemory {
    return this.memory;
  }

  public getMacroSentinel(): MacroEthSentinel {
    return this.macroSentinel;
  }

  public getSmartMoneyRadar(): SmartMoneyRadar {
    return this.smartMoneyRadar;
  }

  public getPositionTracker(): PositionTracker {
    return this.tracker;
  }

  public getPositionTicker(): PositionTicker {
    return this.ticker;
  }

  public getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  public getExecutionEngine(): ExecutionEngine {
    return this.engine;
  }

  public getSniper(): InstantSniper {
    return this.sniper;
  }

  public isRunning(): boolean {
    return this.isEngineRunning;
  }

  public setRunning(running: boolean): void {
    this.isEngineRunning = running;
  }

  public async runScanCycle(chainId: number): Promise<number> {
    if (!this.isEngineRunning) return 0;

    const riskCheck = this.circuitBreaker.canOpenTrade();
    if (!riskCheck.allowed) {
      console.warn(`[Risk Alert] Cannot open trades: ${riskCheck.reason}`);
      return 0;
    }

    const aiClient = chainId === 8453 ? this.aiBase : this.aiRobinhood;
    const pairs = await this.scanner.scanTrendingPairs(chainId);
    let tradesOpened = 0;

    for (const pair of pairs.slice(0, 5)) {
      // 0. Auto-Blacklist Check: Skip tokens previously flagged as bad/rejected
      if (this.blacklist.isBlacklisted(pair.baseToken.address)) {
        continue;
      }

      // 1. Calculate Quantitative Microstructure Metrics
      const metrics = calculateMicrostructureMetrics(pair);

      // 2. Pre-Screening (Security, Liquidity & Anti-Dump)
      const screenResult = this.screener.screenToken({
        pairAddress: pair.pairAddress,
        liquidityUsd: pair.liquidity?.usd ?? 0,
        buyTax: 0,
        sellTax: 0,
        isHoneypot: false,
        isOpenTrading: true,
        priceChange5m: pair.priceChange?.m5,
        sellVolumeRatio: (1 - metrics.buyPressureRatio5m),
      });

      if (!screenResult.isSafe) {
        // Auto-blacklist bad tokens immediately so AI never re-evaluates them!
        await this.blacklist.addToBlacklist(pair.baseToken.address, screenResult.reasons.join(', '));
        continue;
      }

      if (!metrics.isOrderFlowBullish) continue;

      // 3. AI Scalping Evaluation (OpenRouter)
      const decision = await aiClient.evaluateToken({
        tokenName: pair.baseToken.name,
        tokenSymbol: pair.baseToken.symbol,
        tokenAddress: pair.baseToken.address,
        chainName: chainId === 8453 ? 'Base' : 'Robinhood',
        priceUsd: metrics.priceUsd,
        metrics,
      });

      if (decision.action === 'AVOID' || decision.confidence < this.minAiConfidence) {
        // Auto-blacklist tokens deemed unviable by AI
        await this.blacklist.addToBlacklist(
          pair.baseToken.address,
          `AI Rejected (${decision.confidence}%): ${decision.reasoning}`
        );
        continue;
      }

      if (decision.action === 'BUY' && decision.confidence >= this.minAiConfidence) {
        // Enforce hard-stop & max take-profit clamp (TP max 30%, SL max 10%)
        const clampedTP = this.circuitBreaker.clampTakeProfit(decision.takeProfitPct);
        const clampedSL = this.circuitBreaker.clampStopLoss(decision.stopLossPct);

        const buyResult = await this.engine.executeBuy({
          chainId,
          tokenAddress: pair.baseToken.address,
          tokenSymbol: pair.baseToken.symbol,
          amountEth: Math.min(decision.suggestedAllocEth, this.defaultTradeSizeEth),
          currentPriceUsd: metrics.priceUsd,
          takeProfitPct: clampedTP,
          stopLossPct: clampedSL,
          trailingStopPct: 3.0,
        });

        if (buyResult.success) {
          tradesOpened++;
          if (this.onTradeSignal) {
            await this.onTradeSignal({
              chainId,
              chainName: chainId === 8453 ? 'Base' : 'Robinhood',
              tokenSymbol: pair.baseToken.symbol,
              tokenAddress: pair.baseToken.address,
              entryPriceUsd: metrics.priceUsd,
              amountEth: this.defaultTradeSizeEth,
              takeProfitPct: clampedTP,
              stopLossPct: clampedSL,
              confidence: decision.confidence,
              reasoning: decision.reasoning,
              signalsDetected: decision.signalsDetected,
            });
          }
        }
      }
    }

    return tradesOpened;
  }

  private async handlePartialTPTrigger(
    position: Position,
    currentPrice: number,
    pctToSell: number
  ): Promise<void> {
    if (this.onPartialTradeExit) {
      const pnlPct = ((currentPrice - position.entryPriceUsd) / position.entryPriceUsd) * 100;
      await this.onPartialTradeExit({
        chainId: position.chainId,
        chainName: position.chainId === 8453 ? 'Base' : 'Robinhood',
        tokenSymbol: position.tokenSymbol,
        tokenAddress: position.tokenAddress,
        pctSold: pctToSell,
        currentPriceUsd: currentPrice,
        pnlPct,
      });
    }
  }

  private async handleExitTrigger(position: Position, reason: ExitReason, currentPrice: number): Promise<void> {
    const sellResult = await this.engine.executeSell(position, currentPrice, reason);
    if (sellResult.success && sellResult.realizedPnlEth !== undefined) {
      this.circuitBreaker.recordClosedTrade(sellResult.realizedPnlEth);

      const pnlPct = sellResult.realizedPnlPct ?? 0;
      const isWin = pnlPct > 0;
      const lesson = isWin
        ? `Order flow momentum follow-through on ${position.tokenSymbol} confirmed. Closed on ${reason} with profit.`
        : `Exit on ${reason} for ${position.tokenSymbol} at ${pnlPct.toFixed(1)}%. Watch out for reversal on sudden volume decay.`;

      await this.memory.recordPostMortem({
        tokenSymbol: position.tokenSymbol,
        outcome: isWin ? 'WIN' : 'LOSS',
        pnlPct,
        lessonLearned: lesson,
      });

      if (this.onTradeExit) {
        await this.onTradeExit({
          chainId: position.chainId,
          chainName: position.chainId === 8453 ? 'Base' : 'Robinhood',
          tokenSymbol: position.tokenSymbol,
          reason,
          pnlPct,
          pnlEth: sellResult.realizedPnlEth,
          closePriceUsd: currentPrice,
          txHash: sellResult.txHash,
        });
      }
    }
  }

  public startPeriodicScanner(intervalMs: number = 30000): void {
    if (this.scanTimer) return;
    this.scanTimer = setInterval(async () => {
      try {
        await this.runScanCycle(8453); // Base
        await this.runScanCycle(4663); // Robinhood
      } catch (err) {
        console.warn(`Scan cycle error: ${(err as Error).message}`);
      }
    }, intervalMs);
  }

  public stopPeriodicScanner(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }
}
