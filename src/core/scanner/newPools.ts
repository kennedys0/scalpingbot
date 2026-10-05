import axios from 'axios';
import { getChainConfig } from '../../config/chains.js';

export interface NewPoolCandidate {
  chainId: number;
  poolAddress: string;
  baseTokenAddress: string;
  quoteTokenAddress?: string;
  tokenSymbol: string;
  tokenName: string;
  dexId?: string;
  createdAtMs: number;
  ageMinutes: number;
  priceUsd: number;
  liquidityUsd: number;
  realQuoteReserveUsd?: number;
  fdvUsd?: number;
  volume5m?: number;
  volume1h?: number;
  buys5m?: number;
  sells5m?: number;
  source: 'geckoterminal' | 'dexscreener';
}

export interface NewPoolsScannerOptions {
  maxAgeMinutes?: number;
  minLiquidityUsd?: number;
}

export class NewPoolsScanner {
  private maxAgeMinutes: number;
  private minLiquidityUsd: number;
  // ISSUE-07 FIX: Store with timestamp to enable TTL-based cleanup (prevent unbounded memory growth)
  private processedAddresses = new Map<string, number>(); // address -> timestamp added
  private readonly PROCESSED_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours TTL

  constructor(options: NewPoolsScannerOptions = {}) {
    this.maxAgeMinutes = options.maxAgeMinutes ?? 30;
    this.minLiquidityUsd = options.minLiquidityUsd ?? 2000;
  }

  public markProcessed(address: string): void {
    if (address) {
      this.processedAddresses.set(address.toLowerCase(), Date.now());
    }
  }

  public isProcessed(address: string): boolean {
    if (!address) return false;
    const key = address.toLowerCase();
    const addedAt = this.processedAddresses.get(key);
    if (addedAt === undefined) return false;
    // Check if TTL expired
    if (Date.now() - addedAt > this.PROCESSED_TTL_MS) {
      this.processedAddresses.delete(key);
      return false;
    }
    return true;
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

        // Layer 1: Filter Unsupported DEXes (e.g. Uniswap V4 which uses singleton hooks incompatible with V2/Aerodrome routers)
        const dexId = pool?.relationships?.dex?.data?.id || '';
        if (dexId && (dexId.toLowerCase().includes('v4') || dexId.toLowerCase().includes('uniswap-v4'))) {
          continue;
        }

        // Layer 2: Filter Empty / Fake Deployer-Only Pools (must have minimum activity if txn data is present)
        const volume5m = parseFloat(attrs.volume_usd?.m5 || '0');
        const volume1h = parseFloat(attrs.volume_usd?.h1 || '0');
        const buys5m = parseInt(attrs.transactions?.m5?.buys || '0', 10);
        const sells5m = parseInt(attrs.transactions?.m5?.sells || '0', 10);
        const totalTxns = buys5m + sells5m;

        if (attrs.transactions?.m5 !== undefined) {
          if (totalTxns < 2 && volume5m < 50) {
            continue; // Filter single deployer init transaction with $0 volume
          }
        }

        // Parse token symbol and name from poolName (e.g. "TOKEN / WETH")
        const nameParts = poolName.split('/');
        const symbol = nameParts[0]?.trim() || 'NEW_TOKEN';
        const name = symbol;
        const fdvUsd = parseFloat(attrs.fdv_usd || '0');
        const quoteRelId = pool?.relationships?.quote_token?.data?.id || '';
        const quoteTokenAddress = quoteRelId.replace(`${geckoNetwork}_`, '');

        candidates.push({
          chainId,
          poolAddress,
          baseTokenAddress: baseTokenAddress.toLowerCase(),
          quoteTokenAddress: quoteTokenAddress ? quoteTokenAddress.toLowerCase() : undefined,
          tokenSymbol: symbol,
          tokenName: name,
          dexId,
          createdAtMs,
          ageMinutes,
          priceUsd,
          liquidityUsd: reserveUsd,
          fdvUsd: fdvUsd > 0 ? fdvUsd : reserveUsd * 4,
          volume5m,
          volume1h,
          buys5m,
          sells5m,
          source: 'geckoterminal',
        });
      }
    } catch (error) {
      // Fallback or log silently if rate limited
    }

    return candidates;
  }
}
