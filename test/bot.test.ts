import { describe, it, expect } from 'vitest';
import { formatDashboard, formatTradeSignalCard, formatExitCard } from '../src/bot/messages/formatters.js';
import { buildMainMenuKeyboard, buildSnipeActionKeyboard } from '../src/bot/keyboards/menus.js';

describe('Telegram Bot UI: Formatters & Keyboards', () => {
  it('formats the main dashboard status message', () => {
    const text = formatDashboard({
      isRunning: true,
      mode: 'paper',
      dailyNetPnlEth: 0.045,
      openPositionsCount: 2,
      baseScannerActive: true,
      rhScannerActive: true,
      circuitBreakerTripped: false,
    });

    expect(text).toContain('AI SCALPING BOT');
    expect(text).toContain('RUNNING');
    expect(text).toContain('PAPER');
    expect(text).toContain('+0.0450 ETH');
  });

  it('formats an AI trade signal card with signals and reasoning', () => {
    const card = formatTradeSignalCard({
      chainName: 'Base',
      tokenSymbol: 'BRETT',
      tokenAddress: '0x532f27101965dd16442e59d40670faf5ebb142e4',
      entryPriceUsd: 0.082,
      amountEth: 0.02,
      takeProfitPct: 15,
      stopLossPct: 6,
      confidence: 88,
      reasoning: 'Breakout 5m volume spike 3.2x, buy ratio 74%, zero tax.',
      signalsDetected: ['Volume Surge 3x', 'Buy Pressure 74%'],
    });

    expect(card).toContain('BASE - AI SCALP ENTRY');
    expect(card).toContain('$BRETT');
    expect(card).toContain('88%');
    expect(card).toContain('+15.0%');
    expect(card).toContain('-6.0%');
    expect(card).toContain('Breakout 5m volume spike');
  });

  it('builds interactive inline keyboards', () => {
    const mainMenu = buildMainMenuKeyboard(true, 'paper');
    expect(mainMenu).toBeDefined();

    const snipeKeyboard = buildSnipeActionKeyboard(8453, '0x123');
    expect(snipeKeyboard).toBeDefined();
  });

  it('formats new token auto-sniper alert message with rich metrics and security score', async () => {
    const { formatNewTokenSnipeCard } = await import('../src/bot/messages/formatters.js');
    const text = formatNewTokenSnipeCard({
      chainName: 'Base',
      tokenName: 'Early Rocket',
      tokenSymbol: 'ROCKET',
      tokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
      entryPriceUsd: 0.02,
      amountEth: 0.01,
      initialLiquidityUsd: 5400,
      poolAgeMinutes: 4,
      securityScore: 92,
      aiConfidence: 88,
      aiReasoning: 'Liquidity verified, healthy micro-orderflow, clean contract.',
      takeProfitPct: 35,
      stopLossPct: 8,
    });

    expect(text).toContain('NEW TOKEN AUTO-SNIPE');
    expect(text).toContain('ROCKET');
    expect(text).toContain('4m ago');
    expect(text).toContain('92/100');
    expect(text).toContain('88%');
  });
});
