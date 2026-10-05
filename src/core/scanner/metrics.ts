export interface DexPairData {
  pairAddress: string;
  baseToken: {
    address: string;
    symbol: string;
    name: string;
  };
  priceUsd: string;
  priceChange?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  volume?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  txns?: {
    m5?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  liquidity?: {
    usd?: number;
    base?: number;
    quote?: number;
  };
  fdv?: number;
}

export interface MicrostructureMetrics {
  priceUsd: number;
  priceChange5m: number;
  priceChange1h: number;
  volume5m: number;
  volume1h: number;
  buys5m: number;
  sells5m: number;
  buyPressureRatio5m: number;
  volumeDelta5m: number;
  liquidityUsd: number;
  fdv: number;
  liquidityToFdvRatio: number;
  isOrderFlowBullish: boolean;
  volatilityScore: number;
}

export function calculateMicrostructureMetrics(pair: DexPairData): MicrostructureMetrics {
  const parsedPrice = parseFloat(pair.priceUsd || '0');
  const priceUsd = isNaN(parsedPrice) ? 0 : Math.max(0, parsedPrice);
  const priceChange5m = isNaN(pair.priceChange?.m5 ?? 0) ? 0 : (pair.priceChange?.m5 ?? 0);
  const priceChange1h = isNaN(pair.priceChange?.h1 ?? 0) ? 0 : (pair.priceChange?.h1 ?? 0);
  const volume5m = Math.max(0, isNaN(pair.volume?.m5 ?? 0) ? 0 : (pair.volume?.m5 ?? 0));
  const volume1h = Math.max(0, isNaN(pair.volume?.h1 ?? 0) ? 0 : (pair.volume?.h1 ?? 0));
  const buys5m = Math.max(0, isNaN(pair.txns?.m5?.buys ?? 0) ? 0 : (pair.txns?.m5?.buys ?? 0));
  const sells5m = Math.max(0, isNaN(pair.txns?.m5?.sells ?? 0) ? 0 : (pair.txns?.m5?.sells ?? 0));
  const totalTxns5m = buys5m + sells5m;

  const buyPressureRatio5m = totalTxns5m > 0 ? buys5m / totalTxns5m : 0.5;

  // Approximate buy vs sell volume based on trade count ratio
  const estimatedBuyVol5m = volume5m * buyPressureRatio5m;
  const estimatedSellVol5m = volume5m * (1 - buyPressureRatio5m);
  const volumeDelta5m = estimatedBuyVol5m - estimatedSellVol5m;

  const rawLiquidity = pair.liquidity?.usd ?? 0;
  const liquidityUsd = isNaN(rawLiquidity) ? 0 : Math.max(0, rawLiquidity);
  const rawFdv = pair.fdv ?? (liquidityUsd > 0 ? liquidityUsd * 2 : 1);
  const fdv = isNaN(rawFdv) ? 1 : Math.max(1, rawFdv);
  const liquidityToFdvRatio = fdv > 0 ? liquidityUsd / fdv : 0;

  // Bullish order flow: Buy ratio >= 60% and 5m volume delta is positive
  const isOrderFlowBullish = buyPressureRatio5m >= 0.60 && volumeDelta5m > 0;

  // Volatility score based on 5m and 1h delta
  const volatilityScore = Math.min(100, Math.abs(priceChange5m) * 5 + Math.abs(priceChange1h));

  return {
    priceUsd,
    priceChange5m,
    priceChange1h,
    volume5m,
    volume1h,
    buys5m,
    sells5m,
    buyPressureRatio5m,
    volumeDelta5m,
    liquidityUsd,
    fdv,
    liquidityToFdvRatio,
    isOrderFlowBullish,
    volatilityScore,
  };
}
