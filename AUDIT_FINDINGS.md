# Scalpingbot Systematic Code Audit - Phase 1 Findings

**Audit Date:** October 6, 2026  
**Scope:** Multi-chain AI scalping bot (Base & Robinhood) - Telegram UI  
**Investigation Phase:** ROOT CAUSE ONLY (NO FIXES)

---

## CRITICAL BUGS FOUND

### [BUG-001] String Interpolation Syntax Error in orchestrator.ts (FATAL - BLOCKING STARTUP)
**Severity:** CRITICAL  
**File:** `src/core/orchestrator.ts` (lines 181, 189)  
**Root Cause:** TypeScript template literal syntax error — ellipsis (`...`) used instead of full property access

**Evidence:**
```typescript
// Line 181 - BROKEN:
this.aiBase = new AiScalpEngine({
  apiKey: config...Base || '',  // ❌ INVALID SYNTAX
  baseUrl: config.openRouterBaseUrl,

// Line 189 - BROKEN:
this.aiRobinhood = new AiScalpEngine({
  apiKey: config...hood || '',  // ❌ INVALID SYNTAX
```

**Impact:** 
- Constructor will throw `SyntaxError` or `ReferenceError` at runtime
- Orchestrator initialization fails
- Bot cannot start — 100% blocking startup failure
- Both AI engines (Base and Robinhood) never initialize

**Correct Code Should Be:**
```typescript
apiKey: config.openRouterKeyBase || '',
apiKey: config.openRouterKeyRobinhood || '',
```

---

### [BUG-002] Race Condition in PositionTicker Partial Take-Profit Logic
**Severity:** CRITICAL  
**File:** `src/core/positions/ticker.ts` (lines 100-107)  
**Root Cause:** No re-read of position state after partial TP execution; stale `pos` object used in subsequent checks

**Evidence:**
```typescript
// Line 100-107 - Race Condition:
if (pos.takeProfitPct > 15.0 && pnlPct >= 15.0 && !pos.partialTakeProfitDone) {
  if (this.onPartialTakeProfit) {
    await this.onPartialTakeProfit(pos, currentPrice, 50);  // Await modifies DB
  }
  await this.tracker.markPartialTakeProfit(pos.id, -1.0);  // Updates position state
  // Continue to next checks using STALE `pos` object
  continue;  // Position object never re-read from tracker
}

// Later checks (lines 111-135) use stale pos reference after continuation:
// - Trailing stop check uses stale `pos.trailingStopPct`
// - SL check uses stale `pos.stopLossPct` (which was just changed to -1.0%)
```

**Impact:**
- After partial TP trigger, subsequent stop-loss check uses stale stop loss value
- Position may execute exit with wrong SL threshold (old value, not new -1% breakeven)
- Trailing stop may execute with outdated position data
- Inconsistent state between in-memory `pos` and DB storage

---

### [BUG-003] Unhandled Promise Rejection in Orchestrator Callbacks
**Severity:** HIGH  
**File:** `src/core/orchestrator.ts` (lines 236-238, 520-528, 564-572)  
**Root Cause:** Async callbacks (`onAiActivity`, `onAiDebate`, `onRiskEvaluation`) fire without awaiting; errors silently swallowed with `.catch(() => {})`

**Evidence:**
```typescript
// Line 236-238:
if (this.onAiActivity) {
  this.onAiActivity(fullEntry).catch(() => {});  // Fire-and-forget, silent failure
}

// Line 520-528:
if (this.onAiDebate) {
  await this.onAiDebate({...}).catch(() => {});  // Awaited but errors ignored
}

// Line 564-572:
if (this.onAiDebate && debate) {
  await this.onAiDebate({...}).catch(() => {});  // Awaited but errors ignored
}
```

**Impact:**
- Telegram notifications silently fail if bot API is unreachable
- No logging of callback failures — invisible to operator
- User never receives trade signals, position updates, or risk alerts
- Error context lost — operator cannot debug why Telegram is silent

---

### [BUG-004] Missing Type Safety on External API Response (ai/client.ts)
**Severity:** HIGH  
**File:** `src/core/ai/client.ts` (lines 58-62)  
**Root Cause:** No validation of LLM response structure before JSON parse; `parseAiResponse()` may receive malformed data

**Evidence:**
```typescript
// Lines 58-62:
const content = response.data?.choices?.[0]?.message?.content;
if (!content) {
  throw new Error('Empty response received from LLM');
}
return content;  // Returns raw string, NOT validated JSON
```

**Flow Issue:**
1. `callLlmApi()` returns raw string `content` (line 72)
2. `parseAiResponse(rawLlmResponse)` receives string but no guarantee it's valid JSON
3. If OpenRouter returns non-JSON, `parseAiResponse()` will throw unhandled error
4. Error handler returns `DEFAULT_AVOID_DECISION` (lines 74-79), BUT confidence level unknown

---

### [BUG-005] WalletService Balance Update Race Condition
**Severity:** HIGH  
**File:** `src/core/services/walletService.ts` (lines 149-179)  
**Root Cause:** Deposit detection logic updates `lastBaseBalance`/`lastRobinhoodBalance` EVEN WHEN RPC call fails

**Evidence:**
```typescript
// Lines 149-162:
if (!baseFailed && baseWeiResult !== null) {
  if (this.lastBaseBalance !== null && balanceBaseEth > this.lastBaseBalance + 0.0001) {
    // Deposit detected → trigger callback
    this.triggerDeposit({...});
  }
  this.lastBaseBalance = balanceBaseEth;  // Update baseline
}

// Lines 165-179: IDENTICAL PATTERN for Robinhood
```

**The Issue:**
- If `baseWeiResult === null` (RPC timeout/error), `baseFailed = true`
- Then check `if (!baseFailed && baseWeiResult !== null)` skips update ✓ CORRECT
- BUT on next cycle, if RPC succeeds, balance may have ACTUALLY changed since last successful fetch
- Previous failed attempt means `lastBaseBalance` is stale, causing false deposit detection
- Or: if balance decreased due to failed swap, `lastBaseBalance` is never updated, next increase looks like deposit

---

### [BUG-006] Event Listener Never Cleaned Up (pairListener.ts)
**Severity:** MEDIUM  
**File:** `src/core/sniper/pairListener.ts` (lines 22-52)  
**Root Cause:** `watchEvent()` subscription (line 31) stores unwatch function, but cleanup only removes from map, doesn't guarantee event listener stops

**Evidence:**
```typescript
// Lines 31-49:
const unwatch = client.watchEvent({
  event: pairCreatedEvent,
  onLogs: async (logs) => {
    for (const log of logs) {
      const args = (log as any).args;  // No type validation
      if (args) {
        await onNewPair({...});  // Fire callback
      }
    }
  },
});
this.unwatchers.set(chainId, unwatch);

// Lines 55-68:
public stopListening(chainId?: number): void {
  if (chainId) {
    const unwatch = this.unwatchers.get(chainId);
    if (unwatch) {
      unwatch();  // Calls viem's unwatch function
      this.unwatchers.delete(chainId);
    }
  }
  // ...
}
```

**Implicit Bug:**
- If `stopListening()` never called before shutdown, event listener remains active
- Viem public client continues polling RPC even after orchestrator stops
- Memory leak: listeners accumulate if `startListening()` called multiple times without cleanup
- No try-catch around `unwatch()` — if viem unwatch throws, cleanup silently fails

---

### [BUG-007] Unhandled Promise Rejection in Index.ts Bootstrap
**Severity:** MEDIUM  
**File:** `src/index.ts` (lines 182-185, 229, 239)  
**Root Cause:** Async operations during bootstrap fire without proper error handling

**Evidence:**
```typescript
// Lines 181-185:
orchestrator.startPositionTicker(5000, async () => {
  const positions = await orchestrator.getPositionTracker().getActivePositions();
  if (positions.length === 0) return {};
  return await fetchLiveTokenPrices(positions.map((p) => p.tokenAddress));
});
// No try-catch — if fetchLiveTokenPrices() throws, ticker crashes silently

// Line 229:
startBotWithRetry().catch((err) => console.error('Telegram bot runner error:', err));
// Error logged but process continues — potential zombie bot state

// Line 239:
rateService.stopPeriodicRefresh();  // Called in shutdown, but no error check
```

---

### [BUG-008] Type Mismatch in LivePriceService Cache Key Inconsistency
**Severity:** MEDIUM  
**File:** `src/core/services/livePriceService.ts` (lines 21-27)  
**Root Cause:** Price map stores both checksummed and lowercase addresses, causing key lookup misses

**Evidence:**
```typescript
// Lines 21-27:
if (addr && !isNaN(price) && price > 0) {
  const lower = addr.toLowerCase();
  // Keep the highest liquidity pair if multiple pairs exist
  if (!priceMap[lower] || (pair.liquidity?.usd ?? 0) > 1000) {
    priceMap[addr] = price;        // Store original-case address
    priceMap[lower] = price;       // ALSO store lowercase
  }
}
```

**The Issue:**
- If DexScreener returns mixed-case addresses (`0xAB12...`), both formats stored
- Later lookup in `ticker.ts` line 42: `priceMap[pos.tokenAddress] || priceMap[pos.tokenAddress.toLowerCase()]`
- If position was created with different casing than what DexScreener returns, lookup may fail
- No validation that address is valid 0x format before storing

---

### [BUG-009] Unvalidated Type Cast in PairListener
**Severity:** MEDIUM  
**File:** `src/core/sniper/pairListener.ts` (line 35)  
**Root Cause:** Unsafe type assertion `(log as any).args` — no schema validation

**Evidence:**
```typescript
// Lines 33-45:
onLogs: async (logs) => {
  for (const log of logs) {
    const args = (log as any).args;  // ❌ No validation — args could be undefined
    if (args) {
      await onNewPair({
        chainId,
        token0: args.token0,  // ❌ Assumes token0 exists
        token1: args.token1,  // ❌ Assumes token1 exists
        pairAddress: args.pair,  // ❌ Assumes pair exists
        timestamp: Date.now(),
      });
    }
  }
},
```

**Impact:**
- If Viem returns log with missing `args.token0`/`args.pair`, creates malformed NewPairEvent
- Invalid token addresses passed downstream cause execution failures
- No error handling — `onNewPair()` callback executes with partial/garbage data

---

### [BUG-010] Memory Leak in PositionTicker History Map
**Severity:** MEDIUM  
**File:** `src/core/positions/ticker.ts` (lines 24-26, 38-137)  
**Root Cause:** `tickHistories` and `lastPrices` maps never cleared on position close until explicitly deleted

**Evidence:**
```typescript
// Lines 24-26:
private lastPrices: Map<string, number> = new Map();
private tickHistories: Map<string, number[]> = new Map();
private missingPriceCounts: Map<string, number> = new Map();

// Cleanup on exit (lines 94-96, 113-115, etc.):
this.lastPrices.delete(pos.id);
this.tickHistories.delete(pos.id);

// But if position exits via:
// - Execution error (not caught)
// - Timeout (pos never deleted)
// - Rugpull with zero price (line 50-53 deletes on 3rd tick, but what if never reaches 3?)
```

**Memory Leak Scenario:**
1. Position opens → entries added to `lastPrices`, `tickHistories`, `missingPriceCounts`
2. Price fetcher fails for 2 ticks
3. Position exits for reason other than ANTI_DUMP → cleanup code runs
4. But if exit triggered in `evaluateSniperSafety()` (line 155), cleanup happens
5. However, if position somehow skipped exit (edge case), maps grow unbounded over 24h

---

### [BUG-011] Missing Error Context in AI Debate Fallback
**Severity:** MEDIUM  
**File:** `src/core/orchestrator.ts` (lines 532-543)  
**Root Cause:** Debate error handling silently swallows exception; single AI verdict used without logging why debate failed

**Evidence:**
```typescript
// Lines 532-543:
let debate: any;
try {
  debate = await this.debateEngine.debateToken(candidateInput);
  if (debate.auditorReasoning?.includes('AI evaluation error')) {
    // Fallback to single AI
  }
} catch {
  // ❌ NO ERROR LOGGING — why did debate fail?
  const single = await aiClient.evaluateToken(candidateInput);
  // ... use single verdict
}
```

**Impact:**
- If debate fails (both APIs down, timeout, JSON parse error), no error logged
- Fallback to single AI decision silently masks the problem
- Operator cannot see that dual-agent debate is broken
- No metrics on how often fallback is used

---

### [BUG-012] Numeric Precision Loss in EVCalculator
**Severity:** LOW-MEDIUM  
**File:** `src/core/risk/evCalculator.ts` (lines 54-56)  
**Root Cause:** Rounding to 2 decimal places may lose precision in edge cases; cumulative errors in chained calculations

**Evidence:**
```typescript
// Lines 54-56:
const grossExpectedValue = (winProb * params.takeProfitPct) - (lossProb * params.stopLossPct);
const netExpectedValue = Math.round((grossExpectedValue - totalCostPct) * 100) / 100;
// If grossExpectedValue = 1.234567, totalCostPct = 0.15
// Math.round((1.234567 - 0.15) * 100) / 100 = Math.round(108.4567) / 100 = 1.08 ✓ OK
// BUT: If calculations involve many small positions, rounding error accumulates
```

**Implicit Issue:**
- Win probability calibration (line 35): `0.35 + (clamped / 100) * 0.35` produces floats with repeating decimals
- Example: confidence 75 → probability = 0.35 + 0.75 * 0.35 = 0.6125 → rounding to 0.61
- When multiplied with TP%, rounding error propagates

---

### [BUG-013] Race Condition in Orchestrator Position Concurrent Check
**Severity:** MEDIUM  
**File:** `src/core/orchestrator.ts` (lines 337-347, 360-364)  
**Root Cause:** `maxConcurrentPositions` check executed BEFORE and INSIDE loop; stale count may allow overflow

**Evidence:**
```typescript
// Lines 337-347 - FIRST CHECK:
const totalOpenPositions = await this.tracker.getActivePositions();
if (totalOpenPositions.length >= this.maxConcurrentPositions) {
  // Return if already at max
  return 0;
}

// Lines 359-364 - SECOND CHECK (inside loop):
for (const pair of pairs.slice(0, 5)) {
  const currentActive = await this.tracker.getActivePositions();  // Re-check inside loop
  if (currentActive.length >= this.maxConcurrentPositions) {
    break;  // Stop iteration if limit reached
  }
  // ... proceed to open position
}

// RACE: If two pairs processed simultaneously in separate scan cycles:
// Cycle 1: Finds 2/3 positions, opens pair A (now 3/3)
// Cycle 2: Checks at line 339, sees 2/3, proceeds, opens pair B (now 4/3) ❌ OVERFLOW
```

**Impact:**
- If two `runScanCycle()` calls execute concurrently on different chains (Base & Robinhood)
- Both see 2/3 positions, both pass initial check
- Both open positions → 4/3 concurrent positions (exceeds limit)
- Portfolio exceeds risk tolerance

---

### [BUG-014] Missing Null Check in WalletService Balance Formatting
**Severity:** LOW-MEDIUM  
**File:** `src/core/services/walletService.ts` (lines 134-140)  
**Root Cause:** If RPC call fails on both fallback URLs, `balanceXEth` computed from null, falls back to potentially stale `lastXBalance`

**Evidence:**
```typescript
// Lines 121-132:
const [baseWeiResult, rhWeiResult] = await Promise.all([
  baseClient.getBalance({...}).catch((err) => {
    console.warn('...Base RPC getBalance error...');
    baseFailed = true;
    return null;  // ❌ Explicit null
  }),
  rhClient.getBalance({...}).catch((err) => {
    console.warn('...Robinhood RPC getBalance error...');
    rhFailed = true;
    return null;  // ❌ Explicit null
  }),
]);

// Lines 134-140:
const balanceBaseEth = baseWeiResult !== null
  ? parseFloat(formatEther(baseWeiResult))
  : (this.lastBaseBalance ?? 0);  // Fallback to last known balance
```

**Issue:**
- If all RPC calls fail AND `lastBaseBalance === null` (first run), defaults to 0
- `triggerDeposit()` never called (line 149 check prevents it)
- But wallet balance shows as 0 in dashboard, confusing user
- No logging that RPC is completely unavailable

---

### [BUG-015] Promise.all() Dependency Chain Not Awaited in Debate Engine
**Severity:** MEDIUM  
**File:** `src/core/ai/debate.ts` (lines 29-34)  
**Root Cause:** Correct implementation but no timeout on Promise.all() — if one AI hangs, both hang

**Evidence:**
```typescript
// Lines 29-34:
const [hunterVerdict, auditorVerdict] = await Promise.all([
  this.hunter.evaluateToken(input, 'hunter'),  // 35s timeout (line 28 in client.ts)
  this.auditor.evaluateToken(input, 'auditor'),  // 35s timeout
]);
```

**Implicit Issue:**
- Each AI client has 35s timeout (line 28 in client.ts)
- But if BOTH are slow, total wait is 35s (parallel)
- If one hangs at 34.9s and other times out at 35s, entire debate waits 35s
- During debate wait, position scanner is blocked (orchestrator is async but scanner cycles are sequential)
- No outer timeout on debate itself — orchestrator.runScanCycle() can stall

---

### [BUG-016] Uninitialized Fields in Position After closePosition()
**Severity:** LOW  
**File:** `src/core/positions/tracker.ts` (lines 81-104)  
**Root Cause:** When position closed with `realizedPnlEth` undefined, field left unset but used downstream

**Evidence:**
```typescript
// Lines 81-104 - closePosition():
public async closePosition(
  id: string,
  closePriceUsd: number,
  reason: string,
  realizedPnlEth?: number  // ❌ Optional parameter
): Promise<Position | null> {
  // ...
  pos.realizedPnlEth = realizedPnlEth ?? pos.costEth * (pnlPct / 100);  // Set or compute

// But if called from certain paths (e.g., orchestrator line 744):
await this.tracker.closePosition(position.id, 0, 'RUGPULL_WRITE_OFF', -position.costEth);
// realizedPnlEth is provided ✓ OK

// Compare to orchestrator line 839-844:
await this.tracker.closePosition(position.id, 0, 'RUGPULL_WRITE_OFF', -position.costEth);
// Both provide realizedPnlEth ✓ OK
```

**Actually OK for this case**, but pattern is fragile — if optional param not provided and fallback logic incorrect, PnL undefined.

---

## Summary of Bugs by Category

### Blocking Startup (1)
- **BUG-001**: String syntax error in orchestrator.ts constructor

### Race Conditions (3)
- **BUG-002**: PositionTicker partial TP stale state
- **BUG-013**: Concurrent position limit overflow
- **BUG-005**: WalletService balance update race condition

### Unhandled Errors (4)
- **BUG-003**: Callback promise rejections silently swallowed
- **BUG-007**: Bootstrap async errors not caught
- **BUG-011**: Debate fallback errors not logged
- **BUG-004**: API response not validated before parsing

### Resource Leaks (2)
- **BUG-006**: Event listener cleanup incomplete
- **BUG-010**: PositionTicker history maps grow unbounded

### Data Quality (4)
- **BUG-008**: Price map key casing inconsistency
- **BUG-009**: Unvalidated type cast in event logs
- **BUG-014**: RPC failure handling defaults to zero balance
- **BUG-012**: Numeric precision loss in EV calculations

### Performance (1)
- **BUG-015**: Debate timeout has no outer bound

---

## Recommendations for Fix Priority

**Immediate (blocks production):**
1. BUG-001: Fix string interpolation syntax
2. BUG-003: Add error logging to callbacks
3. BUG-005: Fix balance baseline update logic

**High Priority (data loss risk):**
4. BUG-002: Re-read position state after partial TP
5. BUG-013: Use atomic position limit check

**Medium Priority (reliability):**
6. BUG-006: Add cleanup verification
7. BUG-010: Implement map eviction policy
8. BUG-011: Log debate fallback reasons

**Low Priority (edge cases):**
9. BUG-004, BUG-007, BUG-008, BUG-009, BUG-012, BUG-014, BUG-015: Address as part of Phase 2 fixes
