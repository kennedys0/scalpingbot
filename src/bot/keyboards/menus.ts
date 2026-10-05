import { InlineKeyboard, Keyboard } from 'grammy';
import { rateService } from '../../core/services/rateService.js';

export function buildPersistentReplyKeyboard(): Keyboard {
  return new Keyboard()
    .text('▶️ Start / Menu').text('📊 Positions')
    .row()
    .text('💼 Wallet').text('📜 Report')
    .row()
    .text('📡 Live Feed').text('⚙️ Settings')
    .resized()
    .persistent();
}

export function buildMainMenuKeyboard(
  isRunning: boolean,
  mode: 'paper' | 'live' | 'shadow',
  strategyMode: 'rules_only' | 'ai_veto' | 'dual_agent' = 'ai_veto'
): InlineKeyboard {
  const toggleRunText = isRunning ? '🔴 Stop Engine' : '🟢 Start Engine';
  const toggleRunData = isRunning ? 'engine_stop' : 'engine_start';

  let toggleModeText = '⚡ Switch to Live';
  let toggleModeData = 'mode_live';
  if (mode === 'paper') {
    toggleModeText = '👻 Switch to Shadow';
    toggleModeData = 'mode_shadow';
  } else if (mode === 'shadow') {
    toggleModeText = '⚡ Switch to Live';
    toggleModeData = 'mode_live';
  } else {
    toggleModeText = '📝 Switch to Paper';
    toggleModeData = 'mode_paper';
  }

  return new InlineKeyboard()
    .text(toggleRunText, toggleRunData)
    .text(toggleModeText, toggleModeData)
    .row()
    .text(strategyMode === 'rules_only' ? '✅ ⚡ Rules-Only' : '⚡ Rules-Only', 'strat_rules_only')
    .text(strategyMode === 'ai_veto' ? '✅ 🛡️ AI Veto' : '🛡️ AI Veto', 'strat_ai_veto')
    .text(strategyMode === 'dual_agent' ? '✅ ⚔️ Dual AI' : '⚔️ Dual AI', 'strat_dual_agent')
    .row()
    .text('📊 Active Positions', 'view_positions')
    .text('📡 Live AI Feed', 'view_feed')
    .row()
    .text('📜 Trade History', 'view_history')
    .text('⚙️ Settings & Limits', 'view_settings')
    .row()
    .text('💼 Wallet', 'wallet_overview')
    .row()
    .text('🚨 PANIC SELL ALL', 'panic_sell_all')
    .row()
    .text('🔄 Refresh Status', 'refresh_status');
}

export function buildWalletKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔄 Refresh Saldo', 'wallet_refresh')
    .row()
    .text('📥 Deposit (QR Code)', 'wallet_deposit')
    .text('📤 Withdraw', 'wallet_withdraw')
    .row()
    .text('📈 Riwayat 24 Jam', 'wallet_history')
    .row()
    .text('🔙 Kembali ke Menu', 'refresh_status');
}

export function buildSnipeActionKeyboard(chainId: number, tokenAddress: string): InlineKeyboard {
  const ethIdr = rateService.getEthPriceIdr();
  const formatShortIdr = (eth: number) => {
    const idr = eth * ethIdr;
    if (idr >= 1_000_000) {
      return `~Rp ${(idr / 1_000_000).toFixed(1).replace('.', ',')}jt`;
    }
    return `~Rp ${Math.round(idr / 1000)}rb`;
  };

  return new InlineKeyboard()
    .text(`🔫 Snipe 0.01 ETH (${formatShortIdr(0.01)})`, `snipe_${chainId}_0.01_${tokenAddress}`)
    .text(`🔫 Snipe 0.03 ETH (${formatShortIdr(0.03)})`, `snipe_${chainId}_0.03_${tokenAddress}`)
    .row()
    .text(`🔫 Snipe 0.05 ETH (${formatShortIdr(0.05)})`, `snipe_${chainId}_0.05_${tokenAddress}`)
    .text('🤖 AI Deep Audit', `audit_${chainId}_${tokenAddress}`)
    .row()
    .text('❌ Cancel', 'dismiss');
}

export function buildPositionActionKeyboard(positionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('⚡ Market Sell Now', `close_pos_${positionId}`)
    .text('📈 View Chart', `chart_${positionId}`)
    .row()
    .text('🔙 Back to Menu', 'refresh_status');
}
