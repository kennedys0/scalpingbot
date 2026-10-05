# Design Spec: New Token Auto-Sniper with Dual-Stage AI Monitoring

**Date**: 2026-10-05  
**Status**: Ready for User Review  
**Target Environment**: Node.js / TypeScript (v20+), Viem, DexScreener/GeckoTerminal APIs, OpenRouter LLM, GrammY  

---

## 1. Overview & Objectives

In decentralized crypto trading (especially Base and Robinhood L2), the highest upside opportunities often occur during the first few minutes of a newly deployed token/pool. However, over 90% of newly created pools are honeypots, rug pulls, or liquidity drain traps.

The objective of this feature is to introduce an autonomous **New Token Auto-Sniper** with **Dual-Stage AI Monitoring**:
1. **Real-time Discovery**: Continuously poll and discover newly created pools on supported chains (Base & Robinhood) within seconds/minutes of pool deployment.
2. **Multi-Layer Pre-Snipe Safety Gates**:
   - Algorithmic on-chain security screening (Token Security Score $\ge 80/100$, transferability, honeypot simulation, and minimum initial liquidity).
   - **Stage 1 AI Veto**: Fast LLM Auditor check to evaluate deployer signals, suspicious contract heuristics, and tokenomics before committing funds.
3. **Automated Snipe Execution**: Instant execution according to `.env` parameters (`SNIPER_TRADE_SIZE_ETH`, `SNIPER_SLIPPAGE_PCT`).
4. **Stage 2 Post-Snipe AI Active Monitoring**:
   - Order flow & CVD monitoring on opened sniper positions.
   - Dynamic emergency exit if sudden massive sell delta or developer rug pull is detected.
   - Automated take-profit and trailing-stop management.
5. **Real-time Telegram Reporting**: Rich Telegram notifications for every detected, vetoed, or executed snipe.

---

## 2. Architecture & Data Flow

```
                  ┌──────────────────────────────────────────────┐
                  │ GeckoTerminal / DexScreener New Pools Stream │
                  └──────────────────────┬───────────────────────┘
                                         │ (Polling interval ~8-10s)
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ 1. NewPoolsScanner (src/core/scanner/)       │
                  │    - Pool Age <= SNIPER_MAX_AGE_MINUTES      │
                  │    - Pool Liquidity >= SNIPER_MIN_LIQ_USD    │
                  │    - Deduplication: In-memory & cache check  │
                  └──────────────────────┬───────────────────────┘
                                         │ New Pool Candidate
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ 2. Algorithmic Fast Security Check           │
                  │    - BlacklistManager check                  │
                  │    - TokenSecurityScorer >= MIN_SCORE (80)   │
                  │    - OnChainHoneypotSimulator (sellable?)    │
                  └──────────────────────┬───────────────────────┘
                                         │ Passed Security Score
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ 3. Stage 1: AI Pre-Snipe Veto Gate           │
                  │    - Auditor / Fast LLM Evaluation           │
                  │    - Detects spoofing, distribution, scam    │
                  │    - Action: AVOID -> Abort & Blacklist      │
                  │    - Action: BUY   -> Proceed to Snipe       │
                  └──────────────────────┬───────────────────────┘
                                         │ Approved by AI
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ 4. Execution Engine (InstantSniper)          │
                  │    - CircuitBreaker & Max Positions Check    │
                  │    - Execute Buy (Size: SNIPER_TRADE_SIZE)   │
                  │    - Register into PositionTracker           │
                  │    - Telegram Alert: "🎯 AUTO-SNIPED"        │
                  └──────────────────────┬───────────────────────┘
                                         │ Position Open
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ 5. Stage 2: AI Post-Snipe Active Sentinel    │
                  │    - PositionTicker monitors 1m/5m order flow│
                  │    - Rapid Volume Delta & CVD Tracking       │
                  │    - Emergency Exit on Developer Dump / Rug  │
                  │    - Dynamic TP / Trailing Stop lock-in      │
                  └──────────────────────────────────────────────┘
```

---

## 3. Configuration & Environment Variables

New environment variables added to `.env.example`, `src/config/env.ts`, and `src/config/constants.ts`:

| Variable | Type | Default | Description |
|---|---|---|---|
| `AUTO_SNIPER_ENABLED` | boolean | `false` | Master toggle to enable automated sniping of newly listed tokens |
| `SNIPER_TRADE_SIZE_ETH` | number | `0.01` | Position size in ETH allocated per auto-snipe trade |
| `SNIPER_MIN_LIQUIDITY_USD` | number | `2000` | Minimum initial pool liquidity in USD required |
| `SNIPER_MAX_AGE_MINUTES` | number | `30` | Maximum token/pool age in minutes to qualify as a "new token" |
| `SNIPER_SLIPPAGE_PCT` | number | `15.0` | Maximum allowable slippage for new pool entry |
| `SNIPER_MIN_SECURITY_SCORE` | number | `80` | Minimum Token Security Score (out of 100) |
| `SNIPER_AI_PRE_VETO` | boolean | `true` | If true, requires AI Auditor approval before executing snipe |
| `SNIPER_AI_ACTIVE_MONITOR` | boolean | `true` | If true, enables AI order flow sentinel for emergency exits |

---

## 4. Component Design & Changes

### 4.1. NewPoolsScanner (`src/core/scanner/newPools.ts`)
- **Responsibilities**:
  - Connect to GeckoTerminal API endpoint `/networks/{network}/new_pools` and DexScreener token profiles.
  - Parse candidate pairs: token address, symbol, name, pair creation timestamp, price USD, and liquidity USD.
  - Filter by age: `(now - poolCreatedAt) <= maxAgeMinutes * 60 * 1000`.
  - Filter by liquidity: `liquidityUsd >= minLiquidityUsd`.
  - Maintain an internal LRU/Set cache of evaluated addresses to prevent duplicate evaluations.

### 4.2. Pre-Snipe AI Veto Gate (`src/core/orchestrator.ts`)
- Evaluates candidate through `TokenSecurityScorer`:
  - Mintable check, freeze authority, honeypot tax simulation, LP verification.
- If score $\ge$ `SNIPER_MIN_SECURITY_SCORE` and `SNIPER_AI_PRE_VETO` is true:
  - Invokes `aiAuditor.evaluateToken(candidate)`.
  - If Auditor returns `AVOID`, aborts trade, logs warning activity, and adds token to temporary blacklist cooldown.
  - If Auditor returns `BUY` (or confidence $\ge 70\%$), proceeds to execution with AI-recommended or default TP/SL.

### 4.3. Auto-Sniper Execution (`InstantSniper` & `ExecutionEngine`)
- Checks `CircuitBreaker.canOpenPosition()` and concurrent position limits.
- Executes buy using `InstantSniper.executeSnipe({ chainId, tokenAddress, amountEth, slippagePct, takeProfitPct, stopLossPct })`.
- Records opened position in `PositionTracker`.
- Emits `onTradeSignal` and `onAiActivity` events.

### 4.4. Post-Snipe AI Active Monitoring (`PositionTicker` & Sentinel)
- When a position tagged `isSniperPosition: true` is tracked:
  - `PositionTicker` runs price & volume delta checks on higher frequency (e.g. every 5 seconds).
  - If negative volume delta exceeds 80% of total pool volume in 1m (whale dump / LP pull signature):
    - Triggers emergency exit immediately (`exitReason: 'EMERGENCY_DUMP_EXIT'`).
  - Otherwise, trailing stop tracks upward breakout to maximize scalp profit.

### 4.5. Telegram Formatting (`src/bot/messages/formatters.ts`)
- Introduces `formatNewTokenSnipeCard()`:
  - Displays token name, symbol, contract address, network.
  - Initial pool liquidity, token age (e.g. "Launched 4m ago").
  - Security score (`92/100 ✅`).
  - AI Auditor verdict & reasoning.
  - Entry price, allocation in ETH & IDR, and active TP/SL.

---

## 5. Risk Safeguards & Deduplication

1. **Anti-Duplicate Sniper Cache**:
   - `Set<string>` of processed token addresses persisted or stored in memory with timestamp.
   - Once a token is analyzed (whether bought, vetoed, or rejected), it is never re-sniped.
2. **Circuit Breaker Integration**:
   - Auto-sniper strictly respects `MAX_DAILY_LOSS_ETH` and `MAX_CONCURRENT_POSITIONS`. If the circuit breaker trips, all auto-sniping is halted instantly.
3. **Slippage & Priority Gas**:
   - Uses `SNIPER_SLIPPAGE_PCT` (default 15%) to avoid getting stuck in volatile launch blocks while preventing excessive front-running losses.
4. **Paper Trading Compatibility**:
   - Fully compatible with `DEFAULT_TRADING_MODE="paper"`, `"shadow"`, or `"live"`. In paper mode, all snipes and exits are simulated with realistic slippage.

---

## 6. Testing & Verification Plan

1. **Unit Tests**:
   - `test/newPoolsScanner.test.ts`:
     - Test fetching and parsing from GeckoTerminal & DexScreener new pool responses.
     - Test age filtering ($\le 30$ mins) and liquidity filtering ($\ge \$2000$).
     - Test deduplication cache.
   - `test/sniperAiIntegration.test.ts`:
     - Test pre-snipe veto: when Auditor returns `AVOID`, snipe is cancelled.
     - Test pre-snipe approval: when Auditor returns `BUY`, snipe executes with configured size.
     - Test emergency dump detection on rapid negative volume delta.
2. **End-to-End Orchestrator Loop**:
   - Verify loop starts `NewPoolsScanner` interval when `AUTO_SNIPER_ENABLED=true`.
   - Verify paper position opens and emits Telegram card.
   - Full regression test run with `npm test` ensuring 100% existing test suites pass.
