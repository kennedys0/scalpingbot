import { JsonStorage } from '../../storage/db.js';

export interface BlacklistEntry {
  address: string;
  reason: string;
  addedAt: number;
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
    return !!list[tokenAddress.toLowerCase()];
  }

  public async addToBlacklist(tokenAddress: string, reason: string): Promise<void> {
    const normalized = tokenAddress.toLowerCase();
    this.storage.update((data) => {
      if (!data.settings.blacklist) data.settings.blacklist = {};
      data.settings.blacklist[normalized] = {
        address: normalized,
        reason,
        addedAt: Date.now(),
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
