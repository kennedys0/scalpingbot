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
  };
  blockExplorers: {
    default: {
      name: string;
      url: string;
    };
  };
  dexscreenerChainId: string;
  defaultRouter: string;
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
      fallback: 'https://base.llamarpc.com',
    },
    blockExplorers: {
      default: {
        name: 'Basescan',
        url: 'https://basescan.org',
      },
    },
    dexscreenerChainId: 'base',
    // Aerodrome Universal Router / SwapRouter
    defaultRouter: '0xcF77a3Ba9A5CA399B7c97c7488454543B7374BE',
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
      default: 'https://rpc.robinhoodchain.com',
      fallback: 'https://robinhoodchain.blockscout.com/api/eth-rpc',
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
