import axios from 'axios';
import { DexPairData } from './metrics.js';
import { getChainConfig } from '../../config/chains.js';

export class DexScreenerScanner {
  private baseUrl = 'https://api.dexscreener.com';

  protected async fetchFromDexScreener(endpoint: string): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseUrl}${endpoint}`, {
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; DexScanner/1.0)',
        },
      });
      return response.data?.pairs || (Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.warn(`DexScreener fetch warning: ${(error as Error).message}`);
      return [];
    }
  }

  public async scanTrendingPairs(chainId: number): Promise<DexPairData[]> {
    const chainConfig = getChainConfig(chainId);
    const dexscreenerChain = chainConfig.dexscreenerChainId;

    // Search diverse trending & active ecosystem pools for chain
    const searchQueries = chainId === 8453
      ? ['aerodrome', 'base weth', 'uniswap base', 'clanker', 'virtual']
      : ['uniswap', 'robinhood', 'rh'];

    const rawPairsList: any[] = [];
    const results = await Promise.all(
      searchQueries.map((q) => this.fetchFromDexScreener(`/latest/dex/search?q=${encodeURIComponent(q)}`))
    );
    for (const list of results) {
      if (Array.isArray(list)) {
        rawPairsList.push(...list);
      }
    }

    // Deduplicate by token address and filter for target chain
    const seen = new Set<string>();
    const filtered = rawPairsList
      .filter((p: any) => {
        if (!p || !p.baseToken?.address) return false;
        if (p.chainId && p.chainId !== dexscreenerChain) return false;
        const addr = p.baseToken.address.toLowerCase();
        if (seen.has(addr)) return false;
        seen.add(addr);
        return true;
      })
      .sort((a: any, b: any) => ((b.volume?.m5 ?? 0) || (b.volume?.h1 ?? 0)) - ((a.volume?.m5 ?? 0) || (a.volume?.h1 ?? 0)));

    return filtered.map((p: any): DexPairData => ({
        pairAddress: p.pairAddress,
        baseToken: {
          address: p.baseToken?.address || '',
          symbol: p.baseToken?.symbol || '',
          name: p.baseToken?.name || '',
        },
        priceUsd: p.priceUsd || '0',
        priceChange: {
          m5: p.priceChange?.m5 ?? 0,
          h1: p.priceChange?.h1 ?? 0,
          h6: p.priceChange?.h6 ?? 0,
          h24: p.priceChange?.h24 ?? 0,
        },
        volume: {
          m5: p.volume?.m5 ?? 0,
          h1: p.volume?.h1 ?? 0,
          h6: p.volume?.h6 ?? 0,
          h24: p.volume?.h24 ?? 0,
        },
        txns: {
          m5: {
            buys: p.txns?.m5?.buys ?? 0,
            sells: p.txns?.m5?.sells ?? 0,
          },
          h1: {
            buys: p.txns?.h1?.buys ?? 0,
            sells: p.txns?.h1?.sells ?? 0,
          },
          h24: {
            buys: p.txns?.h24?.buys ?? 0,
            sells: p.txns?.h24?.sells ?? 0,
          },
        },
        liquidity: {
          usd: p.liquidity?.usd ?? 0,
          base: p.liquidity?.base ?? 0,
          quote: p.liquidity?.quote ?? 0,
        },
        fdv: p.fdv ?? 0,
      }));
  }

  public async getPairDetails(chainId: number, pairAddress: string): Promise<DexPairData | null> {
    const chainConfig = getChainConfig(chainId);
    const pairs = await this.fetchFromDexScreener(`/latest/dex/pairs/${chainConfig.dexscreenerChainId}/${pairAddress}`);
    if (pairs && pairs.length > 0) {
      const p = pairs[0];
      return {
        pairAddress: p.pairAddress,
        baseToken: {
          address: p.baseToken?.address || '',
          symbol: p.baseToken?.symbol || '',
          name: p.baseToken?.name || '',
        },
        priceUsd: p.priceUsd || '0',
        priceChange: p.priceChange,
        volume: p.volume,
        txns: p.txns,
        liquidity: p.liquidity,
        fdv: p.fdv,
      };
    }
    return null;
  }
}
