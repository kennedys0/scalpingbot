export interface CurrencyRates {
  ethPriceUsd: number;
  ethPriceIdr: number;
  usdToIdrRate: number;
  lastUpdated: number;
  source: 'coingecko' | 'fallback';
}

class CurrencyRateService {
  private static instance: CurrencyRateService;

  // Defaults based on initial market baseline
  private rates: CurrencyRates = {
    ethPriceUsd: 2600,
    ethPriceIdr: 42000000,
    usdToIdrRate: 16250,
    lastUpdated: 0,
    source: 'fallback',
  };

  private refreshInterval: NodeJS.Timeout | null = null;
  private cacheTtlMs = 60 * 1000; // 60 seconds cache TTL
  private isFetching = false;

  private constructor() {}

  public static getInstance(): CurrencyRateService {
    if (!CurrencyRateService.instance) {
      CurrencyRateService.instance = new CurrencyRateService();
    }
    return CurrencyRateService.instance;
  }

  public getRates(): CurrencyRates {
    return { ...this.rates };
  }

  public getEthPriceUsd(): number {
    return this.rates.ethPriceUsd;
  }

  public getUsdToIdrRate(): number {
    return this.rates.usdToIdrRate;
  }

  public getEthPriceIdr(): number {
    return this.rates.ethPriceIdr;
  }

  /**
   * Fetches live rates directly from CoinGecko simple price endpoint.
   * Gracefully maintains previous rates if request fails or rate limits.
   */
  public async fetchRates(): Promise<CurrencyRates> {
    const now = Date.now();
    // Return cached rates if fresh
    if (this.rates.lastUpdated > 0 && now - this.rates.lastUpdated < this.cacheTtlMs) {
      return this.rates;
    }

    if (this.isFetching) {
      return this.rates;
    }

    this.isFetching = true;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const url = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,tether&vs_currencies=usd,idr';
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'ScalpingBot/1.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`CoinGecko HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        ethereum?: { usd?: number; idr?: number };
        tether?: { usd?: number; idr?: number };
      };

      if (data.ethereum?.usd && data.ethereum?.idr) {
        const ethUsd = data.ethereum.usd;
        const ethIdr = data.ethereum.idr;
        let usdIdr = data.tether?.idr && data.tether?.usd ? data.tether.idr / data.tether.usd : ethIdr / ethUsd;

        this.rates = {
          ethPriceUsd: ethUsd,
          ethPriceIdr: ethIdr,
          usdToIdrRate: Math.round(usdIdr),
          lastUpdated: Date.now(),
          source: 'coingecko',
        };

        console.log(
          `💱 [CoinGecko] Kurs Real-Time Terhubung: 1 ETH = $${ethUsd.toLocaleString('en-US')} (~Rp ${ethIdr.toLocaleString('id-ID')}) | 1 USD = Rp ${this.rates.usdToIdrRate.toLocaleString('id-ID')}`
        );
      }
    } catch (err: any) {
      // Don't crash; log and keep cached or baseline rate
      console.warn(`⚠️ [CoinGecko] Gagal memperbarui kurs live (${err.message}). Menggunakan rate tersimpan.`);
    } finally {
      this.isFetching = false;
    }

    return this.rates;
  }

  /**
   * Starts periodic polling in background (e.g. every 60 seconds)
   */
  public startPeriodicRefresh(intervalMs: number = 60000): void {
    if (this.refreshInterval) return;

    // Trigger initial fetch asynchronously
    this.fetchRates().catch(() => {});

    this.refreshInterval = setInterval(() => {
      this.fetchRates().catch(() => {});
    }, intervalMs);
  }

  public stopPeriodicRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * For testing or forced overrides
   */
  public setMockRates(rates: Partial<CurrencyRates>): void {
    this.rates = {
      ...this.rates,
      ...rates,
      lastUpdated: Date.now(),
    };
  }
}

export const rateService = CurrencyRateService.getInstance();
