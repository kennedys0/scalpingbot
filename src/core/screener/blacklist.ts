import { JsonStorage } from '../../storage/db.js';

export interface BlacklistEntry {
  address: string;
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

  public async addToBlacklist(tokenAddress: string, reason: string, ttlHours?: number): Promise<void> {
    const normalized = tokenAddress.toLowerCase();
    const expiresAt = ttlHours ? Date.now() + ttlHours * 3600 * 1000 : undefined;
    this.storage.update((data) => {
      if (!data.settings.blacklist) data.settings.blacklist = {};
      data.settings.blacklist[normalized] = {
        address: normalized,
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
    return Object.values(list);
  }
}
