import { describe, it, expect, beforeEach } from 'vitest';
import { walletService } from '../src/core/services/walletService.js';
import { rateService } from '../src/core/services/rateService.js';
import {
  formatWalletCard,
  formatDepositCard,
  formatWithdrawGuide,
} from '../src/bot/messages/formatters.js';

describe('WalletService & Telegram Wallet Features', () => {
  beforeEach(() => {
    rateService.setMockRates({
      ethPriceUsd: 2600,
      ethPriceIdr: 42000000,
      usdToIdrRate: 16150,
      source: 'fallback',
    });
  });

  it('generates a valid QR code URL for deposit address', () => {
    const testAddr = '0x1234567890abcdef1234567890abcdef12345678';
    const qrUrl = walletService.generateDepositQrUrl(testAddr, 300);

    expect(qrUrl).toContain('api.qrserver.com');
    expect(qrUrl).toContain(encodeURIComponent(testAddr));
    expect(qrUrl).toContain('300x300');
  });

  it('formats deposit card properly with address and instructions', () => {
    const testAddr = '0x1234567890abcdef1234567890abcdef12345678';
    const card = formatDepositCard(testAddr);

    expect(card).toContain('DEPOSIT ETH KE WALLET');
    expect(card).toContain(testAddr);
    expect(card).toContain('Base Chain');
  });

  it('formats withdraw guide correctly with IDR conversion and command instructions', () => {
    const testAddr = '0x1234567890abcdef1234567890abcdef12345678';
    const guide = formatWithdrawGuide(testAddr, 0.5);

    expect(guide).toContain('WITHDRAW / KIRIM ETH');
    expect(guide).toContain('0.500000 ETH');
    expect(guide).toContain('Rp 21.000.000');
    expect(guide).toContain('/withdraw &lt;alamat_tujuan&gt; &lt;jumlah_eth&gt;');
  });

  it('formats wallet card with live ETH and IDR balances and PnL metrics', () => {
    const card = formatWalletCard({
      address: '0x1234567890abcdef1234567890abcdef12345678',
      balanceEth: 0.1,
      balanceUsd: 260,
      balanceIdr: 4200000,
      pnl24hEth: 0.02,
      pnl24hIdr: 840000,
      pnl24hPct: 25.0,
      snapshotCount: 5,
      lastUpdated: Date.now(),
    });

    expect(card).toContain('WALLET OVERVIEW');
    expect(card).toContain('0.100000 ETH');
    expect(card).toContain('$260.00');
    expect(card).toContain('Rp 4.200.000');
    expect(card).toContain('+0.020000 ETH');
    expect(card).toContain('+Rp 840.000');
    expect(card).toContain('+25.00%');
  });

  it('formats wallet card with multi-chain breakdown for Base and Robinhood', () => {
    const card = formatWalletCard({
      address: '0x1234567890abcdef1234567890abcdef12345678',
      balanceBaseEth: 0.06,
      balanceRobinhoodEth: 0.04,
      balanceTotalEth: 0.1,
      balanceEth: 0.1,
      balanceUsd: 260,
      balanceIdr: 4200000,
      pnl24hEth: 0,
      pnl24hIdr: 0,
      pnl24hPct: 0,
      snapshotCount: 2,
      lastUpdated: Date.now(),
    });

    expect(card).toContain('Base Chain:');
    expect(card).toContain('0.060000 ETH');
    expect(card).toContain('Robinhood:');
    expect(card).toContain('0.040000 ETH');
    expect(card).toContain('Total Saldo:');
    expect(card).toContain('0.100000 ETH');
  });

  it('formats deposit notification card with network and converted fiat amounts', async () => {
    const { formatDepositNotificationCard } = await import('../src/bot/messages/formatters.js');
    const notif = formatDepositNotificationCard({
      chainName: 'Robinhood',
      chainId: 4663,
      amountEth: 0.05,
      amountUsd: 130,
      amountIdr: 2100000,
      newBalanceEth: 0.09,
      address: '0x1234567890abcdef1234567890abcdef12345678',
    });

    expect(notif).toContain('DEPOSIT TERDETEKSI');
    expect(notif).toContain('Robinhood Chain');
    expect(notif).toContain('+0.050000 ETH');
    expect(notif).toContain('Rp 2.100.000');
    expect(notif).toContain('0.090000 ETH');
  });
});
