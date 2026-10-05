import { isAddress } from 'viem';
import { ExecutionEngine } from '../execution/engine.js';
import { BuyResult } from '../execution/types.js';

export interface SnipeOptions {
  defaultSnipeEth?: number;
  sniperSlippagePct?: number;
}

export interface SnipeRequest {
  chainId: number;
  tokenAddress: string;
  tokenSymbol?: string;
  currentPriceUsd?: number;
  amountEth?: number;
  takeProfitPct?: number;
  stopLossPct?: number;
}

export class InstantSniper {
  private engine: ExecutionEngine;
  private defaultSnipeEth: number;
  private sniperSlippagePct: number;

  constructor(engine: ExecutionEngine, options: SnipeOptions = {}) {
    this.engine = engine;
    this.defaultSnipeEth = options.defaultSnipeEth ?? 0.03;
    this.sniperSlippagePct = options.sniperSlippagePct ?? 15.0;
  }

  public async executeSnipe(req: SnipeRequest): Promise<BuyResult> {
    if (!isAddress(req.tokenAddress)) {
      return {
        success: false,
        error: `Invalid EVM contract address: ${req.tokenAddress}`,
      };
    }

    const amountEth = req.amountEth ?? this.defaultSnipeEth;
    const currentPriceUsd = req.currentPriceUsd ?? 0.01;

    return await this.engine.executeBuy({
      chainId: req.chainId,
      tokenAddress: req.tokenAddress,
      tokenSymbol: req.tokenSymbol || 'SNIPED',
      amountEth,
      currentPriceUsd,
      takeProfitPct: req.takeProfitPct ?? 25.0, // High TP for snipes
      stopLossPct: req.stopLossPct ?? 8.0,      // Controlled SL
      trailingStopPct: 5.0,
      slippagePct: this.sniperSlippagePct,
    });
  }
}
