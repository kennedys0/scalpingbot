export interface BuyOrderParams {
  chainId: number;
  tokenAddress: string;
  tokenSymbol: string;
  amountEth: number;
  currentPriceUsd: number;
  takeProfitPct: number;
  stopLossPct: number;
  trailingStopPct?: number;
  slippagePct?: number;
}

export interface BuyResult {
  success: boolean;
  positionId?: string;
  amountTokens?: number;
  filledPriceUsd?: number;
  txHash?: string;
  error?: string;
}

export interface SellResult {
  success: boolean;
  realizedPnlEth?: number;
  realizedPnlPct?: number;
  filledPriceUsd?: number;
  txHash?: string;
  error?: string;
}
