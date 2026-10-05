import { JsonStorage } from '../../storage/db.js';

export type BlacklistCategory = 'SECURITY_PERMANENT' | 'LOW_LIQUIDITY_TEMP' | 'AI_REJECT_TEMP' | 'MANUAL_USER';

export interface BlacklistEntry {
  address: string;
  category: BlacklistCategory;
  reason: string;
  addedAt: number;
  expiresAt?: number;
}

export class BlacklistManager {
  private storage: JsonStorage;

  constructor(storage: JsonStorage) {
    this.storage = storage;
    this.initStorage();
  }

  private initStorage(): void {
    this.storage.update((data) => {
      if (!data.settings.blacklist) {
        data.settings.blacklist = {};
      }
    });
  }

  public isBlacklisted(tokenAddress: string): boolean {
    const list = this.storage.getData().settings.blacklist || {};
    const entry = list[tokenAddress.toLowerCase()] as BlacklistEntry | undefined;
    if (!entry) return false;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.removeFromBlacklist(tokenAddress);
      return false;
    }

    return true;
  }

  public getEntry(tokenAddress: string): BlacklistEntry | undefined {
    const list = this.storage.getData().settings.blacklist || {};
    const entry = list[tokenAddress.toLowerCase()] as BlacklistEntry | undefined;
    if (!entry) return undefined;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.removeFromBlacklist(tokenAddress);
      return undefined;
    }

    return entry;
  }

  public async addToBlacklist(
    tokenAddress: string,
    reason: string,
    category: BlacklistCategory = 'MANUAL_USER',
    customTtlHours?: number
  ): Promise<void> {
    const normalized = tokenAddress.toLowerCase();

    let ttlHours: number | undefined = customTtlHours;
    if (ttlHours === undefined) {
      if (category === 'LOW_LIQUIDITY_TEMP') {
        ttlHours = 6;
      } else if (category === 'AI_REJECT_TEMP') {
        ttlHours = 12;
      } else if (category === 'SECURITY_PERMANENT') {
        ttlHours = undefined;
      }
    }

    const expiresAt = ttlHours ? Date.now() + ttlHours * 3600 * 1000 : undefined;

    this.storage.update((data) => {
      if (!data.settings.blacklist) data.settings.blacklist = {};
      data.settings.blacklist[normalized] = {
        address: normalized,
        category,
        reason,
        addedAt: Date.now(),
        expiresAt,
      };
    });
  }

  public async removeFromBlacklist(tokenAddress: string): Promise<void> {
    const normalized = tokenAddress.toLowerCase();
    this.storage.update((data) => {
      if (data.settings.blacklist && data.settings.blacklist[normalized]) {
        delete data.settings.blacklist[normalized];
      }
    });
  }

  public getBlacklistedTokens(): BlacklistEntry[] {
    const list = this.storage.getData().settings.blacklist || {};
    const now = Date.now();
    const result: BlacklistEntry[] = [];
    const expired: string[] = [];

    for (const [addr, entry] of Object.entries(list)) {
      const e = entry as BlacklistEntry;
      if (e.expiresAt && now > e.expiresAt) {
        expired.push(addr);
      } else {
        result.push(e);
      }
    }

    // Cleanup expired
    if (expired.length > 0) {
      this.storage.update((data) => {
        if (!data.settings.blacklist) return;
        for (const exp of expired) {
          delete data.settings.blacklist[exp];
        }
      });
    }

    return result;
  }
}
