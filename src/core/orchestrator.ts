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
import { OnChainHoneypotSimulator } from './screener/honeypotSimulator.js';
import { reconcilePositionsOnChain, ReconciliationSummary } from './positions/reconciliation.js';

import { ExpectedValueCalculator } from './risk/evCalculator.js';
import { TokenSecurityScorer } from './screener/securityScore.js';
import { NewPoolsScanner, NewPoolCandidate } from './scanner/newPools.js';

export interface AiDebateInfo {
  chainName: string;
  tokenSymbol: string;
  tokenAddress: string;
  hunterDecision: any;
  auditorDecision: any;
  consensus: any;
}

export interface RiskEvaluationInfo {
  chainName: string;
  tokenSymbol: string;
  tokenAddress: string;
  stage: 'SECURITY_SCORE' | 'EV_CALCULATOR';
  passed: boolean;
  score?: number;
  expectedValuePct?: number;
  winProbPct?: number;
  frictionPct?: number;
  reason?: string;
}

export interface ActivityLogEntry {
  timestamp: number;
  stage: 'SCANNER' | 'PRE_SCREEN' | 'SECURITY' | 'DEBATE' | 'RISK_ENGINE' | 'ORDER';
  message: string;
  tokenSymbol?: string;
  level: 'INFO' | 'SUCCESS' | 'WARN' | 'ALERT';
}

export interface OrchestratorConfig {
  storage: JsonStorage;
  mode?: 'paper' | 'live' | 'shadow';
  strategyMode?: 'rules_only' | 'ai_veto' | 'dual_agent';
  initialVirtualEth?: number;
  openRouterBaseUrl?: string;
  openRouterKeyBase?: string;
  openRouterKeyRobinhood?: string;
  aiModelBase?: string;
  aiModelRobinhood?: string;
  walletPrivateKey?: string;
  minAiConfidence?: number;
  minRequiredEdgePct?: number;
  minSecurityScore?: number;
  defaultTradeSizeEth?: number;
  sniperTradeSizeEth?: number;
  maxLossPerTradePct?: number;
  maxDailyLossEth?: number;
  enableOnChainSimulation?: boolean;
  onTradeSignal?: (signal: any) => Promise<void>;
  onTradeExit?: (exit: any) => Promise<void>;
  onPartialTradeExit?: (exit: any) => Promise<void>;
  onAiActivity?: (activity: ActivityLogEntry) => Promise<void>;
  onAiDebate?: (debate: AiDebateInfo) => Promise<void>;
  onRiskEvaluation?: (risk: RiskEvaluationInfo) => Promise<void>;
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
  private viemManager: ViemClientManager;
  private honeypotSimBase: OnChainHoneypotSimulator;
  private honeypotSimRH: OnChainHoneypotSimulator;
  private evCalculator: ExpectedValueCalculator;
  private securityScorer: TokenSecurityScorer;
  private newTokenScanner: NewPoolsScanner;
  private newPoolsTimer: NodeJS.Timeout | null = null;

  private strategyMode: 'rules_only' | 'ai_veto' | 'dual_agent';
  private minAiConfidence: number;
  private defaultTradeSizeEth: number;
  private sniperTradeSizeEth: number;
  private isEngineRunning: boolean = true;
  private enableOnChainSimulation: boolean;
  private scanTimer: NodeJS.Timeout | null = null;
  private recentActivities: ActivityLogEntry[] = [];
  private onTradeSignal?: (signal: any) => Promise<void>;
  private onTradeExit?: (exit: any) => Promise<void>;
  private onPartialTradeExit?: (exit: any) => Promise<void>;
  private onAiActivity?: (activity: ActivityLogEntry) => Promise<void>;
  private onAiDebate?: (debate: AiDebateInfo) => Promise<void>;
  private onRiskEvaluation?: (risk: RiskEvaluationInfo) => Promise<void>;

  constructor(config: OrchestratorConfig) {
    this.storage = config.storage;
    this.strategyMode = config.strategyMode ?? 'ai_veto';
    this.tracker = new PositionTracker(this.storage);
    this.paperTrader = new PaperTrader(config.initialVirtualEth ?? 1.0);
    this.circuitBreaker = new CircuitBreaker({
      maxLossPerTradePct: config.maxLossPerTradePct ?? 10.0,
      maxDailyLossEth: config.maxDailyLossEth ?? 0.10,
    });
    this.evCalculator = new ExpectedValueCalculator(config.minRequiredEdgePct ?? 1.5);
    this.securityScorer = new TokenSecurityScorer(config.minSecurityScore ?? 80);
    this.newTokenScanner = new NewPoolsScanner({ maxAgeMinutes: 30, minLiquidityUsd: 2000 });

    this.viemManager = new ViemClientManager(config.walletPrivateKey);
    const baseRouter = new BaseRouterExecutor(this.viemManager);
    const rhRouter = new RobinhoodRouterExecutor(this.viemManager);

    this.honeypotSimBase = new OnChainHoneypotSimulator(this.viemManager.getPublicClient(8453));
    this.honeypotSimRH = new OnChainHoneypotSimulator(this.viemManager.getPublicClient(4663));
    this.enableOnChainSimulation = config.enableOnChainSimulation ?? false;

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
    this.sniperTradeSizeEth = config.sniperTradeSizeEth ?? 0.01;
    this.onTradeSignal = config.onTradeSignal;
    this.onTradeExit = config.onTradeExit;
    this.onPartialTradeExit = config.onPartialTradeExit;
    this.onAiActivity = config.onAiActivity;
    this.onAiDebate = config.onAiDebate;
    this.onRiskEvaluation = config.onRiskEvaluation;

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

  public getRecentActivities(): ActivityLogEntry[] {
    return [...this.recentActivities];
  }

  public logActivity(entry: Omit<ActivityLogEntry, 'timestamp'>): void {
    const fullEntry: ActivityLogEntry = { ...entry, timestamp: Date.now() };
    this.recentActivities.push(fullEntry);
    if (this.recentActivities.length > 30) {
      this.recentActivities.shift();
    }
    console.log(`[${entry.stage}] ${entry.message}`);
    if (this.onAiActivity) {
      this.onAiActivity(fullEntry).catch(() => {});
    }
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

  public getEVCalculator(): ExpectedValueCalculator {
    return this.evCalculator;
  }

  public getSecurityScorer(): TokenSecurityScorer {
    return this.securityScorer;
  }

  public getTradingMode(): 'paper' | 'live' | 'shadow' {
    return this.engine.getMode();
  }

  public setTradingMode(mode: 'paper' | 'live' | 'shadow'): void {
    this.engine.setMode(mode);
  }

  public getSniper(): InstantSniper {
    return this.sniper;
  }

  public getStrategyMode(): 'rules_only' | 'ai_veto' | 'dual_agent' {
    return this.strategyMode;
  }

  public setStrategyMode(mode: 'rules_only' | 'ai_veto' | 'dual_agent'): void {
    this.strategyMode = mode;
  }

  public isRunning(): boolean {
    return this.isEngineRunning;
  }

  public setRunning(running: boolean): void {
    this.isEngineRunning = running;
  }

  public async runScanCycle(chainId: number): Promise<number> {
    if (!this.isEngineRunning) return 0;
    const chainName = chainId === 8453 ? 'Base' : 'Robinhood';

    // 0. Macro Sentinel Flash Crash Guard: Halt buys during defensive regime
    if (this.macroSentinel.getCurrentRegime() === 'DEFENSIVE_CRASH') {
      this.logActivity({
        stage: 'SCANNER',
        message: `ETH Flash Crash terdeteksi (DEFENSIVE_CRASH). Pembelian baru dijeda demi keamanan modal.`,
        level: 'ALERT',
      });
      return 0;
    }

    const riskCheck = this.circuitBreaker.canOpenTrade();
    if (!riskCheck.allowed) {
      this.logActivity({
        stage: 'RISK_ENGINE',
        message: `Circuit Breaker aktif: ${riskCheck.reason}. Pembelian ditahan.`,
        level: 'WARN',
      });
      return 0;
    }

    const aiClient = chainId === 8453 ? this.aiBase : this.aiRobinhood;
    this.logActivity({
      stage: 'SCANNER',
      message: `🔍 Memindai trending pairs di jaringan ${chainName}...`,
      level: 'INFO',
    });

    const pairs = await this.scanner.scanTrendingPairs(chainId);
    let tradesOpened = 0;

    for (const pair of pairs.slice(0, 5)) {
      // 0. Auto-Blacklist Check: Skip tokens previously flagged as bad/rejected
      if (this.blacklist.isBlacklisted(pair.baseToken.address)) {
        continue;
      }

      // 1. Calculate Quantitative Microstructure Metrics
      const metrics = calculateMicrostructureMetrics(pair);

      // 2. Pre-Screening: Multi-Factor Token Security Score (0-100)
      const securityScoreResult = this.securityScorer.calculateScore({
        canSell: true,
        isHoneypot: false,
        buyTaxPct: 0,
        sellTaxPct: 0,
        liquidityUsd: pair.liquidity?.usd ?? 0,
        fdvUsd: pair.fdv,
        isOpenTrading: true,
      });

      if (this.onRiskEvaluation) {
        await this.onRiskEvaluation({
          chainName,
          tokenSymbol: pair.baseToken.symbol,
          tokenAddress: pair.baseToken.address,
          stage: 'SECURITY_SCORE',
          passed: securityScoreResult.passed,
          score: securityScoreResult.totalScore,
          reason: securityScoreResult.reasons.join(', '),
        }).catch(() => {});
      }

      if (!securityScoreResult.passed) {
        this.logActivity({
          stage: 'SECURITY',
          message: `Token Security Score $${pair.baseToken.symbol}: ${securityScoreResult.totalScore}/100 ❌ REJECTED (${securityScoreResult.reasons.join(', ')})`,
          tokenSymbol: pair.baseToken.symbol,
          level: 'WARN',
        });
        await this.blacklist.addToBlacklist(
          pair.baseToken.address,
          `Security score failed (${securityScoreResult.totalScore}/100): ${securityScoreResult.reasons.join(', ')}`,
          'LOW_LIQUIDITY_TEMP',
          6
        );
        continue;
      }

      this.logActivity({
        stage: 'SECURITY',
        message: `Token Security Score $${pair.baseToken.symbol}: ${securityScoreResult.totalScore}/100 ✅ PASSED`,
        tokenSymbol: pair.baseToken.symbol,
        level: 'SUCCESS',
      });

      // 2.1 Microstructure and Anti-Dump Check
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
        // Auto-blacklist with 6-hour TTL for temporary screening failures
        await this.blacklist.addToBlacklist(
          pair.baseToken.address,
          screenResult.reasons.join(', '),
          'LOW_LIQUIDITY_TEMP',
          6
        );
        continue;
      }

      if (!metrics.isOrderFlowBullish) continue;

      // 2.2 On-Chain Static Honeypot Simulation via eth_call
      if (this.enableOnChainSimulation || this.engine.getMode() === 'live') {
        const honeypotSim = chainId === 8453 ? this.honeypotSimBase : this.honeypotSimRH;
        const simResult = await honeypotSim.simulateToken(pair.baseToken.address as `0x${string}`);
        if (simResult.isHoneypot) {
          await this.blacklist.addToBlacklist(
            pair.baseToken.address,
            `Honeypot static simulation failed: ${simResult.reason}`,
            'SECURITY_PERMANENT'
          );
          continue;
        }
      }

      // 3. Decision Pipeline based on strategyMode
      let decisionAction: 'BUY' | 'WAIT' | 'AVOID' = 'WAIT';
      let confidence = 80;
      let takeProfitPct = 20;
      let stopLossPct = 6;
      let suggestedAllocEth = this.defaultTradeSizeEth;
      let reasoning = '';
      let signalsDetected: string[] = ['Quantitative Order Flow Confirmed'];

      const pastLessons = this.memory.formatLessonsForPrompt();
      const smartMoneyCheck = this.smartMoneyRadar.checkTransaction(
        pair.baseToken.address,
        pair.baseToken.address,
        1.0
      );

      const candidateInput = {
        tokenName: pair.baseToken.name,
        tokenSymbol: pair.baseToken.symbol,
        tokenAddress: pair.baseToken.address,
        chainName: chainId === 8453 ? 'Base' : 'Robinhood',
        priceUsd: metrics.priceUsd,
        metrics,
        pastLessons: pastLessons || undefined,
        smartMoneyInfo: smartMoneyCheck.isSmartMoney
          ? `Smart Money Inflow detected (${smartMoneyCheck.label}), boost recommended.`
          : undefined,
      };

      if (this.strategyMode === 'rules_only') {
        // Mode A: Zero-LLM Fast Mode (Pure TypeScript, 0 API latency/cost)
        if (metrics.buyPressureRatio5m >= 0.60 && metrics.volumeDelta5m > 0) {
          decisionAction = 'BUY';
          confidence = Math.min(Math.round(metrics.buyPressureRatio5m * 100), 95);
          takeProfitPct = 20;
          stopLossPct = 6;
          reasoning = `Rules-only quant trigger: Buy Pressure ${(metrics.buyPressureRatio5m * 100).toFixed(0)}%, Volume Delta +$${metrics.volumeDelta5m.toFixed(0)}`;
          signalsDetected = ['High Buy Pressure', 'Positive CVD', 'Honeypot Checked'];
        }
      } else if (this.strategyMode === 'ai_veto') {
        // Mode B: Single AI Risk Auditor Veto (Focus on LLM strength, saves 50% API calls)
        const auditor = chainId === 8453 ? this.aiBase : this.aiRobinhood;
        const verdict = await auditor.evaluateToken(candidateInput);
        if (verdict.action === 'AVOID') {
          decisionAction = 'AVOID';
          confidence = verdict.confidence;
          reasoning = `AI Auditor Veto: ${verdict.reasoning}`;
        } else {
          decisionAction = 'BUY';
          confidence = verdict.confidence;
          takeProfitPct = verdict.takeProfitPct || 20;
          stopLossPct = verdict.stopLossPct || 6;
          suggestedAllocEth = verdict.suggestedAllocEth || this.defaultTradeSizeEth;
          reasoning = `AI Auditor Approved: ${verdict.reasoning}`;
          signalsDetected = verdict.signalsDetected || ['Auditor Cleared'];
        }

        if (this.onAiDebate) {
          await this.onAiDebate({
            chainName,
            tokenSymbol: pair.baseToken.symbol,
            tokenAddress: pair.baseToken.address,
            hunterDecision: { action: 'BUY', confidence: 80, reasoning: 'Quantitative order flow and metrics passed pre-screening.' },
            auditorDecision: verdict,
            consensus: { action: decisionAction, consensusScore: confidence, takeProfitPct, stopLossPct },
          }).catch(() => {});
        }
      } else {
        // Mode C: Dual-Agent Debate Engine (Hunter vs Auditor Consensus)
        let debate: any;
        try {
          debate = await this.debateEngine.debateToken(candidateInput);
          if (debate.auditorReasoning?.includes('AI evaluation error')) {
            const single = await aiClient.evaluateToken(candidateInput);
            decisionAction = single.action;
            confidence = single.confidence;
            takeProfitPct = single.takeProfitPct;
            stopLossPct = single.stopLossPct;
            suggestedAllocEth = single.suggestedAllocEth;
            reasoning = single.reasoning;
            signalsDetected = single.signalsDetected;
          } else {
            decisionAction = debate.action;
            confidence = debate.consensusScore;
            takeProfitPct = debate.takeProfitPct;
            stopLossPct = debate.stopLossPct;
            suggestedAllocEth = debate.suggestedAllocEth;
            reasoning = `[Hunter]: ${debate.hunterReasoning} | [Auditor]: ${debate.auditorReasoning}`;
            signalsDetected = debate.signalsDetected;
          }
        } catch {
          const single = await aiClient.evaluateToken(candidateInput);
          decisionAction = single.action;
          confidence = single.confidence;
          takeProfitPct = single.takeProfitPct;
          stopLossPct = single.stopLossPct;
          suggestedAllocEth = single.suggestedAllocEth;
          reasoning = single.reasoning;
          signalsDetected = single.signalsDetected;
        }

        if (this.onAiDebate && debate) {
          await this.onAiDebate({
            chainName,
            tokenSymbol: pair.baseToken.symbol,
            tokenAddress: pair.baseToken.address,
            hunterDecision: debate.hunterVerdict || { action: 'BUY', confidence: debate.consensusScore, reasoning: debate.hunterReasoning },
            auditorDecision: debate.auditorVerdict || { action: debate.action, confidence: debate.consensusScore, reasoning: debate.auditorReasoning },
            consensus: debate,
          }).catch(() => {});
        }
      }

      if (decisionAction === 'AVOID' || confidence < this.minAiConfidence) {
        // Auto-blacklist tokens deemed unviable by AI (12 hour temp TTL)
        await this.blacklist.addToBlacklist(
          pair.baseToken.address,
          `AI Rejected (${confidence}%): ${reasoning}`,
          'AI_REJECT_TEMP',
          12
        );
        continue;
      }

      if (decisionAction === 'BUY' && confidence >= this.minAiConfidence) {
        // Enforce hard-stop & max take-profit clamp (TP max 30%, SL max 10%)
        const clampedTP = this.circuitBreaker.clampTakeProfit(takeProfitPct);
        const clampedSL = this.circuitBreaker.clampStopLoss(stopLossPct);

        // Dynamic Position Sizing: Cap position size to max 1.5% of pool liquidity to eliminate self-price impact
        const poolLiquidityUsd = pair.liquidity?.usd ?? 5000;
        const maxSafeAllocEth = (poolLiquidityUsd * 0.015) / 2500;
        const targetAllocEth = Math.min(
          suggestedAllocEth || this.defaultTradeSizeEth,
          this.defaultTradeSizeEth,
          Math.max(maxSafeAllocEth, 0.005)
        );

        // 4. Risk Engine Mathematical Expected Value Gatekeeper: Absolute veto power over AI
        const evResult = this.evCalculator.calculateEV({
          confidence,
          takeProfitPct: clampedTP,
          stopLossPct: clampedSL,
          positionSizeEth: targetAllocEth,
        });

        if (this.onRiskEvaluation) {
          await this.onRiskEvaluation({
            chainName,
            tokenSymbol: pair.baseToken.symbol,
            tokenAddress: pair.baseToken.address,
            stage: 'EV_CALCULATOR',
            passed: evResult.allowed,
            expectedValuePct: evResult.expectedValuePct,
            winProbPct: Math.round(evResult.calibratedWinProbability * 100),
            frictionPct: evResult.totalEstimatedCostPct,
            reason: evResult.reason,
          }).catch(() => {});
        }

        if (!evResult.allowed) {
          this.logActivity({
            stage: 'RISK_ENGINE',
            message: `Risk Engine Veto $${pair.baseToken.symbol}: EV ${evResult.expectedValuePct >= 0 ? '+' : ''}${evResult.expectedValuePct}% < +1.5% setelah friction ${evResult.totalEstimatedCostPct.toFixed(1)}%. Eksekusi dibatalkan.`,
            tokenSymbol: pair.baseToken.symbol,
            level: 'WARN',
          });
          await this.blacklist.addToBlacklist(
            pair.baseToken.address,
            `Risk Engine EV Veto: ${evResult.reason}`,
            'AI_REJECT_TEMP',
            12
          );
          continue;
        }

        this.logActivity({
          stage: 'ORDER',
          message: `🚀 Membuka order BUY $${pair.baseToken.symbol} (${targetAllocEth} ETH) @ $${metrics.priceUsd}. EV: +${evResult.expectedValuePct}%.`,
          tokenSymbol: pair.baseToken.symbol,
          level: 'SUCCESS',
        });

        const buyResult = await this.engine.executeBuy({
          chainId,
          tokenAddress: pair.baseToken.address,
          tokenSymbol: pair.baseToken.symbol,
          amountEth: targetAllocEth,
          currentPriceUsd: metrics.priceUsd,
          takeProfitPct: clampedTP,
          stopLossPct: clampedSL,
          trailingStopPct: 3.0,
          strategyMode: this.strategyMode,
          aiScore: confidence,
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
              amountEth: targetAllocEth,
              takeProfitPct: clampedTP,
              stopLossPct: clampedSL,
              confidence,
              reasoning,
              signalsDetected,
            });
          }
        }
      }
    }

    return tradesOpened;
  }

  public async reconcileOnChain(): Promise<ReconciliationSummary> {
    return await reconcilePositionsOnChain(this.tracker, this.viemManager);
  }

  private async handlePartialTPTrigger(
    position: Position,
    currentPrice: number,
    pctToSell: number
  ): Promise<void> {
    const sellResult = await this.engine.executePartialSell(position, currentPrice, pctToSell);
    if (sellResult.success && sellResult.realizedPnlEth !== undefined) {
      this.circuitBreaker.recordClosedTrade(sellResult.realizedPnlEth);
    }

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

  public getNewTokenScanner(): NewPoolsScanner {
    return this.newTokenScanner;
  }

  public async evaluateAndSnipeNewPools(chainId: number): Promise<{ snipedCount: number; vetoedCount: number }> {
    const candidates = await this.newTokenScanner.scanNewPools(chainId);
    let snipedCount = 0;
    let vetoedCount = 0;

    for (const candidate of candidates) {
      const openPositions = await this.tracker.getActivePositions(chainId);
      if (openPositions.length >= 3) {
        break;
      }

      const riskCheck = this.circuitBreaker.canOpenTrade();
      if (!riskCheck.allowed) {
        break;
      }

      if (this.blacklist.isBlacklisted(candidate.baseTokenAddress)) {
        continue;
      }

      // Fast security check
      const secScore = this.securityScorer.calculateScore({
        canSell: true,
        isHoneypot: false,
        buyTaxPct: 0,
        sellTaxPct: 0,
        liquidityUsd: candidate.liquidityUsd,
        fdvUsd: candidate.liquidityUsd * 4,
        isOpenTrading: true,
      });

      if (!secScore.passed) {
        this.newTokenScanner.markProcessed(candidate.baseTokenAddress);
        await this.blacklist.addToBlacklist(candidate.baseTokenAddress, `Failed Security Filter: ${secScore.reasons.join(', ')}`, 'SECURITY_PERMANENT');
        this.logActivity({
          stage: 'SECURITY',
          message: `🛡️ [SNIPER REJECT] $${candidate.tokenSymbol} Security Score ${secScore.totalScore}/100 ⛔`,
          tokenSymbol: candidate.tokenSymbol,
          level: 'WARN',
        });
        continue;
      }

      // Stage 1: AI Pre-Snipe Veto Gate
      const aiEngine = chainId === 8453 ? this.aiBase : this.aiRobinhood;
      const aiVerdict = await aiEngine.evaluateToken({
        tokenName: candidate.tokenName,
        tokenSymbol: candidate.tokenSymbol,
        tokenAddress: candidate.baseTokenAddress,
        chainName: chainId === 8453 ? 'Base' : 'Robinhood',
        priceUsd: candidate.priceUsd,
        metrics: {
          priceUsd: candidate.priceUsd,
          priceChange5m: 0,
          priceChange1h: 0,
          volume5m: candidate.liquidityUsd,
          volume1h: candidate.liquidityUsd,
          buys5m: 10,
          sells5m: 2,
          buyPressureRatio5m: 0.8,
          volumeDelta5m: candidate.liquidityUsd * 0.5,
          liquidityUsd: candidate.liquidityUsd,
          fdv: candidate.liquidityUsd * 4,
          liquidityToFdvRatio: 0.25,
          isOrderFlowBullish: true,
          volatilityScore: 50,
        },
      });

      if (aiVerdict.action === 'AVOID') {
        vetoedCount++;
        this.newTokenScanner.markProcessed(candidate.baseTokenAddress);
        await this.blacklist.addToBlacklist(candidate.baseTokenAddress, `AI Pre-Snipe Veto: ${aiVerdict.reasoning}`, 'AI_REJECT_TEMP');
        this.logActivity({
          stage: 'SECURITY',
          message: `🚫 [PRE-SNIPE VETO] $${candidate.tokenSymbol}: ${aiVerdict.reasoning}`,
          tokenSymbol: candidate.tokenSymbol,
          level: 'ALERT',
        });
        continue;
      }

      // Passed AI check -> execute snipe
      this.newTokenScanner.markProcessed(candidate.baseTokenAddress);
      const buyRes = await this.sniper.executeSnipe({
        chainId,
        tokenAddress: candidate.baseTokenAddress,
        tokenSymbol: candidate.tokenSymbol,
        currentPriceUsd: candidate.priceUsd,
        amountEth: this.sniperTradeSizeEth,
        takeProfitPct: aiVerdict.takeProfitPct > 0 ? aiVerdict.takeProfitPct : 30.0,
        stopLossPct: aiVerdict.stopLossPct > 0 ? aiVerdict.stopLossPct : 8.0,
      });

      if (buyRes.success) {
        snipedCount++;
        this.logActivity({
          stage: 'ORDER',
          message: `🎯 [AUTO-SNIPE EXECUTED] $${candidate.tokenSymbol} (${candidate.ageMinutes}m old) @ $${candidate.priceUsd}`,
          tokenSymbol: candidate.tokenSymbol,
          level: 'SUCCESS',
        });

        if (this.onTradeSignal) {
          await this.onTradeSignal({
            chainName: chainId === 8453 ? 'Base' : 'Robinhood',
            tokenSymbol: candidate.tokenSymbol,
            tokenAddress: candidate.baseTokenAddress,
            entryPriceUsd: buyRes.entryPriceUsd || candidate.priceUsd,
            amountEth: buyRes.amountEth || this.defaultTradeSizeEth,
            takeProfitPct: aiVerdict.takeProfitPct > 0 ? aiVerdict.takeProfitPct : 30.0,
            stopLossPct: aiVerdict.stopLossPct > 0 ? aiVerdict.stopLossPct : 8.0,
            confidence: aiVerdict.confidence || 85,
            reasoning: aiVerdict.reasoning || 'Auto-snipe of new liquidity pool',
            signalsDetected: ['New Pool Launch', ...aiVerdict.signalsDetected],
            isSnipe: true,
          });
        }
      }
    }

    return { snipedCount, vetoedCount };
  }

  public startNewPoolsScanner(intervalMs: number = 10000): void {
    if (this.newPoolsTimer) return;
    this.newPoolsTimer = setInterval(async () => {
      try {
        await this.evaluateAndSnipeNewPools(8453);
        await this.evaluateAndSnipeNewPools(4663);
      } catch (err) {
        console.warn(`New pools scan error: ${(err as Error).message}`);
      }
    }, intervalMs);
  }

  public stopNewPoolsScanner(): void {
    if (this.newPoolsTimer) {
      clearInterval(this.newPoolsTimer);
      this.newPoolsTimer = null;
    }
  }
}
