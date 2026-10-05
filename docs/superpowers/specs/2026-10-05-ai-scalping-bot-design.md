# Design Spec: Multi-Chain AI Scalping Telegram Bot (Base & Robinhood Chain)

**Date**: 2026-10-05  
**Status**: Draft for User Review  
**Target Environment**: Node.js / TypeScript (v20+), GrammY, Viem, OpenRouter (OpenAI-compatible)

---

## 1. Overview & Objectives

The goal is to build an automated, high-performance crypto scalping bot accessible through Telegram, operating on two distinct EVM chains:
1. **Base (Chain ID 8453)**: Optimized for trending DEX tokens, volume spikes, and high-frequency scalping via Aerodrome & Uniswap V3.
2. **Robinhood Chain (Chain ID 4663)**: An Arbitrum Orbit L2 with native ETH gas token, optimized for tokenized real-world assets (RWAs) and DEX pools via Uniswap V4 (PoolManager/Universal Router) & Uniswap V3.

The bot utilizes **two separate AI Brains** (via OpenRouter / OpenAI-compatible API keys) for independent chain intelligence, equipped with a comprehensive **Crypto Scalping & Market Microstructure Knowledge Base**. It features an automated market scanner, pre-screening honeypot filter, high-speed sniper engine, strict risk management circuit breakers, and an interactive Telegram UI supporting both Paper Trading and Live On-chain Execution.

---

## 2. Architecture & Directory Structure

```
scalping-bot/
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-10-05-ai-scalping-bot-design.md
├── src/
│   ├── config/
│   │   ├── chains.ts             # Base (8453) & Robinhood (4663) RPC, Routers, ABIs
│   │   ├── env.ts                # Environment variables parsing & validation (Zod)
│   │   └── constants.ts          # Default slippage, gas multipliers, scalping thresholds
│   ├── core/
│   │   ├── ai/
│   │   │   ├── client.ts         # Dual OpenRouter API clients (Key 1 for Base, Key 2 for RH)
│   │   │   ├── schemas.ts        # Zod structured response schemas (BUY/WAIT/AVOID, TP/SL, etc.)
│   │   │   ├── prompt.ts         # System prompts with Chain-of-Thought instructions
│   │   │   └── knowledge/        # Embedded Domain Knowledge for Crypto Scalping
│   │   │       ├── orderflow.ts  # Volume delta, CVD, bid/ask imbalance rules
│   │   │       ├── liquidity.ts  # Pool depth, fee tiers, V4 hooks, slippage dynamics
│   │   │       ├── patterns.ts   # Scalping chart patterns, momentum, exhaustion flags
│   │   │       └── chains.ts     # Base memecoin heuristics vs Robinhood RWA heuristics
│   │   ├── scanner/
│   │   │   ├── dexscreener.ts    # DexScreener API integration (trending, volume spikes)
│   │   │   ├── geckoterminal.ts  # GeckoTerminal API fallback
│   │   │   └── metrics.ts        # Quantitative math pre-calculator (Delta, Buy Ratio, Momentum)
│   │   ├── screener/
│   │   │   ├── honeypot.ts       # Buy/sell simulation, tax detection, transferability
│   │   │   └── liquidityCheck.ts # Min liquidity, LP lock check, creator balance check
│   │   ├── sniper/
│   │   │   ├── pairListener.ts   # Listen to PoolCreated / PairCreated events on Base & RH
│   │   │   └── instantSnipe.ts   # Fast-path transaction builder with priority gas
│   │   ├── execution/
│   │   │   ├── types.ts          # Order & Execution interfaces
│   │   │   ├── paperTrader.ts    # Virtual wallet, balance simulation & fill simulator
│   │   │   ├── viemClient.ts     # Viem Wallet & Public clients for Base & RH
│   │   │   └── routers/
│   │   │       ├── baseRouter.ts # Aerodrome / Uniswap V3 swap router execution
│   │   │       └── rhRouter.ts   # Uniswap V4 PoolManager / V3 swap router execution
│   │   ├── risk/
│   │   │   └── circuitBreaker.ts # Max loss per trade & daily drawdown circuit breaker
│   │   └── positions/
│   │       ├── tracker.ts        # Active open positions state manager
│   │       └── ticker.ts         # Real-time price loop for auto Take-Profit & Stop-Loss
│   ├── storage/
│   │   └── db.ts                 # SQLite / JSON store for trades, positions, and user settings
│   ├── bot/
│   │   ├── index.ts              # GrammY bot initialization & middlewares
│   │   ├── handlers/
│   │   │   ├── commands.ts       # /start, /menu, /help, /status, /panic
│   │   │   ├── callbacks.ts      # Inline button actions (Toggle mode, Start/Stop, etc.)
│   │   │   └── snipeInput.ts     # Handle pasted Contract Address (CA) for instant snipe
│   │   ├── keyboards/
│   │   │   └── menus.ts          # Main dashboard, settings, and position action buttons
│   │   └── messages/
│   │       └── formatters.ts     # Beautiful Telegram message formatters with emojis & markdown
│   └── index.ts                  # Application bootstrap & lifecycle coordinator
├── test/
│   ├── ai.test.ts                # Test AI response parsing & schema validation
│   ├── metrics.test.ts           # Test order flow & volume delta calculations
│   ├── screener.test.ts          # Test honeypot & safety filters
│   └── circuitBreaker.test.ts    # Test max loss & daily drawdown triggers
├── package.json
├── tsconfig.json
└── .env.example
```

---

## 3. Detailed Component Specifications

### 3.1 AI Brain & Knowledge Base (`src/core/ai/`)

#### Dual AI Client Configuration
- **Base AI Client**: Uses `OPENROUTER_API_KEY_BASE` (and customizable `AI_MODEL_BASE`, e.g., `anthropic/claude-3.5-sonnet` or `deepseek/deepseek-chat`).
- **Robinhood AI Client**: Uses `OPENROUTER_API_KEY_ROBINHOOD` (and customizable `AI_MODEL_ROBINHOOD`).
- **OpenAI-Compatible Base URL**: Defaults to `https://openrouter.ai/api/v1` but configurable via `.env` (allows custom endpoints or local models).

#### Embedded Crypto Scalping Knowledge Base
The AI is armed with domain-specific knowledge injected into the prompt:
1. **Microstructure & Order Flow**:
   - Volume Delta = Buy Volume - Sell Volume (5m and 15m windows).
   - Buy Pressure Ratio = `BuyVolume / (BuyVolume + SellVolume)`. A ratio > 65% indicates strong initiative buying; < 40% indicates distribution.
   - Cumulative Volume Delta (CVD) divergence: Higher price with declining CVD signals buyer exhaustion (danger of reversal).
2. **Liquidity Depth & Slippage Risk**:
   - Pool Liquidity vs Fully Diluted Valuation (FDV): Pool liquidity must be >= 5% of FDV for memecoins, or >= $15k minimum to absorb 0.05-0.1 ETH orders with < 1.5% slippage.
   - Fee Tier awareness: Aerodrome dynamic slips on Base; Uniswap V4 pool fee tiers and hook configurations on Robinhood Chain.
3. **Chain Specifics**:
   - **Base**: High-velocity momentum, meme narrative cycles, breakout retests on 1m/5m timeframe.
   - **Robinhood Chain**: RWA token mechanics, price-pegging to traditional asset trading hours, liquidity spread compression.
4. **Pre-Computed Metrics**:
   - Code calculates all quantitative formulas *before* calling the LLM. The AI receives raw facts + calculated ratios, ensuring the LLM is used for synthesis, pattern recognition, and decision logic without hallucinating math.

#### Structured Output Schema (Zod)
```typescript
export const AiScalpDecisionSchema = z.object({
  action: z.enum(["BUY", "WAIT", "AVOID"]),
  confidence: z.number().min(0).max(100),
  takeProfitPct: z.number().min(1).max(500),      // Recommended dynamic TP % (e.g. 15%)
  stopLossPct: z.number().min(0.5).max(20),       // Recommended tight SL % (e.g. 5%)
  suggestedAllocEth: z.number().min(0.001).max(1),// Suggested position size in ETH
  timeframeMinutes: z.number().min(1).max(60),    // Estimated scalp holding horizon
  riskRewardRatio: z.number().min(1),             // Must be >= 2.0
  reasoning: z.string().max(500),                 // Brief explanation for Telegram notification
  signalsDetected: z.array(z.string())            // e.g. ["Volume Spike 3x", "Buy Ratio 78%"]
});
```

---

### 3.2 Market Scanner & Safety Screener (`src/core/scanner/` & `screener/`)

1. **Scanner**:
   - Polls DexScreener API (`/token-profiles/latest/v1`, `/tokens/`, `/pairs/`) and GeckoTerminal for Base (`base`) and Robinhood Chain.
   - Filters out tokens with liquidity < `$5,000` and 24h volume < `$10,000`.
   - Computes 5m price change %, volume delta, buy/sell transaction count ratio.
2. **Safety Screener (Pre-AI Filter)**:
   - Simulates buy & sell transfers on-chain (or checks known honeypot APIs) to verify:
     - Is buy tax <= 5%?
     - Is sell tax <= 7%?
     - Is trading enabled and not blacklisted?
     - Is liquidity locked or burned?
   - If token fails safety screening, it is rejected immediately, saving AI tokens and protecting capital.

---

### 3.3 Sniper Engine (`src/core/sniper/`)

1. **Auto-Sniper**:
   - Monitors on-chain pool creation events (`PoolCreated` on Uniswap V3 Factory, `Initialize` on Uniswap V4 PoolManager, and Aerodrome Factory).
   - Fast-path check: Verifies initial LP liquidity >= threshold (e.g. 0.5 ETH).
   - Instant transaction submission with custom `priorityGasFee` to ensure block inclusion.
2. **Manual Instant Snipe via Telegram**:
   - User posts a Contract Address (CA) in Telegram chat.
   - Bot detects CA, parses chain, fetches pool details, and renders inline buttons:
     - `[🔫 Snipe 0.01 ETH]` `[🔫 Snipe 0.05 ETH]` `[🔫 Snipe Custom]` `[🔍 AI Deep Audit]`
   - Clicking a snipe button executes the swap within seconds.

---

### 3.4 Execution Engine: Paper Trading vs Live Viem (`src/core/execution/`)

1. **Paper Trading Mode**:
   - Virtual wallet with configurable starting balance (e.g. 1.0 ETH per chain).
   - Simulates swaps based on live DexScreener/DEX quote prices with realistic simulated slippage (0.5%).
   - Stores virtual trades in SQLite database, allowing full strategy validation without capital risk.
2. **Live Trading Mode**:
   - Uses `viem` with private key from `.env` (`WALLET_PRIVATE_KEY`).
   - Base Router: Aerodrome Swap Router / Uniswap V3 SwapRouter02.
   - Robinhood Router: Uniswap V4 (UniversalRouter / PoolManager) with fallback to V3 Router.
   - Automatic ERC20 approval handling (checks allowance, approves only when needed).
   - Nonce queue prevents nonce desynchronization during rapid consecutive trades.

---

### 3.5 Risk Management & Circuit Breakers (`src/core/risk/`)

1. **Hard Stop-Loss per Trade**:
   - User configurable `MAX_LOSS_PER_TRADE_PCT` (default: 8%). If AI proposes a 10% SL, the bot clamps it to 8%.
2. **Daily Drawdown Circuit Breaker**:
   - Tracks total realized PnL in rolling 24-hour window.
   - If cumulative 24h loss exceeds `MAX_DAILY_LOSS_ETH` (default: 0.1 ETH or 10% of portfolio):
     - **Trip Circuit Breaker**: Auto-stops scanner and sniper engines.
     - Sends urgent Telegram alert: *"🚨 CIRCUIT BREAKER TRIGGERED: Daily loss limit (-0.10 ETH) hit. All automated buying paused."*
     - Provides manual override button `[🔓 Resume Bot]` if user explicitly chooses to reactivate.
3. **Max Concurrent Open Positions**:
   - Limits active positions to e.g. 3 per chain to avoid over-exposure.

---

### 3.6 Real-Time Position Ticker & TP/SL (`src/core/positions/`)

- Background loop runs every 5 seconds for open positions:
  - Fetches current token price via DEX pool reserves or DexScreener ticker.
  - Computes unrealized PnL (%).
  - If `currentGain >= takeProfitPct` -> Executes **TAKE PROFIT SELL**.
  - If `currentLoss <= -stopLossPct` -> Executes **STOP LOSS SELL**.
  - Optional Trailing Stop: If profit reaches +10%, stop loss ratchets up to breakeven (+1%).
  - Sends immediate Telegram alert upon exit with execution tx hash and net PnL.

---

### 3.7 Telegram User Interface (GrammY) (`src/bot/`)

- **Main Dashboard**:
  - Live system status, current trading mode (Paper/Live), active positions count, and 24h PnL.
  - Interactive Inline Keyboard:
    - Row 1: `[🟢 Start Engine]` / `[🔴 Stop Engine]`
    - Row 2: `[📝 Paper Mode]` / `[⚡ Live Mode]` (Toggle)
    - Row 3: `[📊 Positions (3)]` `[📜 Trade History]`
    - Row 4: `[⚙️ Settings]` `[🚨 PANIC SELL ALL]`
- **Real-Time Trade Cards**:
  - Sent automatically on every entry and exit.
  - Displays token name, CA, entry price, target TP/SL, AI confidence score, and AI reasoning.
  - Includes a direct `[Sell Now]` button for manual discretionary exits.

---

## 4. Configuration & Environment Variables (`.env.example`)

```bash
# Telegram Configuration
TELEGRAM_BOT_TOKEN="your_telegram_bot_token"
TELEGRAM_ALLOWED_USER_IDS="123456789" # Comma-separated allowed Telegram user IDs

# AI Configuration (OpenRouter / OpenAI-Compatible)
OPENROUTER_BASE_URL="https://openrouter.ai/api/v1"
OPENROUTER_API_KEY_BASE="sk-or-v1-base-key-..."
OPENROUTER_API_KEY_ROBINHOOD="sk-or-v1-rh-key-..."
AI_MODEL_BASE="deepseek/deepseek-chat"
AI_MODEL_ROBINHOOD="anthropic/claude-3.5-sonnet"

# EVM Wallets & RPCs
WALLET_PRIVATE_KEY="0x..." # EVM private key for live trading (leave dummy for paper)
BASE_RPC_URL="https://mainnet.base.org"
BASE_RPC_FALLBACK="https://base.llamarpc.com"
ROBINHOOD_RPC_URL="https://rpc.robinhoodchain.com" # Or Dwellir / official RPC
ROBINHOOD_RPC_FALLBACK=""

# Risk Management
MAX_LOSS_PER_TRADE_PCT=7.0
MAX_DAILY_LOSS_ETH=0.1
DEFAULT_TRADE_SIZE_ETH=0.02
MAX_CONCURRENT_POSITIONS=3
DEFAULT_TRADING_MODE="paper" # "paper" or "live"
```

---

## 5. Testing & Verification Plan

1. **Unit Testing (`vitest`)**:
   - `test/metrics.test.ts`: Test volume delta, buy pressure ratio, CVD calculations.
   - `test/ai.test.ts`: Mock OpenRouter responses to verify Zod schema validation & fallback handling.
   - `test/circuitBreaker.test.ts`: Test daily drawdown trigger and trade loss clamping.
2. **Integration & Paper Run**:
   - Run scanner against live Base & Robinhood token pairs in Paper Trading mode.
   - Verify that simulated orders trigger, positions appear in Telegram, and TP/SL ticker executes virtual sells accurately.
   - Verify Telegram button callbacks and CA instant snipe prompt.
