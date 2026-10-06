import axios from 'axios';
import { TokenSecurityFactors } from '../screener/securityScore.js';

export interface GoPlusTokenResponse {
  is_honeypot?: string;
  buy_tax?: string;
  sell_tax?: string;
  cannot_sell_all?: string;
  is_open_trading?: string;
  holder_count?: string;
  holders?: Array<{ percent?: string; balance?: string; address?: string }>;
}

export class TokenSecurityService {
  private cache: Map<string, { data: TokenSecurityFactors; timestamp: number }> = new Map();
  private cacheTtlMs: number = 5 * 60 * 1000; // 5 minutes

  /**
   * Fetches real token security parameters from GoPlus Security API (with in-memory cache and fallback).
   */
  public async fetchSecurityData(
    chainId: number,
    tokenAddress: string,
    existingLiquidityUsd: number = 0,
    existingFdvUsd?: number
  ): Promise<TokenSecurityFactors> {
    const cacheKey = `${chainId}:${tokenAddress.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return {
        ...cached.data,
        liquidityUsd: existingLiquidityUsd || cached.data.liquidityUsd,
        fdvUsd: existingFdvUsd ?? cached.data.fdvUsd,
      };
    }

    try {
      const rawData = await this.fetchFromGoPlus(chainId, tokenAddress);
      if (rawData) {
        const isHoneypot = rawData.is_honeypot === '1';
        const cannotSell = rawData.cannot_sell_all === '1';
        const isOpenTrading = rawData.is_open_trading !== '0';
        const buyTaxPct = parseFloat(rawData.buy_tax || '0') * 100;
        const sellTaxPct = parseFloat(rawData.sell_tax || '0') * 100;
        const holderCount = rawData.holder_count ? parseInt(rawData.holder_count, 10) : undefined;

        let top10HolderPct: number | undefined;
        if (rawData.holders && Array.isArray(rawData.holders)) {
          const top10 = rawData.holders.slice(0, 10);
          const sumPct = top10.reduce((acc, h) => acc + (parseFloat(h.percent || '0') * 100), 0);
          top10HolderPct = Math.round(sumPct * 10) / 10;
        }

        const factors: TokenSecurityFactors = {
          canSell: !isHoneypot && !cannotSell,
          isHoneypot,
          buyTaxPct,
          sellTaxPct,
          liquidityUsd: existingLiquidityUsd,
          fdvUsd: existingFdvUsd,
          isOpenTrading,
          holderCount,
          top10HolderPct,
        };

        this.cache.set(cacheKey, { data: factors, timestamp: Date.now() });
        return factors;
      }
    } catch (err) {
      // Graceful fallback on network timeout or unsupported chain
    }

    // Default conservative fallback
    const fallbackFactors: TokenSecurityFactors = {
      canSell: true,
      isHoneypot: false,
      buyTaxPct: 0,
      sellTaxPct: 0,
      liquidityUsd: existingLiquidityUsd,
      fdvUsd: existingFdvUsd,
      isOpenTrading: true,
    };

    return fallbackFactors;
  }

  protected async fetchFromGoPlus(chainId: number, tokenAddress: string): Promise<GoPlusTokenResponse | null> {
    // GoPlus supports Base (chainId 8453)
    const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${tokenAddress}`;
    const res = await axios.get(url, { timeout: 3500 });
    const resultObj = res.data?.result;
    if (resultObj) {
      const lower = tokenAddress.toLowerCase();
      return resultObj[lower] || resultObj[tokenAddress] || null;
    }
    return null;
  }
}

export const securityService = new TokenSecurityService();
