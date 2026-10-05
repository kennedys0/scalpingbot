import { parseAbi } from 'viem';
import { PositionTracker } from './tracker.js';
import { ViemClientManager } from '../execution/viemClient.js';

export interface ReconciliationSummary {
  checkedCount: number;
  closedCount: number;
  activeCount: number;
  reconciledPositions: string[];
}

export async function reconcilePositionsOnChain(
  tracker: PositionTracker,
  viemManager: ViemClientManager
): Promise<ReconciliationSummary> {
  const active = await tracker.getActivePositions();
  let closedCount = 0;
  const reconciledPositions: string[] = [];

  for (const pos of active) {
    if (pos.mode !== 'live') continue;

    const publicClient = viemManager.getPublicClient(pos.chainId);
    const walletClient = viemManager.getWalletClient(pos.chainId);
    if (!walletClient || !walletClient.account) continue;

    try {
      const erc20Abi = parseAbi([
        'function balanceOf(address account) external view returns (uint256)',
      ]);

      const balance = await publicClient.readContract({
        address: pos.tokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [walletClient.account.address],
      });

      // If token balance on-chain is 0, user closed or sold position externally
      if (balance === 0n) {
        await tracker.closePosition(
          pos.id,
          0,
          'RECONCILED_ON_CHAIN_ZERO_BALANCE',
          -pos.costEth
        );
        closedCount++;
        reconciledPositions.push(`$${pos.tokenSymbol} (${pos.tokenAddress})`);
      }
    } catch (err) {
      console.warn(`[Reconcile] Could not query on-chain balance for ${pos.tokenSymbol}: ${(err as Error).message}`);
    }
  }

  return {
    checkedCount: active.length,
    closedCount,
    activeCount: active.length - closedCount,
    reconciledPositions,
  };
}
