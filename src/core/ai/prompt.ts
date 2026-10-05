import { ORDER_FLOW_KNOWLEDGE } from './knowledge/orderflow.js';
import { LIQUIDITY_KNOWLEDGE } from './knowledge/liquidity.js';
import { CHAIN_SPECIFIC_KNOWLEDGE } from './knowledge/chains.js';
import { MicrostructureMetrics } from '../scanner/metrics.js';

export function buildScalpSystemPrompt(chainId: number): string {
  const chainName = chainId === 8453 ? 'Base' : 'Robinhood';
  const specificKnowledge = chainId === 8453 ? CHAIN_SPECIFIC_KNOWLEDGE.base : CHAIN_SPECIFIC_KNOWLEDGE.robinhood;

  return `You are a world-class crypto quantitative researcher and algorithmic scalper specializing in decentralized exchange (DEX) market microstructure on ${chainName}.

YOUR KNOWLEDGE BASE:
${ORDER_FLOW_KNOWLEDGE}

${LIQUIDITY_KNOWLEDGE}

${specificKnowledge}

SCALPING RULES & CONSTRAINTS:
1. Capital Preservation is Priority #1. Never recommend BUY if order flow is uncertain or distribution is detected.
2. A BUY action requires:
   - Order flow confirmation (5m Buy Pressure Ratio >= 60% and positive Volume Delta).
   - Liquidity safety (sufficient pool depth to absorb the position with minimal slippage).
   - Minimum Risk/Reward Ratio of 2.0 (Take Profit % / Stop Loss % >= 2.0).
3. Clamped Risk:
   - Dynamic Take Profit typically between +10% and +30%.
   - Tight Stop Loss between -4% and -7%.
4. You must output STRICT RAW JSON ONLY adhering to the schema. No conversational filler or markdown other than valid JSON.

JSON Schema format:
{
  "action": "BUY" | "WAIT" | "AVOID",
  "confidence": number (0 to 100),
  "takeProfitPct": number,
  "stopLossPct": number,
  "suggestedAllocEth": number,
  "timeframeMinutes": number,
  "riskRewardRatio": number,
  "reasoning": string (concise explanation of signals),
  "signalsDetected": string[]
}
`;
}

export interface ScalpCandidateInput {
  tokenName: string;
  tokenSymbol: string;
  tokenAddress: string;
  chainName: string;
  priceUsd: number;
  metrics: MicrostructureMetrics;
  pastLessons?: string;
  smartMoneyInfo?: string;
}

export function buildScalpUserPrompt(input: ScalpCandidateInput): string {
  const m = input.metrics;
  const memoryBlock = input.pastLessons ? `\n\n${input.pastLessons}` : '';
  const smartMoneyBlock = input.smartMoneyInfo ? `\n\nSmart Money Whale Alert:\n- ${input.smartMoneyInfo}` : '';

  return `Analyze this live DEX pair for a potential rapid scalp entry:

Token: ${input.tokenName} ($${input.tokenSymbol})
Address: ${input.tokenAddress}
Network: ${input.chainName}
Current Price: $${input.priceUsd}

Pre-Calculated Quantitative Metrics:
- 5m Price Change: ${m?.priceChange5m ?? 0}%
- 1h Price Change: ${m?.priceChange1h ?? 0}%
- 5m Volume: $${m?.volume5m ?? 0}
- 1h Volume: $${m?.volume1h ?? 0}
- 5m Transactions: ${m?.buys5m ?? 0} Buys / ${m?.sells5m ?? 0} Sells
- 5m Buy Pressure Ratio: ${m?.buyPressureRatio5m ?? 0.5} (Scale: 0.0 to 1.0)
- 5m Volume Delta: $${m?.volumeDelta5m ?? 0}
- Pool Liquidity: $${m?.liquidityUsd ?? 0}
- Fully Diluted Valuation (FDV): $${m?.fdv ?? 0}
- Liquidity to FDV Ratio: ${m?.liquidityToFdvRatio ?? 0}
- Order Flow Bullish Signal: ${m?.isOrderFlowBullish ? 'YES' : 'NO'}
- Volatility Score: ${m?.volatilityScore ?? 0} / 100${memoryBlock}${smartMoneyBlock}

Perform step-by-step reasoning internally, then return ONLY the JSON evaluation output.`;
}
