export interface DashboardData {
  isRunning: boolean;
  mode: 'paper' | 'live';
  dailyNetPnlEth: number;
  openPositionsCount: number;
  baseScannerActive: boolean;
  rhScannerActive: boolean;
  circuitBreakerTripped: boolean;
}

export function formatDashboard(data: DashboardData): string {
  const statusEmoji = data.isRunning ? '🟢' : '🔴';
  const statusText = data.isRunning ? 'RUNNING' : 'STOPPED';
  const modeEmoji = data.mode === 'paper' ? '📝' : '⚡';
  const modeText = data.mode.toUpperCase();
  const pnlSign = data.dailyNetPnlEth >= 0 ? '+' : '';
  const pnlEmoji = data.dailyNetPnlEth >= 0 ? '🟢' : '🔴';

  let alertBanner = '';
  if (data.circuitBreakerTripped) {
    alertBanner = `\n⚠️ <b>CIRCUIT BREAKER ACTIVE!</b> Auto-buying halted due to daily max loss limit.\n`;
  }

  return `🤖 <b>AI SCALPING BOT (MULTI-CHAIN)</b>
────────────────────────
<b>Status:</b> ${statusEmoji} <code>${statusText}</code>
<b>Trading Mode:</b> ${modeEmoji} <code>${modeText}</code>
<b>Active Positions:</b> <code>${data.openPositionsCount} Open</code>
<b>Daily 24h PnL:</b> ${pnlEmoji} <code>${pnlSign}${data.dailyNetPnlEth.toFixed(4)} ETH</code>${alertBanner}
<b>Chains Monitored:</b>
• 🔵 <b>Base (8453):</b> ${data.baseScannerActive ? '🟢 Scanner Active' : '⚪ Idle'} | Aerodrome / V3
• 🟣 <b>Robinhood (4663):</b> ${data.rhScannerActive ? '🟢 Scanner Active' : '⚪ Idle'} | Uniswap V4 / V3
────────────────────────
<i>Send any token Contract Address (CA) below for instant AI audit & snipe!</i>`;
}

export interface TradeSignalCardData {
  chainName: string;
  tokenSymbol: string;
  tokenAddress: string;
  entryPriceUsd: number;
  amountEth: number;
  takeProfitPct: number;
  stopLossPct: number;
  confidence: number;
  reasoning: string;
  signalsDetected: string[];
}

export function formatTradeSignalCard(card: TradeSignalCardData): string {
  const shortCA = `${card.tokenAddress.substring(0, 6)}...${card.tokenAddress.substring(card.tokenAddress.length - 4)}`;
  const signalsList = card.signalsDetected.map((s) => `• ${s}`).join('\n');

  return `🚀 <b>[${card.chainName.toUpperCase()} - AI SCALP ENTRY]</b>
────────────────────────
<b>Token:</b> $${card.tokenSymbol} (<code>${shortCA}</code>)
<b>Entry Price:</b> $${card.entryPriceUsd.toFixed(6)}
<b>Position Size:</b> ${card.amountEth} ETH
<b>Take Profit:</b> +${card.takeProfitPct.toFixed(1)}% ($${(card.entryPriceUsd * (1 + card.takeProfitPct / 100)).toFixed(6)})
<b>Stop Loss:</b> -${card.stopLossPct.toFixed(1)}% ($${(card.entryPriceUsd * (1 - card.stopLossPct / 100)).toFixed(6)})
<b>AI Confidence:</b> 🎯 <code>${card.confidence}%</code>

<b>Key Signals:</b>
${signalsList || '• Order flow & volume surge confirmed'}

<b>AI Reasoning:</b>
<i>"${card.reasoning}"</i>
────────────────────────`;
}

export interface ExitCardData {
  chainName: string;
  tokenSymbol: string;
  reason: string;
  pnlPct: number;
  pnlEth: number;
  closePriceUsd: number;
  txHash?: string;
}

export function formatExitCard(data: ExitCardData): string {
  const isProfit = data.pnlPct >= 0;
  const emoji = isProfit ? '🎉' : '🛑';
  const sign = isProfit ? '+' : '';

  return `${emoji} <b>[${data.chainName.toUpperCase()} - POSITION CLOSED]</b>
────────────────────────
<b>Token:</b> $${data.tokenSymbol}
<b>Exit Reason:</b> <code>${data.reason}</code>
<b>Close Price:</b> $${data.closePriceUsd.toFixed(6)}
<b>Realized PnL:</b> ${isProfit ? '🟢' : '🔴'} <b>${sign}${data.pnlPct.toFixed(2)}% (${sign}${data.pnlEth.toFixed(4)} ETH)</b>
────────────────────────`;
}
