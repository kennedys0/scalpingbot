export interface ChainDefinition {
  chainId: number;
  name: string;
  shortName: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: {
    default: string;
    fallback: string;
    mevProtected?: string;
  };
  blockExplorers: {
    default: {
      name: string;
      url: string;
    };
  };
  dexscreenerChainId: string;
  defaultRouter: string;
  uniswapV2Router?: string;
  uniswapV3Router?: string;
  uniswapV4PoolManager?: string;
  uniswapV4UniversalRouter?: string;
  aerodromeRouter?: string;
}

export const CHAIN_CONFIG: Record<number, ChainDefinition> = {
  8453: {
    chainId: 8453,
    name: 'Base',
    shortName: 'base',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: 'https://mainnet.base.org',
      fallback: 'https://1rpc.io/base',
      mevProtected: 'https://base.mevblocker.io', // Anti-sandwich private builder RPC
    },
    blockExplorers: {
      default: {
        name: 'Basescan',
        url: 'https://basescan.org',
      },
    },
    dexscreenerChainId: 'base',
    // Default to Uniswap V2 for maximum memecoin compatibility, plus Aerodrome & V3
    defaultRouter: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', // Uniswap V2 Router02 on Base
    uniswapV2Router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
    aerodromeRouter: '0xcF77a3Ba9A5CA399B7c97c7488454543B7374BE',
    // Uniswap V3 SwapRouter02 on Base
    uniswapV3Router: '0x2626664c2603336E57B271c5C0b26F421741e481',
  },
  4663: {
    chainId: 4663,
    name: 'Robinhood',
    shortName: 'robinhood',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: 'https://rpc.mainnet.chain.robinhood.com',
      fallback: 'https://robinhood-rpc.publicnode.com',
    },
    blockExplorers: {
      default: {
        name: 'Robinhood Blockscout',
        url: 'https://robinhoodchain.blockscout.com',
      },
    },
    dexscreenerChainId: 'robinhood',
    // Uniswap V4 PoolManager & Universal Router deployed on Robinhood Chain
    defaultRouter: '0x000000000004444c5dc75cB358380D2e3dE08A90', // Uniswap V4 PoolManager canonical address
    uniswapV4PoolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
    uniswapV4UniversalRouter: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
    uniswapV3Router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  },
};

export function getChainConfig(chainId: number): ChainDefinition {
  const config = CHAIN_CONFIG[chainId];
  if (!config) {
    throw new Error(`Unsupported chain ID: ${chainId}. Supported chains are Base (8453) and Robinhood (4663)`);
  }
  return config;
}
