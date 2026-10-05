import { createPublicClient, createWalletClient, http, defineChain, PublicClient, WalletClient } from 'viem';
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
      http: ['https://rpc.robinhoodchain.com'],
    },
    public: {
      http: ['https://rpc.robinhoodchain.com'],
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
    if (privateKeyHex && privateKeyHex.startsWith('0x') && privateKeyHex.length === 66) {
      this.privateKey = privateKeyHex as `0x${string}`;
    }
  }

  public getPublicClient(chainId: number): PublicClient {
    if (this.publicClients.has(chainId)) {
      return this.publicClients.get(chainId)!;
    }

    const config = getChainConfig(chainId);
    const chain = chainId === 8453 ? base : robinhoodChain;

    const client = createPublicClient({
      chain,
      transport: http(config.rpcUrls.default, { timeout: 10000 }),
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

    const client = createWalletClient({
      account,
      chain,
      transport: http(config.rpcUrls.default, { timeout: 10000 }),
    });

    this.walletClients.set(chainId, client);
    return client;
  }
}
