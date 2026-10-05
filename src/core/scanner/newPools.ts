import axios from 'axios';
import { getChainConfig } from '../../config/chains.js';

export interface NewPoolCandidate {
  chainId: number;
  poolAddress: string;
  baseTokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  createdAtMs: number;
  ageMinutes: number;
  priceUsd: number;
  liquidityUsd: number;
  source: 'geckoterminal' | 'dexscreener';
}

export interface NewPoolsScannerOptions {
  maxAgeMinutes?: number;
  minLiquidityUsd?: number;
}

export class NewPoolsScanner {
  private maxAgeMinutes: number;
  private minLiquidityUsd: number;
  private processedAddresses = new Set<string>();

  constructor(options: NewPoolsScannerOptions = {}) {
    this.maxAgeMinutes = options.maxAgeMinutes ?? 30;
    this.minLiquidityUsd = options.minLiquidityUsd ?? 2000;
  }

  public markProcessed(address: string): void {
    if (address) {
      this.processedAddresses.add(address.toLowerCase());
    }
  }

  public isProcessed(address: string): boolean {
    if (!address) return false;
    return this.processedAddresses.has(address.toLowerCase());
  }

  public clearCache(): void {
    this.processedAddresses.clear();
  }

  public async scanNewPools(chainId: number): Promise<NewPoolCandidate[]> {
    const candidates: NewPoolCandidate[] = [];
    const now = Date.now();

    // Map chainId to GeckoTerminal network identifier
    const geckoNetwork = chainId === 8453 ? 'base' : 'robinhood';

    try {
      // 1. Query GeckoTerminal new_pools endpoint
      const response = await axios.get(
        `https://api.geckoterminal.com/api/v2/networks/${geckoNetwork}/new_pools`,
        {
          timeout: 8000,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; NewPoolsScanner/1.0)',
          },
        }
      );

      const rawPools = response.data?.data || [];
      for (const pool of rawPools) {
        const attrs = pool?.attributes;
        if (!attrs) continue;

        const poolAddress = attrs.address;
        const rawCreatedAt = attrs.pool_created_at;
        const reserveUsd = parseFloat(attrs.reserve_in_usd || '0');
        const priceUsd = parseFloat(attrs.base_token_price_usd || '0');
        const poolName = attrs.name || '';

        // Extract base token address from relationship or pool ID
        const baseTokenRelId = pool?.relationships?.base_token?.data?.id || '';
        let baseTokenAddress = baseTokenRelId.replace(`${geckoNetwork}_`, '');
        if (!baseTokenAddress && pool.id) {
          baseTokenAddress = pool.id.replace(`${geckoNetwork}_`, '');
        }

        if (!baseTokenAddress || this.isProcessed(baseTokenAddress)) {
          continue;
        }

        const createdAtMs = rawCreatedAt ? new Date(rawCreatedAt).getTime() : now;
        const ageMinutes = Math.max(0, Math.round(((now - createdAtMs) / (60 * 1000)) * 10) / 10);

        // Filter age
        if (ageMinutes > this.maxAgeMinutes) {
          continue;
        }

        // Filter liquidity
        if (reserveUsd < this.minLiquidityUsd) {
          continue;
        }

        // Parse token symbol and name from poolName (e.g. "TOKEN / WETH")
        const nameParts = poolName.split('/');
        const symbol = nameParts[0]?.trim() || 'NEW_TOKEN';
        const name = symbol;

        candidates.push({
          chainId,
          poolAddress,
          baseTokenAddress: baseTokenAddress.toLowerCase(),
          tokenSymbol: symbol,
          tokenName: name,
          createdAtMs,
          ageMinutes,
          priceUsd,
          liquidityUsd: reserveUsd,
          source: 'geckoterminal',
        });
      }
    } catch (error) {
      // Fallback or log silently if rate limited
    }

    return candidates;
  }
}
