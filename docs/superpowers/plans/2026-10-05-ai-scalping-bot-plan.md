# AI Scalping Telegram Bot (Base & Robinhood Chain) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-grade, multi-chain AI scalping bot accessible via Telegram for Base (8453) and Robinhood Chain (4663), equipped with dual OpenRouter AI brains, crypto market microstructure knowledge, automated DEX scanning, fast sniping, hard risk circuit breakers, and hybrid paper/live execution.

**Architecture:** A modular TypeScript/Node.js system with independent chain adapters, pre-computed quantitative metrics (CVD, buy pressure, liquidity depth), dual OpenRouter LLM decision engines, a safety screener (honeypot/tax/liquidity filter), an event-driven position ticker for auto TP/SL, and an interactive GrammY Telegram UI.

**Tech Stack:** Node.js (v20+), TypeScript, GrammY (Telegram Bot), Viem (EVM wallet & contract calls), Zod (schema validation), Axios / Fetch (DexScreener/GeckoTerminal APIs), Better-SQLite3 (local state persistence), Vitest (TDD unit testing).

**Spec:** `docs/superpowers/specs/2026-10-05-ai-scalping-bot-design.md`

## Global Constraints

- Platform: Node.js 20+ with TypeScript (ESM modules).
- Base Chain ID: 8453, Native Gas Token: ETH.
- Robinhood Chain ID: 4663 (Arbitrum Orbit Stack), Native Gas Token: ETH.
- Robinhood DEX: Uniswap V4 (UniversalRouter/PoolManager) + V3 fallback; Base DEX: Aerodrome + Uniswap V3.
- AI Provider: OpenAI-compatible / OpenRouter API endpoints with dual API keys (Key 1 for Base, Key 2 for Robinhood).
- AI Quantitative Safety Rule: All ratios (Volume Delta, Buy Pressure %, CVD, Pool-to-FDV) must be pre-calculated by TypeScript before LLM prompt injection; LLM must not compute raw numbers.
- Circuit Breakers: Daily drawdown limit (`MAX_DAILY_LOSS_ETH`) and maximum loss per trade (`MAX_LOSS_PER_TRADE_PCT`) must be enforced at code level regardless of AI recommendation.
- Hybrid Modes: System must start in `paper` mode by default, switchable to `live` only with explicit user confirmation.

## Review Focus

1. **AI Output Hallucination / Formatting Drift**: OpenRouter returns malformed JSON or unparseable fields -> Zod validator must gracefully reject trade and log warning rather than crash.
2. **Honeypot / Malicious Contract Traps**: Token allows buy but charges 99% sell tax or blocks transfer -> Pre-screener simulation must catch this and abort before LLM call or swap.
3. **Daily Drawdown Limit Breach**: Rapid series of losing trades -> Circuit breaker trips immediately, preventing any new buy orders until manual reset.
4. **Viem Nonce Desynchronization**: Multiple fast snipes/trades -> Nonce manager queues transactions sequentially to avoid `nonce too low` or `replacement underpriced` errors.
5. **RPC Lag or Endpoint Outage**: Primary RPC for Base or Robinhood Chain fails -> Client automatically falls back to secondary public RPC without terminating background position ticker.

---

### Task 1: Project Scaffolding & Build Configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`

**Interfaces:**
- Produces: Base project structure with all required scripts (`npm run build`, `npm run dev`, `npm test`).

- [ ] **Step 1: Write `package.json`**
Define dependencies: `grammy`, `viem`, `zod`, `axios`, `better-sqlite3`, `dotenv`, and devDependencies: `typescript`, `vitest`, `@types/node`, `@types/better-sqlite3`, `tsx`.

- [ ] **Step 2: Write `tsconfig.json` and `vitest.config.ts`**
Configure TypeScript for NodeNext/ESNext, strict mode enabled, and Vitest configured for TypeScript tests.

- [ ] **Step 3: Write `.env.example`**
Include all required environment variable keys with helpful placeholder comments.

- [ ] **Step 4: Install dependencies and verify environment**
Run: `npm install` and verify zero errors.

- [ ] **Step 5: Commit**
`git add package.json tsconfig.json vitest.config.ts .env.example package-lock.json`  
`git commit -m "chore: setup project dependencies and build configuration"`

---

### Task 2: Environment & Chain Configuration

**Files:**
- Create: `src/config/env.ts`
- Create: `src/config/chains.ts`
- Create: `src/config/constants.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces: `env` object validated via Zod, `CHAIN_CONFIG` dictionary (Base 8453, Robinhood 4663 with RPCs, routers, explorers, native token info).

- [ ] **Step 1: Write failing test for config validation**
Test valid and invalid `.env` scenarios using Zod schema.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/config.test.ts` (Fails: file not found).

- [ ] **Step 3: Implement `src/config/env.ts`, `chains.ts`, and `constants.ts`**
Define schemas and chain configurations:
- Base: Chain ID 8453, Aerodrome Router `0xcF77a3Ba9A5CA399B7c97c7488454543B7374BE`, Uniswap V3 SwapRouter02 `0x2626664c2603336E57B271c5C0b26F421741e481`.
- Robinhood Chain: Chain ID 4663, Uniswap V4 PoolManager / Universal Router interface, Uniswap V3 Router fallback.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/config.test.ts` -> PASS.

- [ ] **Step 5: Commit**
`git add src/config/ test/config.test.ts`  
`git commit -m "feat: implement environment validation and chain configurations"`

---

### Task 3: Crypto Scalping Knowledge & Market Microstructure Pre-Calculators

**Files:**
- Create: `src/core/scanner/metrics.ts`
- Create: `src/core/ai/knowledge/orderflow.ts`
- Create: `src/core/ai/knowledge/liquidity.ts`
- Create: `src/core/ai/knowledge/chains.ts`
- Test: `test/metrics.test.ts`

**Interfaces:**
- Produces: `calculateMicrostructureMetrics(pairData)` -> returns `{ volumeDelta5m, buyPressureRatio, liquidityToFdvRatio, momentum5mPct, cvdTrend }`.
- Produces: Domain knowledge guides formatted for LLM system prompt injection.

- [ ] **Step 1: Write failing test for quantitative metric calculation**
Test Volume Delta, Buy Pressure Ratio, Liquidity/FDV ratio calculations with sample DexScreener pair JSON.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/metrics.test.ts` -> FAIL.

- [ ] **Step 3: Implement `metrics.ts` and domain knowledge modules**
Implement clean mathematical formulas:
- `buyPressureRatio = buys / (buys + sells)`
- `volumeDelta5m = buyVolume5m - sellVolume5m`
- `liquidityToFdvRatio = poolLiquidityUsd / fdv`
- Construct knowledge strings covering order flow imbalance, exhaustion detection, Base meme dynamics, and Robinhood RWA mechanics.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/metrics.test.ts` -> PASS.

- [ ] **Step 5: Commit**
`git add src/core/scanner/metrics.ts src/core/ai/knowledge/ test/metrics.test.ts`  
`git commit -m "feat: implement crypto scalping microstructure metrics and knowledge base"`

---

### Task 4: Dual AI Decision Engine (OpenRouter / OpenAI-Compatible)

**Files:**
- Create: `src/core/ai/schemas.ts`
- Create: `src/core/ai/prompt.ts`
- Create: `src/core/ai/client.ts`
- Test: `test/ai.test.ts`

**Interfaces:**
- Consumes: Pre-computed metrics from `src/core/scanner/metrics.ts`, domain knowledge from `src/core/ai/knowledge/`.
- Produces: `evaluateScalpOpportunity(chain, tokenInfo, metrics)` -> returns validated `AiScalpDecision` (action: BUY/WAIT/AVOID, confidence, takeProfitPct, stopLossPct, suggestedAllocEth, reasoning).

- [ ] **Step 1: Write failing test for AI schema validation and mock evaluation**
Test parsing valid LLM JSON output, handling malformed response, and clamping confidence & risk/reward.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/ai.test.ts` -> FAIL.

- [ ] **Step 3: Implement `schemas.ts`, `prompt.ts`, and `client.ts`**
- Use Zod for `AiScalpDecisionSchema`.
- Build system prompt that injects the crypto knowledge base, micro-structure rules, and requires strict JSON output.
- Create dual OpenRouter client instances (Key 1 for Base, Key 2 for Robinhood).

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/ai.test.ts` -> PASS.

- [ ] **Step 5: Commit**
`git add src/core/ai/ test/ai.test.ts`  
`git commit -m "feat: implement dual AI scalping decision engine with Zod schema validation"`

---

### Task 5: Market Scanner & Safety Pre-Screener

**Files:**
- Create: `src/core/scanner/dexscreener.ts`
- Create: `src/core/screener/honeypot.ts`
- Create: `src/core/screener/safety.ts`
- Test: `test/screener.test.ts`

**Interfaces:**
- Produces: `scanTrendingTokens(chain)` -> fetches top trending and volume surge tokens.
- Produces: `screenTokenSafety(chain, tokenAddress, poolAddress)` -> returns `{ isSafe, reasons, buyTax, sellTax, liquidityLocked }`.

- [ ] **Step 1: Write failing test for safety screener**
Test honeypot detection rules (rejection on high tax > 10%, transfer restrictions, low liquidity < $5,000).

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/screener.test.ts` -> FAIL.

- [ ] **Step 3: Implement DexScreener client & Safety Screener**
- Integrate DexScreener public REST API for Base and Robinhood pairs.
- Implement simulation/verification rules for taxes and pool liquidity depth.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/screener.test.ts` -> PASS.

- [ ] **Step 5: Commit**
`git add src/core/scanner/dexscreener.ts src/core/screener/ test/screener.test.ts`  
`git commit -m "feat: implement dex scanner and anti-honeypot safety pre-screener"`

---

### Task 6: Risk Management & Circuit Breakers

**Files:**
- Create: `src/core/risk/circuitBreaker.ts`
- Test: `test/circuitBreaker.test.ts`

**Interfaces:**
- Produces: `checkTradeRisk(proposedTrade)` -> validates and clamps stop-loss.
- Produces: `recordTradeResult(pnlEth)`, `isCircuitBreakerTripped()`, `resetCircuitBreaker()`.

- [ ] **Step 1: Write failing test for circuit breaker**
Test scenario where consecutive losses exceed `MAX_DAILY_LOSS_ETH` -> triggers circuit breaker and blocks further trades.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/circuitBreaker.test.ts` -> FAIL.

- [ ] **Step 3: Implement `circuitBreaker.ts`**
- Enforce hard stop loss clamp (`MAX_LOSS_PER_TRADE_PCT`).
- Rolling 24-hour loss tracker that halts buying when threshold is exceeded.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/circuitBreaker.test.ts` -> PASS.

- [ ] **Step 5: Commit**
`git add src/core/risk/ test/circuitBreaker.test.ts`  
`git commit -m "feat: implement hard stop-loss and daily drawdown circuit breaker"`

---

### Task 7: Position Manager & Real-Time TP/SL Ticker

**Files:**
- Create: `src/core/positions/tracker.ts`
- Create: `src/core/positions/ticker.ts`
- Create: `src/storage/db.ts`
- Test: `test/positions.test.ts`

**Interfaces:**
- Consumes: Trade outcomes, SQLite database for persistence.
- Produces: `openPosition(...)`, `closePosition(...)`, `getActivePositions()`, `startPositionTicker(onExitTriggered)`.

- [ ] **Step 1: Write failing test for position tracking and TP/SL evaluation**
Test position price tick triggering Take Profit sell when price >= target, and Stop Loss sell when price <= target.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/positions.test.ts` -> FAIL.

- [ ] **Step 3: Implement SQLite storage and position ticker**
- SQLite schema for `positions` and `trades`.
- Position ticker checking prices every 5-10s with trailing stop support.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/positions.test.ts` -> PASS.

- [ ] **Step 5: Commit**
`git add src/core/positions/ src/storage/ test/positions.test.ts`  
`git commit -m "feat: implement SQLite position tracking and real-time TP/SL ticker"`

---

### Task 8: Execution Engine: Paper Trading & Viem Live Swaps

**Files:**
- Create: `src/core/execution/types.ts`
- Create: `src/core/execution/paperTrader.ts`
- Create: `src/core/execution/viemClient.ts`
- Create: `src/core/execution/routers/baseRouter.ts`
- Create: `src/core/execution/routers/rhRouter.ts`
- Create: `src/core/execution/engine.ts`
- Test: `test/execution.test.ts`

**Interfaces:**
- Produces: `executeBuy(order)` and `executeSell(position)` in both Paper and Live modes.
- Supports Aerodrome & Uniswap V3 on Base; Uniswap V4 PoolManager / V3 on Robinhood Chain.

- [ ] **Step 1: Write failing test for paper trading simulation**
Test buying and selling tokens in simulation mode, updating virtual ETH balance and tokens held with simulated slippage.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/execution.test.ts` -> FAIL.

- [ ] **Step 3: Implement Paper Trader and Viem Live Router executors**
- PaperTrader calculates realistic fill prices with gas deduction.
- ViemClient sets up account and contract calls for Base Aerodrome / Uniswap V3 and Robinhood Uniswap V4 / V3.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/execution.test.ts` -> PASS.

- [ ] **Step 5: Commit**
`git add src/core/execution/ test/execution.test.ts`  
`git commit -m "feat: implement hybrid execution engine with paper trading and viem DEX routers"`

---

### Task 9: Sniper Engine (Auto-Snipe & Instant Manual CA Snipe)

**Files:**
- Create: `src/core/sniper/pairListener.ts`
- Create: `src/core/sniper/instantSnipe.ts`
- Test: `test/sniper.test.ts`

**Interfaces:**
- Produces: `startPairListener(chain, onNewPair)` -> listens to pool creation events on DEX factories.
- Produces: `executeInstantSnipe(chain, tokenAddress, amountEth, slippagePct)` -> fast-path swap with priority gas.

- [ ] **Step 1: Write failing test for instant snipe parameter preparation**
Verify rapid path validation, priority fee estimation, and slippage calculations for snipes.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/sniper.test.ts` -> FAIL.

- [ ] **Step 3: Implement sniper listener & fast executor**
- Event listener for Uniswap V3/V4 and Aerodrome pool creation events.
- Instant snipe pipeline for direct execution upon CA input.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/sniper.test.ts` -> PASS.

- [ ] **Step 5: Commit**
`git add src/core/sniper/ test/sniper.test.ts`  
`git commit -m "feat: implement on-chain pair sniper and fast CA swap pipeline"`

---

### Task 10: GrammY Telegram Bot Interface

**Files:**
- Create: `src/bot/keyboards/menus.ts`
- Create: `src/bot/messages/formatters.ts`
- Create: `src/bot/handlers/commands.ts`
- Create: `src/bot/handlers/callbacks.ts`
- Create: `src/bot/handlers/snipeInput.ts`
- Create: `src/bot/index.ts`
- Test: `test/bot.test.ts`

**Interfaces:**
- Produces: Interactive Telegram bot with `/start`, `/menu`, `/status`, `/panic` commands, inline buttons (Toggle Paper/Live, Start/Stop Scanner, Positions, Settings), CA detection for instant snipe, and broadcast trade cards.

- [ ] **Step 1: Write failing test for message formatting and keyboard builders**
Test dashboard text rendering, trade signal card formatting, and inline button callback parsers.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/bot.test.ts` -> FAIL.

- [ ] **Step 3: Implement Telegram UI, handlers, and formatters**
- GrammY bot setup with authorization middleware (restricts bot to allowed Telegram User IDs).
- Complete interactive inline keyboard menu system.
- Trade signal alert formatters with AI reasoning, confidence %, and quick action buttons.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/bot.test.ts` -> PASS.

- [ ] **Step 5: Commit**
`git add src/bot/ test/bot.test.ts`  
`git commit -m "feat: implement Telegram bot UI with GrammY interactive menus and alerts"`

---

### Task 11: End-to-End Orchestrator, System Bootstrap, & Verification

**Files:**
- Create: `src/core/orchestrator.ts`
- Create: `src/index.ts`
- Test: `test/integration.test.ts`

**Interfaces:**
- Produces: Main application lifecycle coordinator connecting Scanner -> Screener -> AI -> Execution -> Ticker -> Telegram Bot.

- [ ] **Step 1: Write integration test for the end-to-end trading loop**
Simulate a cycle: Token discovered -> Screened safe -> AI evaluates BUY (85% confidence) -> Paper Trader opens position -> Position Ticker tracks price -> TP sell triggered -> Circuit breaker records profit.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/integration.test.ts` -> FAIL.

- [ ] **Step 3: Implement orchestrator and bootstrap in `src/index.ts`**
- Initialize all components cleanly, handle graceful shutdown (`SIGINT`, `SIGTERM`).
- Start scanner loops, position ticker, and Telegram bot.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/integration.test.ts` -> PASS.

- [ ] **Step 5: Run full test suite to verify 100% passing**
Run: `npm test`

- [ ] **Step 6: Commit**
`git add src/ index.ts test/`  
`git commit -m "feat: implement full application orchestrator and integration verification"`
