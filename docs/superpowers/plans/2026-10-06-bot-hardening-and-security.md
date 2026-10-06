# Bot Hardening & Security Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate 5 critical flaws in the scalping bot: replace hardcoded security scores with GoPlus API, enforce on-chain block receipt confirmation to prevent phantom trades, calculate accurate PnL from real wallet ETH delta and gas fees, implement token symbol deduplication to block copycat honeypots, and guard Robinhood V4 execution.

**Architecture:** A layered hardening approach: Pre-screening deduplication blocks identical tickers; a new `TokenSecurityService` queries GoPlus API with in-memory TTL caching and on-chain simulation fallback; `BaseRouterExecutor` awaits `publicClient.waitForTransactionReceipt` checking for status `'success'` and measures real wallet balance before and after trades; `ExecutionEngine` isolates Robinhood Chain to paper mode.

**Tech Stack:** TypeScript (ESM), Node.js, Viem v2, Vitest, Axios, GramMY.

**Spec:** `docs/superpowers/specs/2026-10-06-bot-hardening-and-security-design.md`

## Global Constraints

- Project operates on Node.js ESM (`"type": "module"` in `package.json`).
- All imports must include `.js` extension (e.g. `import ... from './securityService.js'`).
- Base chain ID is 8453; Robinhood chain ID is 4663.
- All existing 85 Vitest tests in `test/` must continue to pass without regression.

## Review Focus

1. Reverted on-chain buy transactions must not open a position in `PositionTracker`.
2. Sell transactions resulting in negative net ETH due to gas/slippage must record negative realized PnL even if token price increased.
3. Duplicate ticker tokens with different contract addresses must be blocked when an active position with the same symbol already exists.
4. Tokens with honeypot flags or buy/sell tax > 10% from GoPlus must receive 0 simulation/tax points and be rejected.
5. Live buy orders on Robinhood chain (4663) must be intercepted and executed via paper simulation.

---

### Task 1: Token Deduplication & Anti-Copycat Protection

**Files:**
- Modify: `src/core/positions/tracker.ts`
- Modify: `src/core/orchestrator.ts`
- Test: `test/tokenDeduplication.test.ts`

**Interfaces:**
- Consumes: `PositionTracker.getActivePositions()`, `DexPairData.baseToken`
- Produces: `PositionTracker.hasOpenPositionForSymbol(symbol: string): Promise<boolean>`

- [ ] **Step 1: Write the failing test for symbol deduplication**

Create `test/tokenDeduplication.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PositionTracker } from '../src/core/positions/tracker.js';
import { JsonStorage } from '../src/storage/db.js';
import fs from 'fs';
import path from 'path';

describe('Token Deduplication & Copycat Shield', () => {
  const testDbPath = path.join(process.cwd(), 'test-data-dedup.json');
  let storage: JsonStorage;
  let tracker: PositionTracker;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    storage = new JsonStorage(testDbPath);
    tracker = new PositionTracker(storage);
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('detects existing open position by normalized symbol', async () => {
    await tracker.openPosition({
      id: 'pos_1',
      chainId: 8453,
      tokenAddress: '0x1111111111111111111111111111111111111111',
      tokenSymbol: 'OPENHUMAN',
      entryPriceUsd: 1.0,
      amountTokens: 100,
      costEth: 0.01,
      takeProfitPct: 10,
      stopLossPct: 5,
      mode: 'paper',
      status: 'OPEN',
      openedAt: Date.now(),
    });

    // Check same symbol lowercase
    const hasOpenLower = await tracker.hasOpenPositionForSymbol('openhuman');
    expect(hasOpenLower).toBe(true);

    // Check same symbol with punctuation
    const hasOpenPunct = await tracker.hasOpenPositionForSymbol('$OPENHUMAN');
    expect(hasOpenPunct).toBe(true);

    // Check unrelated symbol
    const hasOther = await tracker.hasOpenPositionForSymbol('OTHER');
    expect(hasOther).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tokenDeduplication.test.ts`
Expected: FAIL with `tracker.hasOpenPositionForSymbol is not a function`.

- [ ] **Step 3: Implement `hasOpenPositionForSymbol` in `tracker.ts` and check it in `orchestrator.ts`**

In `src/core/positions/tracker.ts`, add:
```ts
  public async hasOpenPositionForSymbol(symbol: string): Promise<boolean> {
    const active = await this.getActivePositions();
    const cleanTarget = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return active.some((p) => {
      const cleanExisting = p.tokenSymbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
      return cleanExisting === cleanTarget;
    });
  }
```

In `src/core/orchestrator.ts`:
In `runScanCycle`:
```ts
      // Check duplicate symbol to block copycats
      if (await this.tracker.hasOpenPositionForSymbol(pair.baseToken.symbol)) {
        continue;
      }
```
In `evaluateAndSnipeNewPools`:
```ts
      if (await this.tracker.hasOpenPositionForSymbol(candidate.tokenSymbol)) {
        continue;
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tokenDeduplication.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add src/core/positions/tracker.ts src/core/orchestrator.ts test/tokenDeduplication.test.ts
git commit -m "feat: add token symbol deduplication to block copycat honeypots"
```

---

### Task 2: Real Security Verification Layer (GoPlus API & Dynamic Scorer)

**Files:**
- Create: `src/core/services/securityService.ts`
- Modify: `src/core/screener/securityScore.ts`
- Modify: `src/core/orchestrator.ts`
- Test: `test/securityService.test.ts`

**Interfaces:**
- Consumes: GoPlus REST API (`https://api.gopluslabs.io/api/v1/token_security`)
- Produces: `securityService.fetchSecurityData(chainId: number, tokenAddress: string): Promise<TokenSecurityFactors>`
- Produces: `TokenSecurityScorer.calculateScore(factors: TokenSecurityFactors): TokenSecurityScoreResult`

- [ ] **Step 1: Write the failing test for `TokenSecurityService` and enhanced scorer**

Create `test/securityService.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { TokenSecurityService } from '../src/core/services/securityService.js';
import { TokenSecurityScorer } from '../src/core/screener/securityScore.js';

describe('TokenSecurityService & Dynamic Scorer', () => {
  it('penalizes honeypots and high tax tokens down to 0 score', () => {
    const scorer = new TokenSecurityScorer(80);
    const honeypotResult = scorer.calculateScore({
      canSell: false,
      isHoneypot: true,
      buyTaxPct: 20,
      sellTaxPct: 25,
      liquidityUsd: 100000,
      isOpenTrading: true,
      holderCount: 50,
      top10HolderPct: 80,
    });

    expect(honeypotResult.passed).toBe(false);
    expect(honeypotResult.totalScore).toBe(0);
    expect(honeypotResult.reasons.some(r => r.includes('honeypot'))).toBe(true);
  });

  it('awards high score for clean token with low tax and distributed holders', () => {
    const scorer = new TokenSecurityScorer(80);
    const cleanResult = scorer.calculateScore({
      canSell: true,
      isHoneypot: false,
      buyTaxPct: 0,
      sellTaxPct: 0.5,
      liquidityUsd: 60000,
      fdvUsd: 300000,
      isOpenTrading: true,
      holderCount: 500,
      top10HolderPct: 25,
    });

    expect(cleanResult.passed).toBe(true);
    expect(cleanResult.totalScore).toBeGreaterThanOrEqual(85);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run test/securityService.test.ts`
Expected: FAIL due to missing `TokenSecurityService`.

- [ ] **Step 3: Implement `TokenSecurityService` and update `TokenSecurityScorer`**

Create `src/core/services/securityService.ts` with GoPlus API integration, 5-minute memory cache, and fallback handling.
Update `src/core/screener/securityScore.ts` with `holderCount` and `top10HolderPct` scoring criteria (20 pts for holder distribution).
Wire `securityService.fetchSecurityData()` in `src/core/orchestrator.ts` during pre-screening in `runScanCycle` and `evaluateAndSnipeNewPools`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/securityService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add src/core/services/securityService.ts src/core/screener/securityScore.ts src/core/orchestrator.ts test/securityService.test.ts
git commit -m "feat: integrate GoPlus Security API with dynamic holder & tax scoring"
```

---

### Task 3: Anti-Phantom Trade Execution (On-Chain Receipt Confirmation)

**Files:**
- Modify: `src/core/execution/routers/baseRouter.ts`
- Modify: `src/core/execution/engine.ts`
- Test: `test/receiptConfirmation.test.ts`

**Interfaces:**
- Consumes: `PublicClient.waitForTransactionReceipt`, `ERC20.balanceOf`
- Produces: Verified `BuyResult` and `SellResult` containing confirmed on-chain receipts and verified token balances.

- [ ] **Step 1: Write the failing test for receipt confirmation and revert handling**

Create `test/receiptConfirmation.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { BaseRouterExecutor } from '../src/core/execution/routers/baseRouter.js';
import { ExecutionEngine } from '../src/core/execution/engine.js';
import { PaperTrader } from '../src/core/execution/paperTrader.js';
import { PositionTracker } from '../src/core/positions/tracker.js';
import { JsonStorage } from '../src/storage/db.js';
import fs from 'fs';
import path from 'path';

describe('Anti-Phantom Receipt Confirmation', () => {
  const dbPath = path.join(process.cwd(), 'test-data-receipt.json');

  afterEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('rejects buy order and does not open position when receipt status is reverted', async () => {
    const mockPublicClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'reverted' }),
      readContract: vi.fn().mockResolvedValue(0n),
    };
    const mockWalletClient = {
      account: { address: '0x1234' },
      sendTransaction: vi.fn().mockResolvedValue('0xrevertedtxhash'),
    };
    const mockViemManager = {
      getPublicClient: vi.fn().mockReturnValue(mockPublicClient),
      getWalletClient: vi.fn().mockReturnValue(mockWalletClient),
    } as any;

    const baseRouter = new BaseRouterExecutor(mockViemManager);
    const storage = new JsonStorage(dbPath);
    const tracker = new PositionTracker(storage);
    const paperTrader = new PaperTrader(tracker);
    const engine = new ExecutionEngine({
      mode: 'live',
      paperTrader,
      tracker,
      baseRouter,
    });

    const buyResult = await engine.executeBuy({
      chainId: 8453,
      tokenAddress: '0xToken',
      tokenSymbol: 'REVERT',
      amountEth: 0.01,
      currentPriceUsd: 1.0,
      takeProfitPct: 10,
      stopLossPct: 5,
    });

    expect(buyResult.success).toBe(false);
    expect(buyResult.error).toContain('reverted');
    const positions = await tracker.getActivePositions();
    expect(positions.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run test/receiptConfirmation.test.ts`
Expected: FAIL because `baseRouter` returns `success: true` immediately without checking receipt.

- [ ] **Step 3: Implement `waitForTransactionReceipt` in `baseRouter.ts`**

Update `BaseRouterExecutor.executeBuy` in `src/core/execution/routers/baseRouter.ts`:
1. Call `publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30000 })`.
2. Check `receipt.status === 'success'`. If reverted, return `{ success: false, txHash, error: 'Buy transaction reverted on-chain' }`.
3. Check actual received tokens via `publicClient.readContract({ address: order.tokenAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })`.
Update `BaseRouterExecutor.executeSell` in `src/core/execution/routers/baseRouter.ts`:
1. Call `publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30000 })`.
2. Check `receipt.status === 'success'`. If reverted, return `{ success: false, txHash, error: 'Sell transaction reverted on-chain' }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/receiptConfirmation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add src/core/execution/routers/baseRouter.ts test/receiptConfirmation.test.ts
git commit -m "fix: enforce on-chain transaction receipt confirmation to prevent phantom trades"
```

---

### Task 4: Robinhood Chain Safety Guard (Paper/Shadow Isolation)

**Files:**
- Modify: `src/core/execution/engine.ts`
- Test: `test/robinhoodGuard.test.ts`

**Interfaces:**
- Consumes: `BuyOrderParams.chainId`, `ExecutionEngine.mode`
- Produces: Diverted paper execution with warning for Robinhood chain (4663) in live mode.

- [ ] **Step 1: Write the failing test for Robinhood live safety guard**

Create `test/robinhoodGuard.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { ExecutionEngine } from '../src/core/execution/engine.js';
import { PaperTrader } from '../src/core/execution/paperTrader.js';
import { PositionTracker } from '../src/core/positions/tracker.js';
import { JsonStorage } from '../src/storage/db.js';
import fs from 'fs';
import path from 'path';

describe('Robinhood Chain Safety Guard', () => {
  const dbPath = path.join(process.cwd(), 'test-data-rhguard.json');

  afterEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('diverts Robinhood chain live orders to paper simulation to prevent V4 router revert', async () => {
    const storage = new JsonStorage(dbPath);
    const tracker = new PositionTracker(storage);
    const paperTrader = new PaperTrader(tracker);
    const spySimulateBuy = vi.spyOn(paperTrader, 'simulateBuy');

    const engine = new ExecutionEngine({
      mode: 'live',
      paperTrader,
      tracker,
      rhRouter: {} as any,
    });

    const result = await engine.executeBuy({
      chainId: 4663,
      tokenAddress: '0xRHMemecoin',
      tokenSymbol: 'RHCOIN',
      amountEth: 0.01,
      currentPriceUsd: 0.5,
      takeProfitPct: 15,
      stopLossPct: 7,
    });

    expect(spySimulateBuy).toHaveBeenCalled();
    expect(result.success).toBe(true);
    const active = await tracker.getActivePositions();
    expect(active[0].mode).toBe('paper');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run test/robinhoodGuard.test.ts`
Expected: FAIL because `rhRouter` would be called instead of `simulateBuy`.

- [ ] **Step 3: Implement Robinhood Guard in `ExecutionEngine`**

In `src/core/execution/engine.ts`:
In `executeBuy`:
```ts
    if (this.mode === 'paper' || this.mode === 'shadow' || order.chainId === 4663) {
      result = await this.paperTrader.simulateBuy(order, this.mode === 'shadow');
    } else { ... }
```
Ensure position is saved with `mode: order.chainId === 4663 && this.mode === 'live' ? 'paper' : this.mode`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/robinhoodGuard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add src/core/execution/engine.ts test/robinhoodGuard.test.ts
git commit -m "fix: guard Robinhood V4 execution by automatically diverting to paper mode"
```

---

### Task 5: Accurate Real-Balance On-Chain Accounting (Wallet Delta & Gas)

**Files:**
- Modify: `src/core/execution/routers/baseRouter.ts`
- Modify: `src/core/positions/tracker.ts`
- Modify: `src/bot/messages/formatters.ts`
- Test: `test/realAccounting.test.ts`

**Interfaces:**
- Consumes: `publicClient.getBalance`, `receipt.gasUsed`, `receipt.effectiveGasPrice`
- Produces: `realizedPnlEth = Number(formatEther(balanceAfter - balanceBefore))`

- [ ] **Step 1: Write the failing test for real balance delta accounting**

Create `test/realAccounting.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { BaseRouterExecutor } from '../src/core/execution/routers/baseRouter.js';
import { parseEther } from 'viem';

describe('Real Balance Delta & Gas Accounting', () => {
  it('calculates realized PnL from wallet balance difference instead of nominal price', async () => {
    // Initial balance: 1.0 ETH
    // Cost of position: 0.02 ETH
    // DEX returned 0.019 ETH after sell fees/gas -> Balance after: 0.999 ETH
    // Real delta: -0.001 ETH
    const mockPublicClient = {
      readContract: vi.fn().mockResolvedValue(1000n), // balance & allowance
      getBalance: vi.fn()
        .mockResolvedValueOnce(parseEther('1.0')) // before sell
        .mockResolvedValueOnce(parseEther('1.018')), // after sell (received 0.018 ETH net)
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        gasUsed: 50000n,
        effectiveGasPrice: 1000000000n, // 1 gwei
      }),
    };
    const mockWalletClient = {
      account: { address: '0xWallet' },
      sendTransaction: vi.fn().mockResolvedValue('0xselltxhash'),
    };
    const mockViemManager = {
      getPublicClient: vi.fn().mockReturnValue(mockPublicClient),
      getWalletClient: vi.fn().mockReturnValue(mockWalletClient),
    } as any;

    const baseRouter = new BaseRouterExecutor(mockViemManager);
    const result = await baseRouter.executeSell(
      {
        id: 'pos_1',
        chainId: 8453,
        tokenAddress: '0xToken',
        tokenSymbol: 'NFTM',
        entryPriceUsd: 1.0,
        amountTokens: 100,
        costEth: 0.02,
        takeProfitPct: 10,
        stopLossPct: 5,
        mode: 'live',
        status: 'OPEN',
        openedAt: Date.now(),
      },
      1.30 // Token price nominally pumped +30%!
    );

    expect(result.success).toBe(true);
    // Realized PnL must be net ETH received (0.018 ETH) - cost (0.02 ETH) = -0.002 ETH
    // NOT +30% (+0.006 ETH)!
    expect(result.realizedPnlEth).toBeCloseTo(-0.002, 5);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run test/realAccounting.test.ts`
Expected: FAIL because `baseRouter` returns nominal formula `costEth * (pnlPct / 100) = +0.006 ETH`.

- [ ] **Step 3: Implement real balance delta calculation in `baseRouter.ts` and `tracker.ts`**

In `BaseRouterExecutor.executeSell`:
1. Measure `balanceBefore = await publicClient.getBalance({ address: account.address })`.
2. Await `waitForTransactionReceipt`.
3. Measure `balanceAfter = await publicClient.getBalance({ address: account.address })`.
4. Calculate `netReceivedEth = Number(formatEther(balanceAfter - balanceBefore))`.
5. Calculate `realizedPnlEth = netReceivedEth - position.costEth`.
6. Calculate `realizedPnlPct = (realizedPnlEth / position.costEth) * 100`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/realAccounting.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add src/core/execution/routers/baseRouter.ts src/core/positions/tracker.ts test/realAccounting.test.ts
git commit -m "fix: calculate realized PnL from real wallet balance delta and gas fees"
```

---

### Task 6: Full Regression Verification

**Files:**
- Entire codebase and test directory `test/`

- [ ] **Step 1: Run complete test suite**

Run: `npm test`
Expected: All 23+ test files and 90+ tests pass with 0 failures.

- [ ] **Step 2: Run TypeScript compile verification**

Run: `npm run build`
Expected: TypeScript compile succeeds without any type errors (`tsc` exits 0).

- [ ] **Step 3: Commit final integration state**

```bash
git add .
git commit -m "test: verify all hardened bot components and full test suite regression"
```
