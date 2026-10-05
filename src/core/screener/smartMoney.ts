export interface SmartWalletInfo {
  address: string;
  label: string;
  winRatePct?: number;
}

export interface SmartMoneySignal {
  isSmartMoney: boolean;
  label?: string;
  suggestedConfidenceBoost: number;
}

export class SmartMoneyRadar {
  private trackedWallets: Map<string, SmartWalletInfo> = new Map();

  constructor() {
    // Default known profitable alpha traders / smart wallets on Base
    this.addSmartWallet('0xwhale1', 'Top Base Scalper 84% Winrate', 84);
    this.addSmartWallet('0xsmartalpha', 'Aerodrome Whale Accumulator', 78);
  }

  public addSmartWallet(address: string, label: string, winRatePct: number = 75): void {
    this.trackedWallets.set(address.toLowerCase(), {
      address: address.toLowerCase(),
      label,
      winRatePct,
    });
  }

  public removeSmartWallet(address: string): void {
    this.trackedWallets.delete(address.toLowerCase());
  }

  public checkTransaction(
    senderAddress: string,
    tokenAddress: string,
    amountEth: number
  ): SmartMoneySignal {
    const wallet = this.trackedWallets.get(senderAddress.toLowerCase());
    if (wallet && amountEth >= 0.5) {
      return {
        isSmartMoney: true,
        label: wallet.label,
        suggestedConfidenceBoost: 10, // Boost AI confidence score by 10 points!
      };
    }

    return {
      isSmartMoney: false,
      suggestedConfidenceBoost: 0,
    };
  }

  public getTrackedWallets(): SmartWalletInfo[] {
    return Array.from(this.trackedWallets.values());
  }
}
