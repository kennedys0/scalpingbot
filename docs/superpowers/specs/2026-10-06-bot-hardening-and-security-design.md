# Design Specification: Bot Hardening, Real Security Scoring, Anti-Phantom Execution & Accurate On-Chain Accounting

- **Date:** 2026-10-06
- **Status:** Approved
- **Scope:** Architectural Hardening (Remediation of 5 Critical Flaws)
- **Target Repository:** `kennedys0/scalpingbot`

---

## 1. Executive Summary & Problem Statement

An audit of the TypeScript scalping bot revealed five critical vulnerabilities:
1. **Fake / Hardcoded Security Score:** `TokenSecurityScorer.calculateScore()` was invoked with hardcoded values (`canSell: true, isHoneypot: false, buyTaxPct: 0, sellTaxPct: 0`), resulting in deceptive "87/100 ✅ PASSED" scores regardless of real honeypot status, taxes, or top holder concentration.
2. **Phantom Trades:** Both `BaseRouterExecutor` and `RobinhoodRouterExecutor` broadcasted transactions via `wallet.sendTransaction` and immediately assumed success without awaiting on-chain block receipts (`waitForTransactionReceipt`). Reverted transactions were recorded as active open positions or winning sells.
3. **Inaccurate Nominal Profit Calculation:** PnL was calculated purely as a mathematical percentage of DexScreener token prices (`costEth * (pnlPct / 100)`), ignoring actual wallet ETH balance changes, swap slippage, token transfer taxes, and round-trip gas costs. Tokens with nominal price spikes (e.g. NFTM +30%) resulted in net negative wallet ETH.
4. **Duplicate & Copycat Token Exploits:** Tokens were tracked solely by contract address. Scammers deploying multiple copycat contracts with identical symbols (e.g. `$OPENHUMAN`) bypassed filters, causing the bot to buy duplicate honeypot tokens simultaneously.
5. **Robinhood DEX Mismatch:** Robinhood Chain (Chain ID: 4663) memecoin liquidity resides on Uniswap V4, while the executor used Uniswap V2 functions directed to an unverified Uniswap V3 SwapRouter02 contract, leading to guaranteed on-chain reverts masked as phantom trades.

---

## 2. Architecture & System Design

```
                     ┌──────────────────────────────────┐
                     │   DexScreener & Pool Scanners    │
                     └─────────────────┬────────────────┘
                                       │
                                       ▼
                     ┌──────────────────────────────────┐
                     │  1. Token Deduplication Guard    │
                     │  - Normalize ticker              │
                     │  - Reject duplicate active symbol│
                     │  - Cooldown for rugged symbols   │
                     └─────────────────┬────────────────┘
                                       │
                                       ▼
                     ┌──────────────────────────────────┐
                     │  2. Token Security Verification  │
                     │  - GoPlus Security API (Base)    │
                     │  - On-Chain Simulator Fallback   │
                     │  - Dynamic TokenSecurityScorer   │
                     │    (Real Honeypot/Tax/Holders)   │
                     └─────────────────┬────────────────┘
                                       │
                                       ▼ (Score >= 80 & canSell)
                     ┌──────────────────────────────────┐
                     │  3. Execution & Receipt Guard    │
                     │  - Robinhood Guard -> Paper Mode │
                     │  - Pre-trade wallet ETH snapshot │
                     │  - Await waitForTxReceipt        │
                     │  - Verify receipt.status==success│
                     │  - Query exact balanceOf tokens  │
                     └─────────────────┬────────────────┘
                                       │
                                       ▼
                     ┌──────────────────────────────────┐
                     │  4. Accurate On-Chain Accounting │
                     │  - Post-sell wallet ETH snapshot │
                     │  - Real PnL = Delta ETH - Gas    │
                     │  - Position reconciliation       │
                     └──────────────────────────────────┘
```

---

## 3. Detailed Component Specifications

### 3.1 Token Security Service (`src/core/services/securityService.ts`)

A dedicated security service querying the GoPlus Security API for EVM tokens (specifically Base, chainId `8453`) with an in-memory TTL cache and graceful on-chain fallback:
- **GoPlus API Endpoint:** `https://api.gopluslabs.io/api/v1/token_security/{chainId}?contract_addresses={tokenAddress}`
- **Extracted Fields:**
  - `is_honeypot`: Boolean flag.
  - `buy_tax`: Buy tax percentage (e.g. "0.05" -> 5%).
  - `sell_tax`: Sell tax percentage (e.g. "0.05" -> 5%).
  - `holder_count`: Total holder count.
  - `holders`: Top holder list used to compute top 10 holders' percentage of total supply.
  - `is_open_trading`: Trading status.
  - `cannot_sell_all`: Hidden honeypot trap check.
- **Cache Policy:** 5-minute in-memory cache to prevent redundant external API hits.
- **Timeout & Fallback:** 3,500ms timeout. If GoPlus is unreachable, falls back to `OnChainHoneypotSimulator`.

### 3.2 Dynamic Token Security Scorer (`src/core/screener/securityScore.ts`)

Update `TokenSecurityFactors` and score distribution:
- **Simulation & Honeypot (Max 30 pts):**
  - If `isHoneypot || !canSell || isOpenTrading === false` -> Score is forced to **0** and immediately **REJECTED**.
- **Real Taxes (Max 25 pts):**
  - Max tax $\le 2\%$: 25 pts
  - Max tax $2\% - 5\%$: 15 pts
  - Max tax $5\% - 10\%$: 5 pts
  - Max tax $> 10\%$: 0 pts with high-tax warning
- **Holder Distribution & Count (Max 20 pts):**
  - Holder count $> 100$ AND Top 10 holders $< 50\%$: 20 pts
  - Top 10 holders between $50\% - 70\%$: 10 pts
  - Top 10 holders $> 70\%$ OR total holders $< 30$: 0 pts (extreme whale dump risk)
- **Pool Liquidity Depth (Max 15 pts):**
  - $\ge \$50,000$: 15 pts
  - $\ge \$20,000$: 12 pts
  - $\ge \$10,000$: 8 pts
  - $<\$5,000$: 0 pts
- **Liquidity / FDV Dilution Ratio (Max 10 pts):**
  - Ratio $\ge 8\%$: 10 pts
  - Ratio $3\% - 8\%$: 5 pts
  - Ratio $< 3\%$: 0 pts

### 3.3 Symbol Deduplication & Anti-Copycat Protection (`src/core/positions/tracker.ts` & `src/core/orchestrator.ts`)

- **Normalized Symbol:** Cleaned ticker uppercase: `symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')`.
- **Active Position Limit:** Only 1 concurrent position is permitted per normalized symbol (`hasOpenPositionForSymbol(symbol)`).
- **Copycat Rejection:** If token `$FOO` is currently held or was rugged within the last 24 hours, any new candidate presenting `$FOO` with a different contract address is rejected with reason `DUPLICATE_TICKER_ACTIVE` or `RECENT_RUG_COOLDOWN`.

### 3.4 Anti-Phantom Trade Execution (`src/core/execution/routers/baseRouter.ts`)

- **Mandatory Receipt Confirmation:**
  - `executeBuy`: Sends transaction, calls `publicClient.waitForTransactionReceipt({ hash, timeout: 30000 })`.
  - Verifies `receipt.status === 'success'`.
  - Upon success, queries actual `balanceOf(account.address)` on-chain to store the true token balance held (post-tax & slippage).
  - If status is `'reverted'`, returns `{ success: false, error: 'Buy reverted on-chain' }`. No position is opened in `PositionTracker`.
- **Sell Confirmation:**
  - `executeSell`: Sends transaction, calls `publicClient.waitForTransactionReceipt({ hash, timeout: 30000 })`.
  - If status is `'reverted'`, returns `{ success: false, error: 'Sell reverted on-chain' }`. The position remains open or enters write-off with an urgent Telegram alert.

### 3.5 Robinhood Chain Safety Guard (`src/core/execution/engine.ts`)

- If `order.chainId === 4663` (Robinhood Chain) and engine mode is `'live'`:
  - Intercept the order and automatically route it to `paperTrader.simulateBuy` / `simulateSell`.
  - Log warning: `⚠️ Robinhood memecoin pool V4 detected - live execution diverted to paper mode to avoid router revert.`
  - Prevents loss of user funds while Uniswap V4 Universal Router integration is pending.

### 3.6 Accurate On-Chain Accounting (`src/core/execution/routers/baseRouter.ts` & `src/core/positions/tracker.ts`)

- **Wallet Native Delta Measurement:**
  1. `balanceBefore = await publicClient.getBalance({ address: account.address })` before sell.
  2. Await `waitForTransactionReceipt`.
  3. `balanceAfter = await publicClient.getBalance({ address: account.address })`.
  4. Real gas fee: `gasUsed * effectiveGasPrice`.
  5. Net ETH received: `Number(formatEther(balanceAfter - balanceBefore))`.
  6. Realized PnL: `netDeltaEth` (accounting for sell gas deducted from wallet).
  7. Realized PnL %: `(realizedPnlEth / position.costEth) * 100`.
- **Telegram & Database Reporting:**
  - Persist `realizedPnlEth`, `realizedPnlPct`, and exact transaction hashes to `db.json`.
  - Present clean net ETH breakdown in Telegram messages.

---

## 4. Testing & Verification Plan

1. **Unit Tests:**
   - `test/securityService.test.ts`: Verify GoPlus API fetching, parsing, caching, and fallback behavior.
   - `test/securityScore.test.ts`: Verify dynamic scoring with real factors (honeypots receive 0, high taxes receive heavy penalties, top holder concentration lowers score).
   - `test/dedup.test.ts`: Verify single-position-per-symbol enforcement and copycat blocking.
   - `test/receiptConfirmation.test.ts`: Verify reverted transactions do not trigger phantom positions.
   - `test/realAccounting.test.ts`: Verify net wallet ETH delta calculation with gas cost.
   - `test/rhGuard.test.ts`: Verify Robinhood live order divert to paper mode.
2. **Regression Testing:**
   - Run existing Vitest test suite (`npm test`) to guarantee all 85 existing tests pass.
