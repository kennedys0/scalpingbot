export const LIQUIDITY_KNOWLEDGE = `
# Crypto Scalping Domain Knowledge: Liquidity Depth & Pool Dynamics

1. Pool Depth & Slippage Impact:
- Pool Liquidity vs FDV: High-risk memecoins often have low liquidity (< 5% of FDV). For scalping, require minimum $10,000 USD liquidity or liquidity/FDV ratio >= 0.08 to prevent excessive price impact during entry and exit.
- Price Impact Formula: A swap size greater than 1% of pool liquidity creates noticeable slippage (> 1-2%). Recommended position size is capped at <= 0.5% of pool reserve.

2. DEX Architecture & AMM Versions:
- Uniswap V3: Concentrated liquidity. Price can move extremely fast once it breaks out of the active tick range. When volume breaks a concentrated tick, expect a rapid 10-25% price impulse.
- Uniswap V4: Supports singleton PoolManager architecture with dynamic fee hooks and custom accounting. Tighter spreads and customized pool mechanics on modern L2s like Robinhood Chain.
- Aerodrome (Base): ve(3,3) DEX with slipstream concentrated liquidity pools. Volatile pairs benefit from low fee tier routes and rapid liquidity rebalancing.
`;
