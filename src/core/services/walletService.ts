import { createPublicClient, http, fallback, formatEther } from 'viem';
import { base } from 'viem/chains';
import { robinhoodChain } from '../execution/viemClient.js';
import { rateService } from './rateService.js';
import { getEnv } from '../../config/env.js';
import { DepositNotificationData } from '../../bot/messages/formatters.js';

export interface WalletSnapshot {
  address: string;
  balanceBaseEth: number;
  balanceRobinhoodEth: number;
  balanceTotalEth: number;
  balanceEth: number; // backward compatibility
  balanceUsd: number;
  balanceIdr: number;
  timestamp: number;
}

export interface WalletHistory {
  snapshots: WalletSnapshot[];
  pnl24hEth: number;
  pnl24hIdr: number;
  pnl24hPct: number;
}

class WalletService {
  private static instance: WalletService;
  private snapshots: WalletSnapshot[] = [];
  private maxSnapshots = 1440; // Keep up to 24h of 1-min snapshots
  private walletAddress: string | null = null;
  private lastBaseBalance: number | null = null;
  private lastRobinhoodBalance: number | null = null;
  private onDepositCallbacks: ((deposit: DepositNotificationData) => Promise<void> | void)[] = [];
  private watcherTimer: NodeJS.Timeout | null = null;

  private constructor() {}

  public static getInstance(): WalletService {
    if (!WalletService.instance) {
      WalletService.instance = new WalletService();
    }
    return WalletService.instance;
  }

  /**
   * Register a callback to be notified when an incoming deposit is detected.
   */
  public onDeposit(callback: (deposit: DepositNotificationData) => Promise<void> | void): void {
    this.onDepositCallbacks.push(callback);
  }

  /**
   * Manually sets or resets the baseline balances (useful for testing or initial sync).
   */
  public setInitialBalances(baseEth: number, rhEth: number): void {
    this.lastBaseBalance = baseEth;
    this.lastRobinhoodBalance = rhEth;
  }

  /**
   * Returns cached wallet address synchronously.
   * Will be null until deriveAddress() has been called at least once.
   * Use deriveAddress() for async first-time resolution.
   */
  public getWalletAddress(): string | null {
    return this.walletAddress;
  }

  /**
   * Derives wallet address asynchronously from private key.
   */
  public async deriveAddress(): Promise<string | null> {
    if (this.walletAddress) return this.walletAddress;

    try {
      const env = getEnv();
      const pk = env.WALLET_PRIVATE_KEY;
      if (!pk || pk.length < 60) return null;

      // Import privateKeyToAccount from viem/accounts
      const { privateKeyToAccount } = await import('viem/accounts');
      const normalizedKey = pk.startsWith('0x') ? pk : `0x${pk}`;
      const account = privateKeyToAccount(normalizedKey as `0x${string}`);
      this.walletAddress = account.address;
      return this.walletAddress;
    } catch (err) {
      console.warn('⚠️ [WalletService] Could not derive wallet address:', err);
      return null;
    }
  }

  /**
   * Fetches live ETH balances from Base (8453) and Robinhood (4663) chains.
   */
  public async fetchBalance(): Promise<WalletSnapshot | null> {
    try {
      const address = await this.deriveAddress();
      if (!address) return null;

      const env = getEnv();
      const baseClient = createPublicClient({
        chain: base,
        transport: fallback([
          http(env.BASE_RPC_URL, { timeout: 8000 }),
          http(env.BASE_RPC_FALLBACK, { timeout: 8000 }),
        ]),
      });

      const rhClient = createPublicClient({
        chain: robinhoodChain,
        transport: fallback([
          http(env.ROBINHOOD_RPC_URL, { timeout: 8000 }),
          http(env.ROBINHOOD_RPC_FALLBACK, { timeout: 8000 }),
          http('https://robinhood.drpc.org', { timeout: 8000 }),
        ]),
      });

      let baseFailed = false;
      let rhFailed = false;

      const [baseWeiResult, rhWeiResult] = await Promise.all([
        baseClient.getBalance({ address: address as `0x${string}` }).catch((err) => {
          console.warn('⚠️ [WalletService] Base RPC getBalance error:', err?.message || err);
          baseFailed = true;
          return null;
        }),
        rhClient.getBalance({ address: address as `0x${string}` }).catch((err) => {
          console.warn('⚠️ [WalletService] Robinhood RPC getBalance error:', err?.message || err);
          rhFailed = true;
          return null;
        }),
      ]);

      const balanceBaseEth = baseWeiResult !== null
        ? parseFloat(formatEther(baseWeiResult))
        : (this.lastBaseBalance ?? 0);

      const balanceRobinhoodEth = rhWeiResult !== null
        ? parseFloat(formatEther(rhWeiResult))
        : (this.lastRobinhoodBalance ?? 0);

      const balanceTotalEth = balanceBaseEth + balanceRobinhoodEth;
      const rates = rateService.getRates();
      const balanceUsd = balanceTotalEth * rates.ethPriceUsd;
      const balanceIdr = balanceTotalEth * rates.ethPriceIdr;

      // Detect incoming deposits (threshold 0.0001 ETH to ignore dust)
      // Only check and update when the RPC call was successful to prevent false alerts on temporary network hiccups
      if (!baseFailed && baseWeiResult !== null) {
        if (this.lastBaseBalance !== null && balanceBaseEth > this.lastBaseBalance + 0.0001) {
          const delta = balanceBaseEth - this.lastBaseBalance;
          this.triggerDeposit({
            chainName: 'Base',
            chainId: 8453,
            amountEth: delta,
            amountUsd: delta * rates.ethPriceUsd,
            amountIdr: delta * rates.ethPriceIdr,
            newBalanceEth: balanceBaseEth,
            address,
          });
        }
        this.lastBaseBalance = balanceBaseEth;
      }

      if (!rhFailed && rhWeiResult !== null) {
        if (this.lastRobinhoodBalance !== null && balanceRobinhoodEth > this.lastRobinhoodBalance + 0.0001) {
          const delta = balanceRobinhoodEth - this.lastRobinhoodBalance;
          this.triggerDeposit({
            chainName: 'Robinhood',
            chainId: 4663,
            amountEth: delta,
            amountUsd: delta * rates.ethPriceUsd,
            amountIdr: delta * rates.ethPriceIdr,
            newBalanceEth: balanceRobinhoodEth,
            address,
          });
        }
        this.lastRobinhoodBalance = balanceRobinhoodEth;
      }

      const snapshot: WalletSnapshot = {
        address,
        balanceBaseEth,
        balanceRobinhoodEth,
        balanceTotalEth,
        balanceEth: balanceTotalEth,
        balanceUsd,
        balanceIdr,
        timestamp: Date.now(),
      };

      // Store snapshot for history tracking
      this.snapshots.push(snapshot);
      if (this.snapshots.length > this.maxSnapshots) {
        this.snapshots.shift();
      }

      return snapshot;
    } catch (err: any) {
      console.warn(`⚠️ [WalletService] Failed to fetch balance: ${err.message}`);
      return null;
    }
  }

  private triggerDeposit(deposit: DepositNotificationData): void {
    for (const cb of this.onDepositCallbacks) {
      try {
        Promise.resolve(cb(deposit)).catch((e) => console.error('Error in onDeposit listener:', e));
      } catch (err) {
        console.error('Error triggering onDeposit listener:', err);
      }
    }
  }

  public startPeriodicWatcher(intervalMs: number = 20000): void {
    if (this.watcherTimer) return;
    this.watcherTimer = setInterval(() => {
      this.fetchBalance().catch(() => {});
    }, intervalMs);
  }

  public stopPeriodicWatcher(): void {
    if (this.watcherTimer) {
      clearInterval(this.watcherTimer);
      this.watcherTimer = null;
    }
  }

  /**
   * Returns balance history and 24h PnL comparison.
   */
  public getHistory(): WalletHistory {
    const now = Date.now();
    const ms24h = 24 * 60 * 60 * 1000;

    const recent = this.snapshots[this.snapshots.length - 1] ?? null;
    const oldest24h = this.snapshots.find((s) => now - s.timestamp >= ms24h - 60_000) ??
      this.snapshots[0] ??
      null;

    let pnl24hEth = 0;
    let pnl24hIdr = 0;
    let pnl24hPct = 0;

    if (recent && oldest24h && recent !== oldest24h) {
      pnl24hEth = recent.balanceEth - oldest24h.balanceEth;
      pnl24hIdr = recent.balanceIdr - oldest24h.balanceIdr;
      pnl24hPct = oldest24h.balanceEth > 0
        ? ((pnl24hEth / oldest24h.balanceEth) * 100)
        : 0;
    }

    return {
      snapshots: [...this.snapshots],
      pnl24hEth,
      pnl24hIdr,
      pnl24hPct,
    };
  }

  /**
   * Gets the last known snapshot without fetching.
   */
  public getLastSnapshot(): WalletSnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  /**
   * Returns the current wallet address (cached after first derivation).
   */
  public getCachedAddress(): string | null {
    return this.walletAddress;
  }

  /**
   * Generates a QR code URL for the wallet address using a public API.
   */
  public generateDepositQrUrl(address: string, size: number = 256): string {
    const encoded = encodeURIComponent(address);
    // Use goqr.me free API — no API key needed, works in Telegram sendPhoto
    return `https://api.qrserver.com/v1/create-qr-code/?data=${encoded}&size=${size}x${size}&format=png&margin=10&color=000000&bgcolor=FFFFFF`;
  }
}

export const walletService = WalletService.getInstance();
