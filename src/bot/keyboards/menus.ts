import { InlineKeyboard } from 'grammy';

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
    .text('📜 Trade History', 'view_history')
    .row()
    .text('⚙️ Settings & Limits', 'view_settings')
    .text('🚨 PANIC SELL ALL', 'panic_sell_all')
    .row()
    .text('🔄 Refresh Status', 'refresh_status');
}

export function buildSnipeActionKeyboard(chainId: number, tokenAddress: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔫 Snipe 0.01 ETH', `snipe_${chainId}_0.01_${tokenAddress}`)
    .text('🔫 Snipe 0.03 ETH', `snipe_${chainId}_0.03_${tokenAddress}`)
    .row()
    .text('🔫 Snipe 0.05 ETH', `snipe_${chainId}_0.05_${tokenAddress}`)
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
