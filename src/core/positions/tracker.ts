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
  mode: 'paper' | 'live';
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
    this.storage.update((data) => {
      data.positions.push(pos);
    });
    return pos;
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
}
