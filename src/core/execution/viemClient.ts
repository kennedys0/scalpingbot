import { createPublicClient, createWalletClient, http, fallback, defineChain, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { getChainConfig } from '../../config/chains.js';

export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.mainnet.chain.robinhood.com'],
    },
    public: {
      http: [
        'https://rpc.mainnet.chain.robinhood.com',
        'https://robinhood-rpc.publicnode.com',
        'https://robinhood.drpc.org',
      ],
    },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
});

export class ViemClientManager {
  private publicClients: Map<number, PublicClient> = new Map();
  private walletClients: Map<number, WalletClient> = new Map();
  private privateKey?: `0x${string}`;

  constructor(privateKeyHex?: string) {
    if (privateKeyHex && privateKeyHex.trim()) {
      const clean = privateKeyHex.trim();
      const formatted = clean.startsWith('0x') ? clean : `0x${clean}`;
      if (formatted.length === 66) {
        this.privateKey = formatted as `0x${string}`;
      }
    }
  }

  public getPublicClient(chainId: number): PublicClient {
    if (this.publicClients.has(chainId)) {
      return this.publicClients.get(chainId)!;
    }

    const config = getChainConfig(chainId);
    const chain = chainId === 8453 ? base : robinhoodChain;

    const transports = [http(config.rpcUrls.default, { timeout: 10000 })];
    if (config.rpcUrls.fallback) {
      transports.push(http(config.rpcUrls.fallback, { timeout: 10000 }));
    }
    const transport = fallback(transports, { retryCount: 3, retryDelay: 1000 });

    const client = createPublicClient({
      chain,
      transport,
    }) as PublicClient;

    this.publicClients.set(chainId, client);
    return client;
  }

  public getWalletClient(chainId: number): WalletClient | null {
    if (!this.privateKey) return null;
    if (this.walletClients.has(chainId)) {
      return this.walletClients.get(chainId)!;
    }

    const config = getChainConfig(chainId);
    const chain = chainId === 8453 ? base : robinhoodChain;
    const account = privateKeyToAccount(this.privateKey);

    const transports = [http(config.rpcUrls.default, { timeout: 10000 })];
    if (config.rpcUrls.fallback) {
      transports.push(http(config.rpcUrls.fallback, { timeout: 10000 }));
    }
    const transport = fallback(transports, { retryCount: 3, retryDelay: 1000 });

    const client = createWalletClient({
      account,
      chain,
      transport,
    });

    this.walletClients.set(chainId, client);
    return client;
  }
}
