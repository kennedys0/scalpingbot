import { ORDER_FLOW_KNOWLEDGE } from './knowledge/orderflow.js';
import { LIQUIDITY_KNOWLEDGE } from './knowledge/liquidity.js';
import { CHAIN_SPECIFIC_KNOWLEDGE } from './knowledge/chains.js';
import { MicrostructureMetrics } from '../scanner/metrics.js';

export function buildAuditorSystemPrompt(chainId: number): string {
  const chainName = chainId === 8453 ? 'Base' : 'Robinhood';
  const specificKnowledge = chainId === 8453 ? CHAIN_SPECIFIC_KNOWLEDGE.base : CHAIN_SPECIFIC_KNOWLEDGE.robinhood;

  return `Kamu adalah Auditor Risiko Kripto & Spesialis Keamanan Mikrostruktur DEX (Crypto Risk Auditor & Microstructure Security Specialist) pada jaringan ${chainName}.

PERAN & TUGAS UTAMA:
1. Perlindungan Modal (Capital Preservation) adalah Prioritas #1 Mutlak.
2. Bertindaklah sebagai Risk Auditor yang kritis, skeptis, dan waspada terhadap segala bentuk jebakan likuiditas, dump tersembunyi oleh dev/insider, manipulasi volume (wash trading), dan potensi rug pull/honeypot.
3. Berikan rekomendasi tindakan:
   - "BUY": Hanya jika data order flow murni akumulasi sehat, buy pressure stabil (>= 60%), likuiditas aman, dan rasio Risk/Reward >= 2.0.
   - "WAIT": Jika momentum belum jelas atau volatilitas membahayakan tanpa arah yang pasti.
   - "AVOID": Jika terdeteksi distribusi paus/dev, tekanan jual mendominasi, likuiditas tipis/tidak seimbang, atau risiko dump tinggi.

BASIS PENGETAHUAN AUDITOR:
${ORDER_FLOW_KNOWLEDGE}

${LIQUIDITY_KNOWLEDGE}

${specificKnowledge}

ATURAN BAHASA (LANGUAGE REQUIREMENT - WAJIB BAHASA INDONESIA):
- Field "reasoning" WAJIB ditulis dalam Bahasa Indonesia yang profesional, analitis, padat, dan jelas mengenai analisa risiko atau potensi keuntungan scalping.
- Field "signalsDetected" WAJIB berisi poin-poin sinyal kunci dalam Bahasa Indonesia (contoh: ["Tekanan Beli Kuat", "Akumulasi Sehat", "Likuiditas Memadai", "Risiko Dump Rendah"]).

FORMAT OUTPUT:
Kamu WAJIB mengeluarkan output HANYA RAW JSON valid tanpa markdown atau teks pengantar lainnya:
{
  "action": "BUY" | "WAIT" | "AVOID",
  "confidence": number (0 sampai 100),
  "takeProfitPct": number (0 jika WAIT/AVOID, atau target profit % jika BUY),
  "stopLossPct": number (0 jika WAIT/AVOID, atau batas risiko % jika BUY),
  "suggestedAllocEth": number (0 jika WAIT/AVOID, atau ukuran posisi dalam ETH jika BUY),
  "timeframeMinutes": number (0 jika WAIT/AVOID, atau estimasi durasi hold menit jika BUY),
  "riskRewardRatio": number (0 jika WAIT/AVOID, atau rasio jika BUY),
  "reasoning": string (Wajib dalam Bahasa Indonesia: penjelasan rinci hasil audit risiko dan kondisi order flow),
  "signalsDetected": string[] (Wajib dalam Bahasa Indonesia: daftar sinyal mikrostruktur kunci)
}
`;
}

export function buildScalpSystemPrompt(chainId: number, role: 'hunter' | 'auditor' = 'hunter'): string {
  if (role === 'auditor') {
    return buildAuditorSystemPrompt(chainId);
  }

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
  "takeProfitPct": number (0 if WAIT/AVOID, or expected gain % if BUY),
  "stopLossPct": number (0 if WAIT/AVOID, or risk % if BUY),
  "suggestedAllocEth": number (0 if WAIT/AVOID, or suggested size in ETH if BUY),
  "timeframeMinutes": number (0 if WAIT/AVOID, or expected hold time in minutes if BUY),
  "riskRewardRatio": number (0 if WAIT/AVOID, or ratio if BUY),
  "reasoning": string (concise explanation of signals and risk evaluation),
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

function sanitizeString(str: string, maxLength: number = 32): string {
  if (!str) return 'UNKNOWN';
  return str.replace(/[\r\n\t"'{}\[\]\\]/g, '').substring(0, maxLength).trim();
}

export function buildScalpUserPrompt(input: ScalpCandidateInput, role: 'hunter' | 'auditor' = 'auditor'): string {
  const m = input.metrics;
  const memoryBlock = input.pastLessons ? `\n\n${input.pastLessons}` : '';
  const smartMoneyBlock = input.smartMoneyInfo ? `\n\nSmart Money Whale Alert:\n- ${input.smartMoneyInfo}` : '';

  const safeName = sanitizeString(input.tokenName, 32);
  const safeSymbol = sanitizeString(input.tokenSymbol, 16);

  const instructions =
    role === 'auditor'
      ? 'Lakukan audit risiko mikrostruktur order flow dan likuiditas untuk pair ini. Kemukakan reasoning dan signalsDetected dalam Bahasa Indonesia secara mendalam dan padat, lalu kembalikan HANYA format JSON valid sesuai skema.'
      : 'Perform step-by-step reasoning internally, then return ONLY the JSON evaluation output.';

  return `Analyze this live DEX pair for a potential rapid scalp entry:

Token: ${safeName} ($${safeSymbol})
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

${instructions}`;
}
