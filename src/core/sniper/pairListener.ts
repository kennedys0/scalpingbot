import { ViemClientManager } from '../execution/viemClient.js';
import { parseAbiItem } from 'viem';

export interface NewPairEvent {
  chainId: number;
  token0: string;
  token1: string;
  pairAddress: string;
  timestamp: number;
}

export type OnNewPairCallback = (event: NewPairEvent) => Promise<void>;

export class PairListener {
  private viemManager: ViemClientManager;
  private unwatchers: Map<number, () => void> = new Map();

  constructor(viemManager: ViemClientManager) {
    this.viemManager = viemManager;
  }

  public async startListening(chainId: number, onNewPair: OnNewPairCallback): Promise<void> {
    const client = this.viemManager.getPublicClient(chainId);

    try {
      // Standard Uniswap V2 / Aerodrome PairCreated event
      const pairCreatedEvent = parseAbiItem(
        'event PairCreated(address indexed token0, address indexed token1, address pair, uint)'
      );

      const unwatch = client.watchEvent({
        event: pairCreatedEvent,
        onLogs: async (logs) => {
          for (const log of logs) {
            try {
              const args = (log as any).args;
              // Validate required fields before processing
              if (!args || !args.token0 || !args.token1 || !args.pair) {
                console.warn(`⚠️ [PairListener] Malformed PairCreated event, missing required fields`);
                continue;
              }
              await onNewPair({
                chainId,
                token0: args.token0,
                token1: args.token1,
                pairAddress: args.pair,
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`⚠️ [PairListener] Error processing event log:`, (err as Error).message);
            }
          }
        },
      });

      this.unwatchers.set(chainId, unwatch);
    } catch (err) {
      console.warn(`PairListener event subscription warning on chain ${chainId}: ${(err as Error).message}`);
    }
  }

  public stopListening(chainId?: number): void {
    if (chainId) {
      const unwatch = this.unwatchers.get(chainId);
      if (unwatch) {
        try {
          unwatch();
        } catch (err) {
          console.error(`⚠️ [PairListener] Failed to unwatch chain ${chainId}:`, (err as Error).message);
        }
        this.unwatchers.delete(chainId);
      }
    } else {
      for (const [cId, unwatch] of this.unwatchers) {
        try {
          unwatch();
        } catch (err) {
          console.error(`⚠️ [PairListener] Failed to unwatch chain ${cId}:`, (err as Error).message);
        }
      }
      this.unwatchers.clear();
    }
  }
}
