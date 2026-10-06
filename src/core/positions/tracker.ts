import { JsonStorage } from '../../storage/db.js';

export interface Position {
  id: string;
  chainId: number;
  tokenAddress: string;
  tokenSymbol: string;
  entryPriceUsd: number;
  amountTokens: number;
  costEth: number;
  takeProfitPct: number;
  stopLossPct: number;
  trailingStopPct?: number;
  highestPriceSeen?: number;
  partialTakeProfitDone?: boolean;
  mode: 'paper' | 'live' | 'shadow';
  strategyMode?: 'rules_only' | 'ai_veto' | 'dual_agent';
  aiScore?: number;
  isSniperPosition?: boolean;
  status: 'OPEN' | 'CLOSED';
  openedAt: number;
  closedAt?: number;
  closePriceUsd?: number;
  realizedPnlEth?: number;
  realizedPnlPct?: number;
  closeReason?: string;
  txHash?: string;
}

export class PositionTracker {
  private storage: JsonStorage;

  constructor(storage: JsonStorage) {
    this.storage = storage;
  }

  public async openPosition(pos: Position): Promise<Position> {
    pos.highestPriceSeen = pos.entryPriceUsd;
    let openFailed = false;
    
    this.storage.update((data) => {
      // Atomic: Check concurrent limit + duplicate + insert in one transaction
      const activePositions = data.positions.filter((p: Position) => p.status === 'OPEN');
      
      // 1. Check concurrent position limit (prevent race condition overflow)
      const maxConcurrent = 3; // Should be injected from config, but atomic check is critical
      if (activePositions.length >= maxConcurrent) {
        openFailed = true;
        return;
      }
      
      // 2. Defensive duplicate check: do not push if token is already open
      const isAlreadyOpen = activePositions.some(
        (p: Position) => p.tokenAddress.toLowerCase() === pos.tokenAddress.toLowerCase()
      );
      if (!isAlreadyOpen) {
        data.positions.push(pos);
      } else {
        openFailed = true;
      }
    });
    
    if (openFailed) {
      throw new Error(`Cannot open position: concurrent limit exceeded or duplicate token already open`);
    }
    
    return pos;
  }

  public async hasOpenPositionForToken(tokenAddress: string): Promise<boolean> {
    const active = await this.getActivePositions();
    const normalized = tokenAddress.toLowerCase();
    return active.some((p) => p.tokenAddress.toLowerCase() === normalized);
  }

  public async hasOpenPositionForSymbol(symbol: string): Promise<boolean> {
    const active = await this.getActivePositions();
    const cleanTarget = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return active.some((p) => {
      const cleanExisting = p.tokenSymbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
      return cleanExisting === cleanTarget;
    });
  }

  public async getActivePositionsCount(chainId?: number): Promise<number> {
    const active = await this.getActivePositions(chainId);
    return active.length;
  }

  public async getActivePositions(chainId?: number): Promise<Position[]> {
    const positions = this.storage.getData().positions as Position[];
    return positions.filter((p) => p.status === 'OPEN' && (chainId ? p.chainId === chainId : true));
  }

  public async getPositionById(id: string): Promise<Position | undefined> {
    const positions = this.storage.getData().positions as Position[];
    return positions.find((p) => p.id === id);
  }

  public async closePosition(
    id: string,
    closePriceUsd: number,
    reason: string,
    realizedPnlEth?: number
  ): Promise<Position | null> {
    let closed: Position | null = null;
    this.storage.update((data) => {
      const pos = data.positions.find((p: Position) => p.id === id);
      if (pos && pos.status === 'OPEN') {
        pos.status = 'CLOSED';
        pos.closedAt = Date.now();
        pos.closePriceUsd = closePriceUsd;
        pos.closeReason = reason;

        const pnlPct = ((closePriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
        pos.realizedPnlPct = pnlPct;
        pos.realizedPnlEth = realizedPnlEth ?? pos.costEth * (pnlPct / 100);

        data.trades.push({ ...pos });
        closed = pos;
      }
    });
    return closed;
  }

  public async updateHighestPrice(id: string, priceUsd: number): Promise<void> {
    this.storage.update((data) => {
      const pos = data.positions.find((p: Position) => p.id === id);
      if (pos && (!pos.highestPriceSeen || priceUsd > pos.highestPriceSeen)) {
        pos.highestPriceSeen = priceUsd;
      }
    });
  }

  public async markPartialTakeProfit(
    id: string,
    newStopLossPct: number = -1.0,
    fractionSold: number = 0.5
  ): Promise<void> {
    this.storage.update((data) => {
      const pos = data.positions.find((p: Position) => p.id === id);
      if (pos) {
        pos.partialTakeProfitDone = true;
        pos.stopLossPct = newStopLossPct; // Set Stop Loss to +1% profit (Breakeven)
        pos.amountTokens = pos.amountTokens * (1 - fractionSold);
        pos.costEth = pos.costEth * (1 - fractionSold);
      }
    });
  }
}
