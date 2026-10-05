import { isAddress } from 'viem';
import axios from 'axios';
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

    let currentPriceUsd = req.currentPriceUsd;
    let tokenSymbol = req.tokenSymbol;

    // If price or symbol was not provided, attempt fast resolution from DexScreener
    if (!currentPriceUsd || currentPriceUsd <= 0 || !tokenSymbol) {
      try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${req.tokenAddress}`, {
          timeout: 4000,
        });
        const pairs = res.data?.pairs;
        if (pairs && pairs.length > 0) {
          const bestPair = pairs[0];
          const fetchedPrice = parseFloat(bestPair.priceUsd);
          if (!isNaN(fetchedPrice) && fetchedPrice > 0) {
            currentPriceUsd = fetchedPrice;
          }
          if (!tokenSymbol && bestPair.baseToken?.symbol) {
            tokenSymbol = bestPair.baseToken.symbol;
          }
        }
      } catch {
        // Fallback silently if dex API is unreachable
      }
    }

    const finalPriceUsd = currentPriceUsd && currentPriceUsd > 0 ? currentPriceUsd : 0.01;
    const finalSymbol = tokenSymbol || 'SNIPED';
    const amountEth = req.amountEth ?? this.defaultSnipeEth;

    return await this.engine.executeBuy({
      chainId: req.chainId,
      tokenAddress: req.tokenAddress,
      tokenSymbol: finalSymbol,
      amountEth,
      currentPriceUsd: finalPriceUsd,
      takeProfitPct: req.takeProfitPct ?? 25.0, // High TP for snipes
      stopLossPct: req.stopLossPct ?? 8.0,      // Controlled SL
      trailingStopPct: 5.0,
      slippagePct: this.sniperSlippagePct,
    });
  }
}
