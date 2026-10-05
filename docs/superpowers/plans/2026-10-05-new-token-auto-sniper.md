# New Token Auto-Sniper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automated New Token Auto-Sniper that continuously discovers newly deployed DEX pools on Base and Robinhood chains, protects capital with fast security scoring and Stage 1 AI Auditor pre-veto, executes auto-buys per `.env` configuration, and actively monitors open positions with Stage 2 AI volume delta dump protection.

**Architecture:** A dedicated `NewPoolsScanner` regularly polls GeckoTerminal and DexScreener new pool endpoints with deduplication and age/liquidity filtering. Candidates that meet baseline criteria are passed to `TokenSecurityScorer` and the AI Auditor (`AiScalpEngine`) for instant pre-veto evaluation. Approved tokens are executed via `InstantSniper`, tracked in `PositionTracker`, and watched by `PositionTicker` for trailing profits or emergency dump exits.

**Tech Stack:** TypeScript, Node.js (v20+), Viem, Zod, Axios, Vitest, GrammY.

**Spec:** [`docs/superpowers/specs/2026-10-05-new-token-auto-sniper-design.md`](file:///e:/Coding/scalping-bot/docs/superpowers/specs/2026-10-05-new-token-auto-sniper-design.md)

## Global Constraints
- Target Environment: Node.js / TypeScript (v20+), Viem, DexScreener/GeckoTerminal APIs, OpenRouter LLM, GrammY
- Default AUTO_SNIPER_ENABLED: false
- Default SNIPER_TRADE_SIZE_ETH: 0.01
- Default SNIPER_MIN_LIQUIDITY_USD: 2000
- Default SNIPER_MAX_AGE_MINUTES: 30
- Default SNIPER_SLIPPAGE_PCT: 15.0
- Default SNIPER_MIN_SECURITY_SCORE: 80
- Strict adherence to Vitest unit testing for each step

## Review Focus
1. Pool Creation Age: Pools created more than `SNIPER_MAX_AGE_MINUTES` ago must be ignored even if returned by the API.
2. Deduplication: The same token contract address must never be evaluated or sniped twice.
3. Liquidity Floor: Pools with liquidity below `SNIPER_MIN_LIQUIDITY_USD` must be skipped immediately without wasting LLM or RPC calls.
4. AI Pre-Veto: If AI Auditor returns `AVOID`, no transaction must be broadcast and the token must be temporarily blacklisted.
5. Emergency Dump: If post-snipe order flow detects >80% 1m sell pressure or sudden liquidity drain, position must trigger an immediate market exit.

---

### Task 1: Configuration & Environment Setup

**Files:**
- Modify: `src/config/constants.ts`
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces:
  - `Env.AUTO_SNIPER_ENABLED`: boolean
  - `Env.SNIPER_TRADE_SIZE_ETH`: number
  - `Env.SNIPER_MIN_LIQUIDITY_USD`: number
  - `Env.SNIPER_MAX_AGE_MINUTES`: number
  - `Env.SNIPER_SLIPPAGE_PCT`: number
  - `Env.SNIPER_MIN_SECURITY_SCORE`: number
  - `Env.SNIPER_AI_PRE_VETO`: boolean
  - `Env.SNIPER_AI_ACTIVE_MONITOR`: boolean

- [ ] **Step 1: Write failing test in `test/config.test.ts` for new sniper env variables**

```typescript
it('parses new token auto-sniper configuration with sensible defaults', () => {
  const env = parseEnv({
    TELEGRAM_BOT_TOKEN: 'test_token',
  });
  expect(env.AUTO_SNIPER_ENABLED).toBe(false);
  expect(env.SNIPER_TRADE_SIZE_ETH).toBe(0.01);
  expect(env.SNIPER_MIN_LIQUIDITY_USD).toBe(2000);
  expect(env.SNIPER_MAX_AGE_MINUTES).toBe(30);
  expect(env.SNIPER_SLIPPAGE_PCT).toBe(15.0);
  expect(env.SNIPER_MIN_SECURITY_SCORE).toBe(80);
  expect(env.SNIPER_AI_PRE_VETO).toBe(true);
  expect(env.SNIPER_AI_ACTIVE_MONITOR).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config.test.ts`  
Expected: FAIL due to missing properties on `Env`

- [ ] **Step 3: Update `src/config/constants.ts`, `src/config/env.ts`, and `.env.example`**

In `src/config/constants.ts`:
```typescript
  AUTO_SNIPER_ENABLED: false,
  SNIPER_TRADE_SIZE_ETH: 0.01,
  SNIPER_MIN_LIQUIDITY_USD: 2000,
  SNIPER_MAX_AGE_MINUTES: 30,
  SNIPER_SLIPPAGE_PCT: 15.0,
  SNIPER_MIN_SECURITY_SCORE: 80,
  SNIPER_AI_PRE_VETO: true,
  SNIPER_AI_ACTIVE_MONITOR: true,
```

In `src/config/env.ts`:
```typescript
  AUTO_SNIPER_ENABLED: z.string().optional().transform((v) => v === 'true').default('false'),
  SNIPER_TRADE_SIZE_ETH: z.coerce.number().default(DEFAULT_CONFIG.SNIPER_TRADE_SIZE_ETH),
  SNIPER_MIN_LIQUIDITY_USD: z.coerce.number().default(DEFAULT_CONFIG.SNIPER_MIN_LIQUIDITY_USD),
  SNIPER_MAX_AGE_MINUTES: z.coerce.number().default(DEFAULT_CONFIG.SNIPER_MAX_AGE_MINUTES),
  SNIPER_SLIPPAGE_PCT: z.coerce.number().default(DEFAULT_CONFIG.SNIPER_SLIPPAGE_PCT),
  SNIPER_MIN_SECURITY_SCORE: z.coerce.number().default(DEFAULT_CONFIG.SNIPER_MIN_SECURITY_SCORE),
  SNIPER_AI_PRE_VETO: z.string().optional().transform((v) => v !== 'false').default('true'),
  SNIPER_AI_ACTIVE_MONITOR: z.string().optional().transform((v) => v !== 'false').default('true'),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/config/constants.ts src/config/env.ts .env.example test/config.test.ts
git commit -m "feat(config): add environment configuration for new token auto-sniper"
```

---

### Task 2: NewPoolsScanner Subsystem

**Files:**
- Create: `src/core/scanner/newPools.ts`
- Test: `test/newPoolsScanner.test.ts`

**Interfaces:**
- Produces:
  - `interface NewPoolCandidate`:
    ```typescript
    export interface NewPoolCandidate {
      chainId: number;
      poolAddress: string;
      baseTokenAddress: string;
      tokenSymbol: string;
      tokenName: string;
      createdAtMs: number;
      ageMinutes: number;
      priceUsd: number;
      liquidityUsd: number;
      source: 'geckoterminal' | 'dexscreener';
    }
    ```
  - `class NewPoolsScanner`:
    ```typescript
    export class NewPoolsScanner {
      constructor(options?: { maxAgeMinutes?: number; minLiquidityUsd?: number });
      public async scanNewPools(chainId: number): Promise<NewPoolCandidate[]>;
      public markProcessed(address: string): void;
      public isProcessed(address: string): boolean;
      public clearCache(): void;
    }
    ```

- [ ] **Step 1: Write failing test in `test/newPoolsScanner.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NewPoolsScanner } from '../src/core/scanner/newPools.js';
import axios from 'axios';

vi.mock('axios');

describe('NewPoolsScanner', () => {
  let scanner: NewPoolsScanner;

  beforeEach(() => {
    vi.clearAllMocks();
    scanner = new NewPoolsScanner({ maxAgeMinutes: 30, minLiquidityUsd: 2000 });
  });

  it('filters out pools that exceed max age or fall below min liquidity', async () => {
    const now = Date.now();
    const mockGeckoResponse = {
      data: {
        data: [
          {
            id: 'base_0x111',
            attributes: {
              address: '0xpool1',
              pool_created_at: new Date(now - 10 * 60 * 1000).toISOString(), // 10 mins ago (VALID)
              reserve_in_usd: '5000', // (VALID)
              base_token_price_usd: '0.05',
              name: 'ValidToken / WETH',
            },
            relationships: {
              base_token: { data: { id: 'base_0xvalidtoken' } },
            },
          },
          {
            id: 'base_0x222',
            attributes: {
              address: '0xpool2',
              pool_created_at: new Date(now - 50 * 60 * 1000).toISOString(), // 50 mins ago (TOO OLD)
              reserve_in_usd: '8000',
              base_token_price_usd: '1.0',
              name: 'OldToken / WETH',
            },
            relationships: {
              base_token: { data: { id: 'base_0xoldtoken' } },
            },
          },
          {
            id: 'base_0x333',
            attributes: {
              address: '0xpool3',
              pool_created_at: new Date(now - 5 * 60 * 1000).toISOString(), // 5 mins ago
              reserve_in_usd: '500', // (TOO LOW LIQUIDITY)
              base_token_price_usd: '0.01',
              name: 'LowLiq / WETH',
            },
            relationships: {
              base_token: { data: { id: 'base_0xlowliq' } },
            },
          },
        ],
      },
    };

    (axios.get as any).mockResolvedValue(mockGeckoResponse);

    const candidates = await scanner.scanNewPools(8453);
    expect(candidates.length).toBe(1);
    expect(candidates[0].tokenSymbol).toBe('ValidToken');
    expect(candidates[0].liquidityUsd).toBe(5000);
    expect(candidates[0].ageMinutes).toBeLessThanOrEqual(15);
  });

  it('deduplicates pools so already processed tokens are not returned again', async () => {
    const now = Date.now();
    (axios.get as any).mockResolvedValue({
      data: {
        data: [
          {
            id: 'base_0x111',
            attributes: {
              address: '0xpool1',
              pool_created_at: new Date(now - 5 * 60 * 1000).toISOString(),
              reserve_in_usd: '5000',
              base_token_price_usd: '0.05',
              name: 'ValidToken / WETH',
            },
            relationships: {
              base_token: { data: { id: 'base_0xvalidtoken' } },
            },
          },
        ],
      },
    });

    const firstRun = await scanner.scanNewPools(8453);
    expect(firstRun.length).toBe(1);

    scanner.markProcessed(firstRun[0].baseTokenAddress);

    const secondRun = await scanner.scanNewPools(8453);
    expect(secondRun.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/newPoolsScanner.test.ts`  
Expected: FAIL (module `newPools.js` does not exist)

- [ ] **Step 3: Implement `src/core/scanner/newPools.ts`**

Implement `NewPoolsScanner` supporting GeckoTerminal `/networks/{network}/new_pools` and fallback DexScreener search queries, computing age, filtering liquidity, and tracking seen addresses in a bounded LRU/Set.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/newPoolsScanner.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/core/scanner/newPools.ts test/newPoolsScanner.test.ts
git commit -m "feat(scanner): implement NewPoolsScanner with age and liquidity filtering"
```

---

### Task 3: Stage 1 AI Pre-Snipe Veto Gate & Orchestrator Integration

**Files:**
- Modify: `src/core/orchestrator.ts`
- Test: `test/sniperAiIntegration.test.ts`

**Interfaces:**
- Consumes:
  - `NewPoolsScanner.scanNewPools(chainId)`
  - `TokenSecurityScorer.calculateSecurityScore(chainId, tokenAddress)`
  - `AiScalpEngine.evaluateToken(candidate)`
  - `InstantSniper.executeSnipe(req)`
- Produces:
  - `ScalpingOrchestrator.runNewTokenSniperCycle(chainId)`
  - `ScalpingOrchestrator.startNewTokenSniperLoop(intervalMs)`

- [ ] **Step 1: Write failing test in `test/sniperAiIntegration.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScalpingOrchestrator } from '../src/core/orchestrator.js';
import { JsonStorage } from '../src/storage/db.js';

describe('New Token Auto-Sniper with AI Pre-Veto Gate', () => {
  let orchestrator: any;
  let mockStorage: any;

  beforeEach(() => {
    mockStorage = new JsonStorage('test/scratch/test_db.json');
    orchestrator = new ScalpingOrchestrator({
      storage: mockStorage,
      mode: 'paper',
      minSecurityScore: 80,
    });
  });

  it('vetoes auto-snipe when AI Auditor returns AVOID', async () => {
    vi.spyOn(orchestrator['newTokenScanner'], 'scanNewPools').mockResolvedValue([
      {
        chainId: 8453,
        poolAddress: '0xpool_scam',
        baseTokenAddress: '0xscam_token',
        tokenSymbol: 'SCAM',
        tokenName: 'Scam Coin',
        createdAtMs: Date.now() - 60000,
        ageMinutes: 1,
        priceUsd: 0.01,
        liquidityUsd: 10000,
        source: 'geckoterminal',
      },
    ]);

    vi.spyOn(orchestrator['securityScorer'], 'calculateSecurityScore').mockResolvedValue({
      totalScore: 85,
      passed: true,
      flags: [],
      breakdown: {} as any,
    });

    vi.spyOn(orchestrator['aiBase'], 'evaluateToken').mockResolvedValue({
      action: 'AVOID',
      confidence: 90,
      takeProfitPct: 0,
      stopLossPct: 0,
      suggestedAllocEth: 0,
      timeframeMinutes: 0,
      riskRewardRatio: 0,
      reasoning: 'Suspicious distribution pattern, likely rug pull.',
      signalsDetected: ['High Dump Risk'],
    });

    const snipeSpy = vi.spyOn(orchestrator['sniper'], 'executeSnipe');

    const result = await orchestrator.evaluateAndSnipeNewPools(8453);

    expect(result.snipedCount).toBe(0);
    expect(result.vetoedCount).toBe(1);
    expect(snipeSpy).not.toHaveBeenCalled();
  });

  it('executes auto-snipe when security score passes and AI Auditor approves', async () => {
    vi.spyOn(orchestrator['newTokenScanner'], 'scanNewPools').mockResolvedValue([
      {
        chainId: 8453,
        poolAddress: '0xpool_gem',
        baseTokenAddress: '0xgem_token',
        tokenSymbol: 'GEM',
        tokenName: 'Gem Coin',
        createdAtMs: Date.now() - 120000,
        ageMinutes: 2,
        priceUsd: 0.05,
        liquidityUsd: 25000,
        source: 'geckoterminal',
      },
    ]);

    vi.spyOn(orchestrator['securityScorer'], 'calculateSecurityScore').mockResolvedValue({
      totalScore: 92,
      passed: true,
      flags: [],
      breakdown: {} as any,
    });

    vi.spyOn(orchestrator['aiBase'], 'evaluateToken').mockResolvedValue({
      action: 'BUY',
      confidence: 85,
      takeProfitPct: 30,
      stopLossPct: 8,
      suggestedAllocEth: 0.01,
      timeframeMinutes: 15,
      riskRewardRatio: 3.75,
      reasoning: 'Clean tokenomics, locked liquidity, high organic interest.',
      signalsDetected: ['Clean Contract'],
    });

    const snipeSpy = vi.spyOn(orchestrator['sniper'], 'executeSnipe').mockResolvedValue({
      success: true,
      txHash: '0xmock_hash',
      tokenAddress: '0xgem_token',
      tokenSymbol: 'GEM',
      entryPriceUsd: 0.05,
      amountEth: 0.01,
      tokensReceived: 200,
    });

    const result = await orchestrator.evaluateAndSnipeNewPools(8453);

    expect(result.snipedCount).toBe(1);
    expect(snipeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenAddress: '0xgem_token',
        amountEth: 0.01,
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sniperAiIntegration.test.ts`  
Expected: FAIL (`newTokenScanner` or `evaluateAndSnipeNewPools` not found)

- [ ] **Step 3: Implement `evaluateAndSnipeNewPools` in `src/core/orchestrator.ts`**

Instantiate `NewPoolsScanner`, implement `evaluateAndSnipeNewPools(chainId)` connecting security scoring, AI veto gate, circuit breaker check, and instant snipe execution.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/sniperAiIntegration.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/core/orchestrator.ts test/sniperAiIntegration.test.ts
git commit -m "feat(orchestrator): integrate new token auto-sniper with AI pre-veto gate"
```

---

### Task 4: Stage 2 Post-Snipe AI Active Monitoring & Emergency Dump Sentinel

**Files:**
- Modify: `src/core/positions/tracker.ts`
- Modify: `src/core/positions/ticker.ts`
- Modify: `src/core/orchestrator.ts`
- Test: `test/sniperAiIntegration.test.ts`

**Interfaces:**
- Consumes:
  - `Position.isSniperPosition?: boolean`
  - `PositionTicker.checkPositions(currentPrices, microstructureMap)`
- Produces:
  - `ExitReason: 'EMERGENCY_DUMP_EXIT'`

- [ ] **Step 1: Write test for emergency dump detection in `test/sniperAiIntegration.test.ts`**

```typescript
it('triggers EMERGENCY_DUMP_EXIT when negative volume delta spikes on a sniper position', async () => {
  const position = orchestrator['tracker'].openPosition({
    chainId: 8453,
    tokenAddress: '0xgem_token',
    tokenSymbol: 'GEM',
    entryPriceUsd: 0.05,
    amountEth: 0.01,
    tokensHeld: 200,
    takeProfitPct: 30,
    stopLossPct: 15,
    trailingStopPct: 5,
    isSniperPosition: true,
  });

  const exitSpy = vi.fn();
  orchestrator['ticker'].on('exit', exitSpy);

  // Simulate severe sell delta dump
  await orchestrator['ticker'].evaluatePositionSafety(position, {
    currentPriceUsd: 0.048,
    buyPressureRatio5m: 0.15,
    volumeDelta5m: -50000,
    isEmergencyDump: true,
  });

  expect(exitSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      positionId: position.id,
      reason: 'EMERGENCY_DUMP_EXIT',
    })
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sniperAiIntegration.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement `isSniperPosition` and emergency dump detection in `tracker.ts` & `ticker.ts`**

Add `isSniperPosition` field to `Position` model. In `PositionTicker`, detect abnormal sell pressure (>80% sell volume or `isEmergencyDump`) on sniper positions and emit `EMERGENCY_DUMP_EXIT`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/sniperAiIntegration.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/core/positions/tracker.ts src/core/positions/ticker.ts src/core/orchestrator.ts test/sniperAiIntegration.test.ts
git commit -m "feat(positions): add emergency dump sentinel for active post-snipe positions"
```

---

### Task 5: Telegram Notification Formatting for Auto-Snipe

**Files:**
- Modify: `src/bot/messages/formatters.ts`
- Modify: `src/core/orchestrator.ts`
- Test: `test/bot.test.ts`

**Interfaces:**
- Produces:
  - `formatNewTokenSnipeCard(data: NewTokenSnipeCardData): string`

- [ ] **Step 1: Write failing test in `test/bot.test.ts` for `formatNewTokenSnipeCard`**

```typescript
it('formats new token auto-sniper alert message with rich metrics and security score', () => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/bot.test.ts`  
Expected: FAIL (`formatNewTokenSnipeCard` is not defined)

- [ ] **Step 3: Implement `formatNewTokenSnipeCard` in `src/bot/messages/formatters.ts`**

Format card with Telegram HTML styling, escapeHtml sanitization, price in USD & IDR, age display, and AI reasoning.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/bot.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/bot/messages/formatters.ts test/bot.test.ts
git commit -m "feat(telegram): add rich alert card for new token auto-snipe events"
```

---

### Task 6: Full Integration & Regression Suite Verification

**Files:**
- Modify: `src/index.ts`
- Run: Full vitest suite

- [ ] **Step 1: Wire up auto-sniper interval in `src/index.ts`**

Check `env.AUTO_SNIPER_ENABLED`. If true, start the periodic new token scanning loop in orchestrator (e.g. every 10 seconds).

- [ ] **Step 2: Run all project test suites to verify 0 regressions**

Run: `npm test`  
Expected: All 18+ test suites pass with 100% green status.

- [ ] **Step 3: Commit integration wiring**

```bash
git add src/index.ts
git commit -m "feat: wire up new token auto-sniper background loop in main entrypoint"
```
