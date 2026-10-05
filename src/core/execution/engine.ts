import { PaperTrader } from './paperTrader.js';
import { BaseRouterExecutor } from './routers/baseRouter.js';
import { RobinhoodRouterExecutor } from './routers/rhRouter.js';
import { PositionTracker, Position } from '../positions/tracker.js';
import { BuyOrderParams, BuyResult, SellResult } from './types.js';

export interface ExecutionEngineConfig {
  mode: 'paper' | 'live' | 'shadow';
  paperTrader: PaperTrader;
  tracker: PositionTracker;
  baseRouter?: BaseRouterExecutor;
  rhRouter?: RobinhoodRouterExecutor;
}

export class ExecutionEngine {
  private mode: 'paper' | 'live' | 'shadow';
  private paperTrader: PaperTrader;
  private tracker: PositionTracker;
  private baseRouter?: BaseRouterExecutor;
  private rhRouter?: RobinhoodRouterExecutor;

  constructor(config: ExecutionEngineConfig) {
    this.mode = config.mode;
    this.paperTrader = config.paperTrader;
    this.tracker = config.tracker;
    this.baseRouter = config.baseRouter;
    this.rhRouter = config.rhRouter;
  }

  public getMode(): 'paper' | 'live' | 'shadow' {
    return this.mode;
  }

  public setMode(mode: 'paper' | 'live' | 'shadow'): void {
    this.mode = mode;
  }

  public async executeBuy(order: BuyOrderParams): Promise<BuyResult> {
    let result: BuyResult;

    if (this.mode === 'paper' || this.mode === 'shadow') {
      result = await this.paperTrader.simulateBuy(order, this.mode === 'shadow');
    } else {
      if (order.chainId === 8453) {
        if (!this.baseRouter) throw new Error('Base router executor not initialized');
        result = await this.baseRouter.executeBuy(order);
      } else {
        if (!this.rhRouter) throw new Error('Robinhood router executor not initialized');
        result = await this.rhRouter.executeBuy(order);
      }
    }

    if (result.success && result.amountTokens) {
      const positionId = `pos_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await this.tracker.openPosition({
        id: positionId,
        chainId: order.chainId,
        tokenAddress: order.tokenAddress,
        tokenSymbol: order.tokenSymbol,
        entryPriceUsd: result.filledPriceUsd || order.currentPriceUsd,
        amountTokens: result.amountTokens,
        costEth: order.amountEth,
        takeProfitPct: order.takeProfitPct,
        stopLossPct: order.stopLossPct,
        trailingStopPct: order.trailingStopPct,
        mode: this.mode,
        strategyMode: order.strategyMode,
        aiScore: order.aiScore,
        status: 'OPEN',
        openedAt: Date.now(),
        txHash: result.txHash,
      });

      result.positionId = positionId;
    }

    return result;
  }

  public async executeSell(
    position: Position,
    currentPriceUsd: number,
    reason: string
  ): Promise<SellResult> {
    let result: SellResult;

    if (position.mode === 'paper' || position.mode === 'shadow') {
      result = await this.paperTrader.simulateSell(position, currentPriceUsd, position.mode === 'shadow');
    } else {
      if (position.chainId === 8453) {
        if (!this.baseRouter) throw new Error('Base router not initialized');
        result = await this.baseRouter.executeSell(position, currentPriceUsd);
      } else {
        if (!this.rhRouter) throw new Error('Robinhood router not initialized');
        result = await this.rhRouter.executeSell(position, currentPriceUsd);
      }
    }

    if (result.success) {
      await this.tracker.closePosition(
        position.id,
        result.filledPriceUsd || currentPriceUsd,
        reason,
        result.realizedPnlEth
      );
    }

    return result;
  }

  public async executePartialSell(
    position: Position,
    currentPriceUsd: number,
    pctToSell: number = 50
  ): Promise<SellResult> {
    // BUG-05 FIX: Use position.mode (stored at open time) not this.mode (current engine mode)
    // This prevents paper positions from being routed to live on-chain executors when mode switches
    if (position.mode === 'paper' || position.mode === 'shadow') {
      return await this.paperTrader.simulatePartialSell(
        position,
        currentPriceUsd,
        pctToSell,
        position.mode === 'shadow'
      );
    } else {
      const fraction = pctToSell / 100;
      const partialPos: Position = {
        ...position,
        amountTokens: position.amountTokens * fraction,
        costEth: position.costEth * fraction,
      };

      if (position.chainId === 8453) {
        if (!this.baseRouter) throw new Error('Base router not initialized');
        return await this.baseRouter.executeSell(partialPos, currentPriceUsd);
      } else {
        if (!this.rhRouter) throw new Error('Robinhood router not initialized');
        return await this.rhRouter.executeSell(partialPos, currentPriceUsd);
      }
    }
  }
}
