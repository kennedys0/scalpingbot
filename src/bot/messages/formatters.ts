export function escapeHtml(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface DashboardData {
  isRunning: boolean;
  mode: 'paper' | 'live' | 'shadow';
  strategyMode?: 'rules_only' | 'ai_veto' | 'dual_agent';
  dailyNetPnlEth: number;
  openPositionsCount: number;
  baseScannerActive: boolean;
  rhScannerActive: boolean;
  circuitBreakerTripped: boolean;
}

export function formatDashboard(data: DashboardData): string {
  const statusEmoji = data.isRunning ? '🟢' : '🔴';
  const statusText = data.isRunning ? 'RUNNING' : 'STOPPED';
  const modeEmoji = data.mode === 'live' ? '⚡' : data.mode === 'shadow' ? '👻' : '📝';
  const modeText = data.mode.toUpperCase();
  const stratText = (data.strategyMode || 'ai_veto').replace('_', ' ').toUpperCase();
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
<b>Strategy Mode:</b> 🎯 <code>${stratText}</code>
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
  const signalsList = card.signalsDetected.map((s) => `• ${escapeHtml(s)}`).join('\n');
  const safeSymbol = escapeHtml(card.tokenSymbol);
  const safeReasoning = escapeHtml(card.reasoning);

  return `🚀 <b>[${escapeHtml(card.chainName).toUpperCase()} - AI SCALP ENTRY]</b>
────────────────────────
<b>Token:</b> $${safeSymbol} (<code>${shortCA}</code>)
<b>Entry Price:</b> $${card.entryPriceUsd.toFixed(6)}
<b>Position Size:</b> ${card.amountEth} ETH
<b>Take Profit:</b> +${card.takeProfitPct.toFixed(1)}% ($${(card.entryPriceUsd * (1 + card.takeProfitPct / 100)).toFixed(6)})
<b>Stop Loss:</b> -${card.stopLossPct.toFixed(1)}% ($${(card.entryPriceUsd * (1 - card.stopLossPct / 100)).toFixed(6)})
<b>AI Confidence:</b> 🎯 <code>${card.confidence}%</code>

<b>Key Signals:</b>
${signalsList || '• Order flow & volume surge confirmed'}

<b>AI Reasoning:</b>
<i>"${safeReasoning}"</i>
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
  const safeSymbol = escapeHtml(data.tokenSymbol);
  const safeReason = escapeHtml(data.reason);

  return `${emoji} <b>[${escapeHtml(data.chainName).toUpperCase()} - POSITION CLOSED]</b>
────────────────────────
<b>Token:</b> $${safeSymbol}
<b>Exit Reason:</b> <code>${safeReason}</code>
<b>Close Price:</b> $${data.closePriceUsd.toFixed(6)}
<b>Realized PnL:</b> ${isProfit ? '🟢' : '🔴'} <b>${sign}${data.pnlPct.toFixed(2)}% (${sign}${data.pnlEth.toFixed(4)} ETH)</b>
────────────────────────`;
}

export function generatePerformanceReport(trades: any[]): string {
  const closedTrades = trades.filter((t) => t.status === 'CLOSED');
  const total = closedTrades.length;
  if (total === 0) {
    return `📊 <b>DAILY PERFORMANCE REPORT</b>\n────────────────────────\nBelum ada trade yang ditutup hari ini.`;
  }

  const wins = closedTrades.filter((t) => (t.realizedPnlEth ?? 0) > 0);
  const losses = closedTrades.filter((t) => (t.realizedPnlEth ?? 0) <= 0);
  const winRate = ((wins.length / total) * 100).toFixed(1);
  const totalNetPnlEth = closedTrades.reduce((acc, t) => acc + (t.realizedPnlEth ?? 0), 0);

  // Sort to find best and worst
  const sorted = [...closedTrades].sort((a, b) => (b.realizedPnlPct ?? 0) - (a.realizedPnlPct ?? 0));
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  const pnlSign = totalNetPnlEth >= 0 ? '+' : '';
  const pnlEmoji = totalNetPnlEth >= 0 ? '🟢' : '🔴';

  // AI Score vs PnL Calibration Breakdown
  const highTier = closedTrades.filter((t) => (t.aiScore ?? 0) >= 85);
  const midTier = closedTrades.filter((t) => (t.aiScore ?? 0) >= 75 && (t.aiScore ?? 0) < 85);
  const rulesTier = closedTrades.filter((t) => !t.aiScore || t.strategyMode === 'rules_only');

  const calcTierWR = (list: any[]) => {
    if (list.length === 0) return 'N/A';
    const w = list.filter((t) => (t.realizedPnlEth ?? 0) > 0).length;
    return `${((w / list.length) * 100).toFixed(0)}% (${w}/${list.length})`;
  };

  return `📊 <b>DAILY PERFORMANCE REPORT</b>
────────────────────────
<b>Total Trades:</b> <code>${total}</code> (${wins.length}W / ${losses.length}L)
<b>Win Rate:</b> <code>${winRate}%</code>
<b>Net PnL:</b> ${pnlEmoji} <code>${pnlSign}${totalNetPnlEth.toFixed(4)} ETH</code>

🎯 <b>AI Calibration (Score vs Win Rate):</b>
• High Score (≥85%): <code>${calcTierWR(highTier)}</code>
• Moderate (75-84%): <code>${calcTierWR(midTier)}</code>
• Rules-Only: <code>${calcTierWR(rulesTier)}</code>

🏆 <b>Best Trade:</b> $${escapeHtml(best.tokenSymbol)} (+${best.realizedPnlPct?.toFixed(1)}%)
📉 <b>Worst Trade:</b> $${escapeHtml(worst.tokenSymbol)} (${worst.realizedPnlPct?.toFixed(1)}%)
────────────────────────`;
}

export interface AiDebateCardData {
  chainName: string;
  tokenSymbol: string;
  tokenAddress: string;
  hunterDecision: {
    action: string;
    confidence: number;
    takeProfitPct?: number;
    stopLossPct?: number;
    reasoning?: string;
    signalsDetected?: string[];
  };
  auditorDecision: {
    action: string;
    confidence: number;
    takeProfitPct?: number;
    stopLossPct?: number;
    reasoning?: string;
  };
  consensus: {
    action: string;
    consensusScore: number;
    takeProfitPct: number;
    stopLossPct: number;
  };
}

export function formatAiDebateCard(data: AiDebateCardData): string {
  const isAgreed = data.consensus.action === 'BUY';
  const statusEmoji = isAgreed ? '🟢' : data.consensus.action === 'AVOID' ? '🔴' : '🟡';
  const consensusText = isAgreed ? 'CONSENSUS BUY' : data.consensus.action === 'AVOID' ? 'REJECTED / AVOID' : 'WAIT / CAUTION';

  const hunterEmoji = data.hunterDecision.action === 'BUY' ? '🟢' : '🔴';
  const auditorEmoji = data.auditorDecision.action === 'BUY' ? '🟢' : '🔴';

  return `⚔️ <b>[DUAL AI DEBATE FEED]</b>
────────────────────────
<b>Token:</b> $${escapeHtml(data.tokenSymbol)} (<code>${data.tokenAddress.substring(0, 8)}...${data.tokenAddress.substring(data.tokenAddress.length - 6)}</code>)
<b>Network:</b> ${escapeHtml(data.chainName)}

🏹 <b>Hunter Agent (Bull Momentum):</b>
• Stance: ${hunterEmoji} <b>${data.hunterDecision.action}</b> (Confidence: <b>${data.hunterDecision.confidence}%</b>)
• Target: TP <code>+${data.hunterDecision.takeProfitPct ?? 20}%</code> | SL <code>-${data.hunterDecision.stopLossPct ?? 6}%</code>
• Reasoning: <i>"${escapeHtml(data.hunterDecision.reasoning || 'No details')}"</i>

🛡️ <b>Auditor Agent (Bear Risk):</b>
• Stance: ${auditorEmoji} <b>${data.auditorDecision.action}</b> (Confidence: <b>${data.auditorDecision.confidence}%</b>)
• Target: TP <code>+${data.auditorDecision.takeProfitPct ?? 20}%</code> | SL <code>-${data.auditorDecision.stopLossPct ?? 6}%</code>
• Audit Note: <i>"${escapeHtml(data.auditorDecision.reasoning || 'No details')}"</i>

⚖️ <b>Debate Consensus Verdict:</b>
• Outcome: ${statusEmoji} <b>${consensusText}</b> (Consensus Score: <b>${data.consensus.consensusScore}%</b>)
${isAgreed ? `• Agreed Setup: TP <code>+${data.consensus.takeProfitPct}%</code> | SL <code>-${data.consensus.stopLossPct}%</code>\n• Status: <i>Maju ke evaluasi Risk Engine Expected Value (EV)...</i>` : `• Status: <i>Dibatalkan. Token masuk temporary blacklist cooldown.</i>`}
────────────────────────`;
}

export interface RiskEvaluationCardData {
  chainName: string;
  tokenSymbol: string;
  stage: 'SECURITY_SCORE' | 'EV_CALCULATOR';
  passed: boolean;
  score?: number;
  expectedValuePct?: number;
  winProbPct?: number;
  frictionPct?: number;
  reason?: string;
}

export function formatRiskEvaluationCard(data: RiskEvaluationCardData): string {
  if (data.stage === 'SECURITY_SCORE') {
    const statusEmoji = data.passed ? '✅' : '⛔';
    return `🛡️ <b>[TOKEN SECURITY EVALUATION]</b>
────────────────────────
<b>Token:</b> $${escapeHtml(data.tokenSymbol)} | <b>Network:</b> ${escapeHtml(data.chainName)}
<b>Security Score:</b> <b>${data.score}/100</b> ${statusEmoji} (Min: 80)
<b>Verdict:</b> ${data.passed ? '🟢 <b>PASSED MULTI-FACTOR CHECK</b>' : '🔴 <b>REJECTED BY SECURITY FILTER</b>'}
${data.reason ? `• Catatan: <i>${escapeHtml(data.reason)}</i>\n` : ''}────────────────────────`;
  }

  const evEmoji = data.passed ? '🚀' : '⛔';
  return `📊 <b>[RISK ENGINE EV GATEKEEPER]</b>
────────────────────────
<b>Token:</b> $${escapeHtml(data.tokenSymbol)} | <b>Network:</b> ${escapeHtml(data.chainName)}
• Win Probability: <b>${data.winProbPct}%</b> (Terkalibrasi)
• Round-Trip Friction: <b>${data.frictionPct?.toFixed(1)}%</b> (Gas + Slippage)
• Net Expected Value: <b>${data.expectedValuePct && data.expectedValuePct >= 0 ? '+' : ''}${data.expectedValuePct?.toFixed(2)}%</b> (Min: +1.5%)
<b>Verdict:</b> ${evEmoji} <b>${data.passed ? 'APPROVED FOR EXECUTION' : 'VETOED (INSUFFICIENT EDGE)'}</b>
${data.reason ? `• Reason: <i>${escapeHtml(data.reason)}</i>\n` : ''}────────────────────────`;
}

export function formatLiveFeedSummary(activities: any[]): string {
  if (!activities || activities.length === 0) {
    return `📡 <b>LIVE AI ACTIVITY FEED</b>\n────────────────────────\nBelum ada riwayat aktivitas terbaru. Scanner sedang aktif memantau jaringan.`;
  }

  const items = activities.slice(-7).reverse().map((a) => {
    const date = new Date(a.timestamp);
    const time = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
    const levelEmoji = a.level === 'SUCCESS' ? '🟢' : a.level === 'WARN' ? '⚠️' : a.level === 'ALERT' ? '🚨' : 'ℹ️';
    const tag = `[${a.stage}]`;
    return `<code>${time}</code> ${levelEmoji} <b>${tag}</b> ${escapeHtml(a.message)}`;
  }).join('\n\n');

  return `📡 <b>LIVE AI & SCANNER ACTIVITY FEED</b>
────────────────────────
${items}
────────────────────────
<i>Gunakan /menu untuk kembali ke dashboard utama.</i>`;
}
