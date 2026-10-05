import { Bot, Context } from 'grammy';
import { isAddress } from 'viem';
import { buildSnipeActionKeyboard } from '../keyboards/menus.js';
import { InstantSniper } from '../../core/sniper/instantSnipe.js';
import { escapeHtml, formatEthWithIdr, formatPriceWithIdr } from '../messages/formatters.js';

export function registerSnipeInput(
  bot: Bot,
  context: {
    sniper: InstantSniper;
    onSnipeExecuted?: (result: any) => Promise<void>;
  }
): void {
  // Listen for EVM contract address sent directly to chat
  bot.hears(/^0x[a-fA-F0-9]{40}$/, async (ctx: Context) => {
    const address = ctx.message?.text?.trim();
    if (!address || !isAddress(address)) return;

    const text = `🎯 <b>CONTRACT ADDRESS DETECTED!</b>
────────────────────────
<code>${address}</code>

Pilih aksi snipe atau audit AI di bawah ini:`;

    // Default to Base (8453), option to switch to Robinhood (4663)
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: buildSnipeActionKeyboard(8453, address),
    });
  });

  // Handle snipe action callbacks: `snipe_<chainId>_<amountEth>_<tokenAddress>`
  bot.callbackQuery(/^snipe_(\d+)_(.+?)_(0x[a-fA-F0-9]{40})$/, async (ctx: Context) => {
    const match = ctx.match as RegExpMatchArray;
    const chainId = parseInt(match[1], 10);
    const amountEth = parseFloat(match[2]);
    const tokenAddress = match[3];

    await ctx.answerCallbackQuery(`🔫 Sniping ${amountEth} ETH on Chain ${chainId}...`);

    const result = await context.sniper.executeSnipe({
      chainId,
      tokenAddress,
      amountEth,
    });

    if (result.success) {
      const priceText = result.filledPriceUsd ? formatPriceWithIdr(result.filledPriceUsd) : 'Market';
      await ctx.reply(
        `✅ <b>SNIPE SUCCESSFUL!</b>\nToken: <code>${tokenAddress}</code>\nAmount: ${formatEthWithIdr(amountEth)}\nFilled at: ${priceText}\nTxHash: <code>${result.txHash}</code>`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(`❌ <b>SNIPE FAILED:</b> ${escapeHtml(result.error)}`, { parse_mode: 'HTML' });
    }
  });
}
