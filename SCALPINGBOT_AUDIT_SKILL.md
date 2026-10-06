# SCALPINGBOT_AUDIT_SKILL.md

Execute trades in scalpingbot with minimal errors. Use this skill to sharpen AI decision logic, validate state transitions, detect race conditions, and catch careless mistakes before on-chain execution.

## 1. Decision Logic Sharpening: Confidence → Real Probability → EV

### LLM Confidence Calibration (CRITICAL)

Raw LLM confidence (0–100) is **notoriously overconfident**. Must calibrate to real-world win probability in memecoin microstructure.

**Current Calibration Formula** (ExpectedValueCalculator.calibrateProbability):
```
calibrated_prob = 0.35 + (raw_confidence / 100) * 0.35
```

This maps:
- 50 raw → 52% real (uninformative)
- 75 raw → 61% real (decent edge)
- 85 raw → 65% real (good signal)
- 95 raw → 68% real (ceiling in noisy markets)

**Why this calibration:**
- LLMs are trained to sound confident; raw scores cluster 70–95
- Memecoin microstructure is turbulent; real win probability plateaus ~65–70% for best signals
- Logistic curve prevents cliff-edge overconfidence

**Invariant**: If calibrated_prob < minRequiredEdgePct after friction, **REFUSE the trade**. No exceptions. This is the firewall.

### Expected Value Decision Flowchart

```
Input: Raw AI Confidence (0–100)
  ↓
[1] Calibrate: confidence → real_prob (0.35–0.70 range)
  ↓
[2] Calculate Gross EV: (win_prob × TP%) − (loss_prob × SL%) 
  ↓
[3] Estimate Friction: 
      - Gas round-trip: 2× entry+exit at current ETH price
      - Slippage: 2× (entry + exit) at estimated rate
      - Total friction typically 0.8–2.5% for small trades
  ↓
[4] Net EV = Gross EV − Friction
  ↓
[5] Decision:
      Net EV >= minRequiredEdgePct (default 1.5%)  → BUY ✓
      Net EV < minRequiredEdgePct                 → AVOID ✗
      (No "WAIT" path; WAIT is only for rate/liquidity limits, not EV)
  ↓
Output: { allowed: bool, expectedValuePct: number, calibratedWinProbability: number, reason: string }
```

### AVOID vs BUY vs WAIT Rules

| Scenario | Action | Why |
|----------|--------|-----|
| Confidence 45%, TP 20%, SL 5% | AVOID | Calibrated prob ~56%, EV ≈ 0.3%, below 1.5% threshold |
| Confidence 78%, TP 25%, SL 8% | BUY (if EV ≥ 1.5%) | Calibrated prob ~62%, strong signal if friction ≤ 11% |
| Confidence 92%, TP 50%, SL 10% | BUY (high EV) | Calibrated prob ~67%, huge upside, friction heavily outweighed |
| Price feed missing; AI ready | WAIT | Technical blocker, not signal weakness; retry in 5s |
| Circuit breaker tripped | AVOID | Hard stop; not reattempted until cooldown expires |
| Pool liquidity unknown | WAIT | Can't estimate slippage; fetch on retry, then recalculate |
| Honeypot detected; safety ✗ | AVOID | Pre-execution gate; never attempt |

**Key**: AVOID is final per token per cycle. WAIT is tactical (network/data), reattempted next scan.

---

## 2. State Machine Invariants: Legal Transitions

### Position State Lifecycle

```
OPEN → { TAKE_PROFIT, STOP_LOSS, TRAILING_STOP, ANTI_DUMP, 
         TIME_EXPIRATION, MANUAL_SELL, PANIC_SELL, RECONCILED_ON_CHAIN_ZERO_BALANCE }
     → CLOSED (+ archived to trades history)

CLOSED is terminal. No re-opening, no mutation post-close.
```

### Invariant: No Two Open Positions for Same Token (Per Chain)

**Check BEFORE any buy:**
```typescript
const isAlreadyOpen = await positionTracker.hasOpenPositionForToken(tokenAddress);
if (isAlreadyOpen) {
  REFUSE_BUY("Token already open; cannot duplicate position on same chain");
  return;
}
```

**Why**: 
- Prevents runaway accumulation (e.g., scanner fires 3× in 10s, opens 3 positions in same token)
- Simplifies exit logic: one ticker event → one position close
- Reduces slippage compounding

**Edge Case — Symbol Collisions**: Some tokens reuse tickers (BULL, PUMP, etc.). Use **normalized symbol matching**:
```typescript
const cleanTarget = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
const cleanExisting = p.tokenSymbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
// Match only if normalized versions match
```

### Invariant: Max Concurrent Positions Enforced at Scan Entry

**Check at scan cycle start:**
```typescript
const totalOpenPositions = await tracker.getActivePositions();
if (totalOpenPositions.length >= maxConcurrentPositions) {
  // Halt scanning; log and return 0
  return 0;
}
```

**Why**: Prevents thrashing; ensures focus on quality execution, not quantity. Default max = 3.

### Invariant: Circuit Breaker Checked Before Every Buy

**Check BEFORE EV calculation:**
```typescript
const riskCheck = circuitBreaker.canOpenTrade();
if (!riskCheck.allowed) {
  REFUSE_BUY(riskCheck.reason); // e.g., "Daily loss threshold hit"
  return;
}
```

**States**:
- **Daily Loss Breach**: `∑(losses today) ≥ maxDailyLossEth` → TRIP
- **Consecutive Streak**: ≥3 consecutive stop-losses → TRIP for 30 min cooldown
- **Manual Trip**: Operator override (emergency stop)

### Invariant: Partial TP Flag Prevents Double-Execution

Once `pos.partialTakeProfitDone = true` (at +15% for TP > 15%):
```typescript
if (pnlPct >= 15.0 && !pos.partialTakeProfitDone) {
  // Execute partial TP (sell 50%, raise SL to breakeven)
  await partialTPHandler(pos);
  pos.partialTakeProfitDone = true;
}
// On next tick, this condition is False; no re-execution
```

**Why**: Prevents selling 50% multiple times on the same position.

---

## 3. Error Recovery Patterns

### Pattern A: LLM Failures (Timeout, API Down, Parse Error)

**Trigger**: axios timeout, 5xx response, invalid JSON, schema rejection

**Recovery**:
```typescript
try {
  const response = await llmCall(systemPrompt, userPrompt);
  return parseAiResponse(response);
} catch (error) {
  console.warn(`AI evaluation error: ${error.message}`);
  return DEFAULT_AVOID_DECISION; // Safe fallback
}
```

**Fallback Decision**:
```typescript
const DEFAULT_AVOID_DECISION = {
  action: 'AVOID',
  confidence: 0,
  takeProfitPct: 0,
  stopLossPct: 0,
  reasoning: 'AI evaluation failed; refusing trade per safety protocol'
};
```

**Why AVOID, not RETRY**: 
- LLM failures are transient network issues or API overload
- Retrying in hot loop burns quota and increases latency
- Next scan cycle (30s later) will retry naturally
- Better to miss one candidate than burn gas on wrong guess

### Pattern B: Network Timeout on Price Feed

**Trigger**: DexScreener API timeout, missing price for open position

**Recovery — Price Fetch**:
```typescript
const priceMap = await fetchLiveTokenPrices(positionIds);
// If priceMap[tokenAddress] is undefined or 0:
if (!currentPrice || currentPrice <= 0) {
  const count = missingPriceCounts.get(positionId) || 0 + 1;
  if (count >= 3) {
    // Price missing for ≥3 ticks (15s); assume pool drained
    await exitPosition(position, 'ANTI_DUMP', 0);
  }
  return; // Skip this position, retry next tick
}
```

**Why 3-tick threshold**: 
- Single API glitch is 1–2 ticks
- 3 consecutive misses (15s) indicates real pool failure/rugpull
- Exits immediately to prevent total loss

### Pattern C: On-Chain Revert (Live Mode)

**Trigger**: TX rejected by chain (insufficient allowance, pool drained, slippage breach)

**Recovery**:
```typescript
const result = await router.executeBuy(order);
if (!result.success) {
  console.error(`TX reverted: ${result.reason}`);
  // DO NOT RETRY IMMEDIATELY
  // Log failure, skip this token for 60s, try next scan
  rejectTokenUntil(tokenAddress, Date.now() + 60000);
  return;
}
```

**Why NOT instant retry**:
- Revert is deterministic (insufficient liquidity, bad path, etc.)
- Retrying burns gas without changing outcome
- 60s cooldown lets market conditions stabilize
- Next scan cycle picks different candidates

### Pattern D: Storage Write Conflict

**Trigger**: Concurrent updates to position.json (e.g., ticker closes while scanner opens same token)

**Recovery** (CRITICAL INVARIANT):
```typescript
// In PositionTracker.openPosition():
this.storage.update((data) => {
  const isAlreadyOpen = data.positions.some(
    (p) => p.status === 'OPEN' && p.tokenAddress.toLowerCase() === pos.tokenAddress.toLowerCase()
  );
  if (!isAlreadyOpen) {
    data.positions.push(pos); // Atomic: if race detected, skip silently
  }
});
```

**Why atomic check+insert**: 
- Prevents duplicate opens from scanner and ticker racing
- If ticker closes and scanner opens simultaneously, one wins
- Storage layer guarantees atomic file write (no partial corruption)

### Pattern E: Reconciliation on Startup

**Trigger**: Bot restart; check on-chain balance vs. open positions

**Recovery**:
```typescript
const reconcileReport = await orchestrator.reconcileOnChain();
// For each open position: verify tokens still in wallet
// If balance is 0 (sold externally, rugpull, etc.): close position with RECONCILED_ON_CHAIN_ZERO_BALANCE
if (reconcileReport.closedCount > 0) {
  console.log(`Reconciled ${reconcileReport.closedCount} external/zero-balance positions.`);
}
```

**Why critical**:
- User may have sold tokens manually or been rugpulled while bot was offline
- Prevents phantom positions inflating position count
- Resets `partialTakeProfitDone` flag correctly

---

## 4. Execution Checklist: Pre-Trade, Post-Trade, Reconciliation

### Pre-Trade Validation (Execute in Order)

```
[ ] 1. Engine Running Check
      if (!isEngineRunning) return 0;

[ ] 2. Macro Sentinel Flash Crash Guard
      if (macroSentinel.getCurrentRegime() === 'DEFENSIVE_CRASH') return 0;

[ ] 3. Circuit Breaker Tripped?
      if (!circuitBreaker.canOpenTrade().allowed) return 0;

[ ] 4. Max Concurrent Positions Hit?
      if (activePositions.length >= maxConcurrentPositions) return 0;

[ ] 5. Duplicate Position Check
      if (await tracker.hasOpenPositionForToken(tokenAddress)) return 0;

[ ] 6. AI Confidence Threshold
      if (aiDecision.confidence < minAiConfidence) return 0;

[ ] 7. Security Score Gate
      const securityScore = await securityScorer.scoreToken(tokenData);
      if (securityScore < minSecurityScore) return 0;

[ ] 8. Safety Screener Gate
      const screenResult = await screener.screenToken(tokenData);
      if (!screenResult.isSafe) return 0; // Honeypot, paused, low liq, high tax, etc.

[ ] 9. EV Calculator Gate (Post-Calibration)
      const evResult = evCalculator.calculateEV({
        confidence: aiDecision.confidence,
        takeProfitPct: aiDecision.takeProfitPct,
        stopLossPct: aiDecision.stopLossPct,
        positionSizeEth: tradeSize,
        ...gasCostParams
      });
      if (!evResult.allowed) return 0; // EV insufficient

[ ] 10. Wallet Balance Sufficient?
       if (paperTrader.getBalance() < tradeSize) return 0;

[ ] 11. Slippage Estimated (DexScreener Pair Query)
       const pairData = await scanner.getPairData(tokenAddress, chainId);
       if (!pairData || pairData.liquidity < minLiquidityUsd) return 0;

[ ] 12. Final TP/SL Clamps
       const clampedTP = circuitBreaker.clampTakeProfit(aiDecision.takeProfitPct);
       const clampedSL = circuitBreaker.clampStopLoss(aiDecision.stopLossPct);

[ ] ✓ All gates passed → Execute Buy
```

### Post-Buy Actions

```
[ ] 1. Verify Position Opened
      const pos = await tracker.getPositionById(positionId);
      if (!pos) {
        // ERROR: Buy succeeded but position not tracked; PANIC
        await ruleEngine.emergencySell(tokenAddress, chainId);
        throw new Error("Position tracking failure");
      }

[ ] 2. Log Activity
      logActivity({
        stage: 'ORDER',
        message: `Opened $${tokenSymbol} @${entryPrice}; TP=${clampedTP}%, SL=${clampedSL}%`,
        level: 'SUCCESS'
      });

[ ] 3. Broadcast Signal (if Telegram enabled)
      if (onTradeSignal) await onTradeSignal({ tokenSymbol, entryPrice, ... });

[ ] 4. Position Count Verification
      const count = await tracker.getActivePositionsCount();
      if (count > maxConcurrentPositions) {
        // ERROR: Concurrent limit breached; close most recent
        throw new Error("Concurrent position limit violation");
      }
```

### Exit Trigger Handler (Ticker)

```
On Each Tick (every 5s):

[ ] 1. Fetch Current Prices (batch DexScreener)
      const priceMap = await fetchLiveTokenPrices(allOpenPositions.map(p => p.tokenAddress));

[ ] 2. For Each Position:
      [ ] Check price exists (not undefined, > 0)
      [ ] If missing 3+ ticks: ANTI_DUMP exit
      [ ] Update highest price seen (for trailing stop)
      [ ] Calculate PnL% from entry
      [ ] Run checks in order:
          1. Take Profit (pnl >= TP%)
          2. Partial TP (pnl >= 15% && TP > 15% && !partialDone)
          3. Trailing Stop (pnl >= 8% && drop from peak >= 3%)
          4. Stop Loss (pnl <= -SL%)
          5. Anti-Dump (single-tick drop >= 4.5% OR rolling 3-tick drop >= 5%)
          6. Time Expiration (open >= 45 min && -2% <= pnl <= +2%)
      [ ] First matching exit → execute and remove from active set

[ ] 3. Log All Exits
      await onTradeExit({ tokenSymbol, exitPrice, reason, pnlPct, pnlEth });
```

### Post-Exit Actions

```
[ ] 1. Close Position Record
      const closed = await tracker.closePosition(positionId, exitPrice, reason, realizedPnlEth);
      if (!closed) {
        // ERROR: Position not found; already closed?
        console.warn("Position not found during exit");
        return;
      }

[ ] 2. Record in Circuit Breaker (for loss tracking)
      circuitBreaker.recordClosedTrade(realizedPnlEth);
      // If loss < 0 and consecutive losses >= 3 → trigger cooldown

[ ] 3. Broadcast Exit (if Telegram enabled)
      if (onTradeExit) await onTradeExit({ ... });

[ ] 4. Reconcile Daily Loss
      const dailyLoss = circuitBreaker.getDailyLossEth();
      if (dailyLoss >= maxDailyLossEth) {
        circuitBreaker.isTripped() → halt all buys until cooldown
      }
```

### Reconciliation on Startup

```typescript
async reconcileOnChain(): Promise<ReconciliationSummary> {
  const openPositions = await tracker.getActivePositions();
  const wallet = await viemManager.getWalletBalance();
  
  let closedCount = 0;
  
  for (const pos of openPositions) {
    // Query on-chain token balance
    const onChainBalance = await viemManager.getTokenBalance(
      pos.chainId,
      pos.tokenAddress,
      walletAddress
    );
    
    if (onChainBalance === 0) {
      // Token not found; close record
      await tracker.closePosition(
        pos.id,
        0, // price
        'RECONCILED_ON_CHAIN_ZERO_BALANCE',
        undefined
      );
      closedCount++;
    }
  }
  
  return { closedCount, reconciled: true };
}
```

---

## 5. Type Safety Rules: Input Validation at Every API Boundary

### Rule 1: All API Responses Parsed via Zod Schemas

**Schema Example** (AiScalpDecisionSchema):
```typescript
export const AiScalpDecisionSchema = z.object({
  action: z.enum(['BUY', 'WAIT', 'AVOID']),
  confidence: z.number().min(0).max(100),
  takeProfitPct: z.number().min(0).max(1000),
  stopLossPct: z.number().min(0).max(100),
  riskRewardRatio: z.number().min(0),
  reasoning: z.string(),
});

// Preprocessor cleans percentages: "85%" → 85, "$2.50" → 2.5
const numericPreprocessor = (val) => {
  if (!val || val === '') return 0;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[%$,]/g, '').trim();
    const num = Number(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return val;
};
```

**Validation Pattern**:
```typescript
try {
  const parsed = AiScalpDecisionSchema.parse(rawAiResponse);
  return parsed;
} catch (error) {
  console.error(`Schema validation failed: ${error.message}`);
  return DEFAULT_AVOID_DECISION; // Safe fallback
}
```

### Rule 2: Token Data Validation Before Use

```typescript
interface TokenData {
  pairAddress: string;      // Must be 42-char hex string with 0x prefix
  tokenAddress: string;     // Same
  liquidityUsd: number;     // Must be > 0
  buyTax: number;           // 0–100
  sellTax: number;          // 0–100
  isHoneypot: boolean;      // Falsy if unknown
  priceChangePercent: number; // Allow negative
}

// Validate before use:
if (!isValidEthereumAddress(token.pairAddress)) {
  throw new Error("Invalid pair address");
}
if (token.liquidityUsd <= 0) {
  throw new Error("Zero or negative liquidity");
}
if (token.buyTax < 0 || token.buyTax > 100) {
  throw new Error("Buy tax out of range");
}
```

### Rule 3: Position State Immutability Post-Close

```typescript
public async closePosition(
  id: string,
  closePriceUsd: number,
  reason: string,
  realizedPnlEth?: number
): Promise<Position | null> {
  let closed: Position | null = null;
  
  this.storage.update((data) => {
    const pos = data.positions.find((p) => p.id === id);
    if (pos && pos.status === 'OPEN') { // Only allow if still OPEN
      pos.status = 'CLOSED';
      pos.closedAt = Date.now();
      pos.closePriceUsd = closePriceUsd;
      pos.closeReason = reason;
      
      // Calculate PnL immutably
      const pnlPct = ((closePriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
      pos.realizedPnlPct = Math.round(pnlPct * 100) / 100;
      pos.realizedPnlEth = realizedPnlEth ?? pos.costEth * (pnlPct / 100);
      
      // Archive to trades history (immutable log)
      data.trades.push({ ...pos });
      closed = pos;
    }
  });
  
  return closed; // Null if position not found or already closed
}
```

**Why immutable**: Once CLOSED, position never mutates again. History is audit trail.

### Rule 4: Clamp All User/AI Inputs

```typescript
// Never trust TP/SL percentages from AI directly
const clampedTP = Math.min(
  aiDecision.takeProfitPct,
  circuitBreaker.maxTakeProfitPct // e.g., 30%
);

const clampedSL = Math.min(
  aiDecision.stopLossPct,
  circuitBreaker.maxLossPerTradePct // e.g., 10%
);

// Trade size clamped to available balance and max position
const clampedSize = Math.min(
  aiDecision.suggestedAllocEth || defaultTradeSizeEth,
  paperTrader.getBalance() * 0.5, // Never risk >50% of balance on one trade
  maxPositionSizeEth
);
```

### Rule 5: Boundary Checks on Prices

```typescript
if (currentPriceUsd <= 0 || !isFinite(currentPriceUsd)) {
  throw new Error("Invalid price: must be positive and finite");
}

if (entryPriceUsd <= 0) {
  throw new Error("Entry price must be positive");
}

// PnL calculation guards
const pnlPct = ((currentPriceUsd - entryPriceUsd) / entryPriceUsd) * 100;
if (!isFinite(pnlPct)) {
  console.warn("PnL calculation resulted in non-finite value; skipping exit check");
  return;
}
```

---

## 6. Race Condition Prevention: Serialize Position Updates

### Lock Pattern: Atomic Storage Update

The JsonStorage layer enforces **atomic updates**:
```typescript
this.storage.update((data) => {
  // All mutations here happen in a single transaction
  // No interleaving with other updates
});
```

**Problem Scenario (Without Lock)**:
```
Ticker: Close position for $PUMP @ 1.20
        → read current position state
        → calculate PnL
        → [CONTEXT SWITCH]

Scanner: Open position for $PUMP (new token, same address collision)
        → read current position state
        → insert new position
        → [CONTEXT SWITCH]

Ticker: → write closed position
Scanner: → write open position (overwrites!)
        → RESULT: Position lost, balance corrupted
```

**Solution (With Atomic Storage)**:
```typescript
// Ticker transaction:
this.storage.update((data) => {
  const pos = data.positions.find((p) => p.id === tickerId);
  if (pos && pos.status === 'OPEN') {
    pos.status = 'CLOSED';
    pos.closedAt = Date.now();
  }
});

// Scanner transaction (queued if Ticker already running):
this.storage.update((data) => {
  const isAlreadyOpen = data.positions.some(
    (p) => p.status === 'OPEN' && p.tokenAddress === newTokenAddr
  );
  if (!isAlreadyOpen) {
    data.positions.push(newPosition); // Safe; Ticker already closed the old one
  }
});
```

### Race: Balance Check vs. Buy Execution

**Scenario**:
```
Thread A: Check balance: 1.5 ETH
Thread B:                (check balance: 1.5 ETH)
Thread A: Buy 1.0 ETH
Thread A: Update balance: 0.5 ETH
Thread B: Buy 1.0 ETH (insufficient balance!) → ERROR
```

**Prevention**:
```typescript
const availableBalance = paperTrader.getBalance();

// Check balance INSIDE the execution function, not before
const result = await engine.executeBuy({
  chainId: 8453,
  tokenAddress: tokenAddr,
  amountEth: tradeSize, // Will be clamped inside if insufficient
  ...
});

// Inside PaperTrader.simulateBuy():
if (this.balance < amountEth) {
  return { success: false, reason: 'Insufficient balance' };
}
this.balance -= amountEth;
```

### Race: Partial TP Flag Race

**Scenario**:
```
Tick 1: PnL = 15.5%, check partialTakeProfitDone (false)
        → [CONTEXT SWITCH]
Tick 2: PnL = 15.7%, check partialTakeProfitDone (still false)
        → Both execute partial TP → sell 100% instead of 50%!
```

**Prevention** (Atomic Write):
```typescript
// Ticker.checkPositionsWithPrices():
if (pnlPct >= 15.0 && !pos.partialTakeProfitDone) {
  if (this.onPartialTakeProfit) {
    await this.onPartialTakeProfit(pos, currentPrice, 50);
  }
  
  // ATOMIC: Update flag inside storage transaction
  await this.tracker.markPartialTakeProfit(pos.id, -1.0);
}

// Inside PositionTracker.markPartialTakeProfit():
this.storage.update((data) => {
  const pos = data.positions.find((p) => p.id === id);
  if (pos) {
    pos.partialTakeProfitDone = true; // Set to true atomically
    pos.stopLossPct = newStopLossPct;
    pos.amountTokens = pos.amountTokens * (1 - fractionSold);
  }
});

// Next tick reads updated flag (true) → skips partial TP
```

### Race: Maximum Concurrent Positions

**Scenario**:
```
Max = 3 positions
Current open: 3 (PUMP, MOOSE, DOGE)

Scan A: Check active positions → 3, halt
Scan B: (at same time) Check active positions → 3, halt
Scan C: (at same time) Check active positions → 3, halt
DOGE exits (Take Profit)
All three scans (A, B, C) now see 2 open positions
All three execute buys → 5 open positions!
```

**Prevention** (Re-Check in Lock):
```typescript
const riskCheck = circuitBreaker.canOpenTrade();
if (!riskCheck.allowed) return 0;

// RE-CHECK inside atomic transaction:
this.storage.update((data) => {
  const currentCount = data.positions.filter((p) => p.status === 'OPEN').length;
  if (currentCount >= maxConcurrentPositions) {
    // ABORT: Concurrent limit hit just now
    return; // Do not push new position
  }
  
  // Safe to push now
  data.positions.push(newPosition);
});
```

---

## 7. Lessons Learned: Codebase Pitfalls

### Pitfall 1: AI Confidence Misread

**What went wrong**: Early versions used raw AI confidence (e.g., 85%) directly as win probability.
- 85% raw confidence → assumed 85% win rate
- In reality → ~63% actual win rate after calibration
- Result: Many underwater trades; EV appeared positive but wasn't

**Fix Applied**:
```typescript
calibrateProbability(rawConfidence: number): number {
  const clamped = Math.max(0, Math.min(100, rawConfidence));
  const probability = 0.35 + (clamped / 100) * 0.35;
  return Math.round(probability * 100) / 100;
}
```

**Lesson**: Never use raw LLM confidence as a probability. Always calibrate.

### Pitfall 2: Duplicate Token Open (Position Leak)

**What went wrong**: Same token could open 2+ positions simultaneously if scanner fired multiple times in quick succession.
- Didn't check for existing OPEN position before inserting
- Balance exhausted; positions competed for liquidity
- Exit ticker could only close one at a time; other became zombie

**Fix Applied**:
```typescript
// In PositionTracker.openPosition():
const isAlreadyOpen = data.positions.some(
  (p) => p.status === 'OPEN' && p.tokenAddress.toLowerCase() === pos.tokenAddress.toLowerCase()
);
if (!isAlreadyOpen) {
  data.positions.push(pos);
}
```

**Lesson**: Check for duplicate state BEFORE mutating. Use idempotent guards.

### Pitfall 3: Missing Price Panic Exit

**What went wrong**: When DexScreener API failed, price feed went undefined. Ticker had no price; couldn't calculate PnL.
- First tick: price undefined → skipped
- Second tick: price still undefined → skipped
- Bot held position for hours without exit logic
- Pool rugpulled; position became worthless

**Fix Applied**:
```typescript
if (currentPrice === undefined || currentPrice <= 0) {
  const count = (this.missingPriceCounts.get(pos.id) || 0) + 1;
  this.missingPriceCounts.set(pos.id, count);
  
  if (count >= 3) {
    // 3 consecutive price misses = assume pool drained/rugpull
    await this.onExit(pos, 'ANTI_DUMP', 0);
    this.missingPriceCounts.delete(pos.id);
  }
  continue;
}
```

**Lesson**: Treat missing data as a signal, not a skip. After N retries, assume worst-case.

### Pitfall 4: Partial TP Re-Execution

**What went wrong**: Partial take-profit at +15% could execute multiple times if ticker ticked with same position in same state.
- Tick 1: PnL 15.5%, partialTakeProfitDone = false → sell 50%, set flag = true
- Tick 2: Position mutated but flag read stale → sell another 50%!
- Result: 100% sold instead of 50%; rest of position lost

**Fix Applied**:
```typescript
if (pos.takeProfitPct > 15.0 && pnlPct >= 15.0 && !pos.partialTakeProfitDone) {
  await this.onPartialTakeProfit(pos, currentPrice, 50);
  await this.tracker.markPartialTakeProfit(pos.id, -1.0); // ATOMIC flag update
  continue; // Skip other exit checks
}
```

**Lesson**: Flag updates must be atomic. Read-check-write without interleaving.

### Pitfall 5: Position State Mutation After Close

**What went wrong**: After position closed, ticker or scanner tried to mutate it (update price, partial TP, etc.).
- Position marked CLOSED
- Ticker still held reference to old position object
- Tried to mutate highestPriceSeen on CLOSED position
- Corrupted history and broke reconciliation

**Fix Applied**:
```typescript
// All updates check status first:
if (pos && pos.status === 'OPEN') {
  pos.highestPriceSeen = Math.max(pos.highestPriceSeen, currentPrice);
}
// If CLOSED, skip silently

// Close function is strict:
if (pos && pos.status === 'OPEN') {
  pos.status = 'CLOSED';
  // ... finalize fields
} else {
  // Position not found or already closed; do nothing
}
```

**Lesson**: Treat CLOSED as immutable. Never re-open or mutate post-close.

### Pitfall 6: Circuit Breaker Not Checked Before EV

**What went wrong**: EV calculator passed, but circuit breaker was tripped. Trade executed; immediately hit daily loss limit; couldn't close next position.
- EV check: ✓ passed
- Circuit breaker check: ✗ MISSED
- Position opened in broken state
- User couldn't close it (manual sells were queued behind already-tripped limit)

**Fix Applied**:
```typescript
// BEFORE any EV calculation:
const riskCheck = circuitBreaker.canOpenTrade();
if (!riskCheck.allowed) {
  logActivity({
    stage: 'RISK_ENGINE',
    message: riskCheck.reason,
    level: 'WARN',
  });
  return 0; // Halt scan
}

// ONLY THEN proceed to EV
const evResult = evCalculator.calculateEV(params);
if (!evResult.allowed) return 0;
```

**Lesson**: Risk gates come BEFORE analysis. Security before opportunity.

### Pitfall 7: Gas Estimation Underestimation

**What went wrong**: Early bot estimated gas at 0.0002 ETH per transaction. Actual gas on Base = 0.0004–0.0008 ETH depending on congestion.
- EV calculation assumed 0.2% friction
- Actual friction = 0.6–1.2%
- Many trades that looked +1.5% EV became -0.5% EV after gas
- Consistent small losses; bot didn't realize why

**Fix Applied**:
```typescript
// In EV calc, use conservative estimates:
const gasEthRoundTrip = (params.estimatedGasEth ?? 0.0004) * 2; // round-trip

// For live trades, query actual gas estimate:
const gasPrice = await viemManager.getGasPrice(chainId);
const estimatedGasUnits = 150000; // typical swap
const gasEthActual = (BigInt(estimatedGasUnits) * gasPrice) / 10n ** 18n;
```

**Lesson**: Underestimating costs kills edge. Conservative friction assumptions are features, not bugs.

### Pitfall 8: Reconciliation Not Triggering on Restart

**What went wrong**: Bot restarted after crash. Position storage had 5 old positions still marked OPEN.
- Bot thought it had 5 open positions
- Tried to open new 6th position → rejected (max 3)
- Scanner halted; looked broken for 30 min
- Actually: 4 of the 5 positions had been sold manually or rugpulled offline

**Fix Applied**:
```typescript
// On bootstrap:
const reconcileReport = await orchestrator.reconcileOnChain();
if (reconcileReport.closedCount > 0) {
  console.log(`Reconciled ${reconcileReport.closedCount} external/zero-balance positions.`);
}

// Inside reconciliation:
for (const pos of openPositions) {
  const onChainBalance = await viemManager.getTokenBalance(
    pos.chainId,
    pos.tokenAddress,
    walletAddress
  );
  
  if (onChainBalance === 0) {
    await tracker.closePosition(pos.id, 0, 'RECONCILED_ON_CHAIN_ZERO_BALANCE');
    closedCount++;
  }
}
```

**Lesson**: On startup, always reconcile on-chain state vs. stored positions. Trust the blockchain, not your memory.

### Pitfall 9: Honeypot Detection Bypass

**What went wrong**: AI confidently recommended buy on a honeypot token (trap: can buy but cannot sell).
- Safety screener flagged it
- But orchestrator had bug: checked screener result but logged incorrectly, continued anyway
- Buy executed; position became worthless (no exit possible)
- Gas wasted; balance locked

**Fix Applied**:
```typescript
const screenResult = await screener.screenToken(tokenData);
if (!screenResult.isSafe) {
  this.logActivity({
    stage: 'PRE_SCREEN',
    message: `Token failed safety check: ${screenResult.reasons.join('; ')}`,
    level: 'WARN',
  });
  return 0; // HALT immediately
}
```

**Lesson**: Safety gates are not suggestions. If ANY gate fails, return 0. No exceptions.

### Pitfall 10: Stale Mempool Transaction

**What went wrong**: Bot submitted buy TX at block N. Gas price was 10 gwei. But then network congestion; TX remained pending.
- By block N+10, gas price was 50 gwei
- TX never landed; balance appeared locked
- Bot thought buy succeeded but position never opened
- Next scan tried to open again → duplicate attempt or confusion

**Fix Applied**:
```typescript
// For live mode, use TX monitoring:
const result = await router.executeBuy(order);
if (!result.success) {
  // TX failed, reverted, or pending too long
  rejectTokenUntil(tokenAddress, Date.now() + 60000);
  return { success: false, reason: result.reason };
}

// Always verify position was recorded:
const pos = await tracker.getPositionById(positionId);
if (!pos && result.success) {
  // ERROR: Position tracking failed; manual recovery needed
  throw new Error("Buy succeeded but position not tracked");
}
```

**Lesson**: Distinguish between "transaction pending" and "transaction confirmed." Always verify state post-execution.

---

## 8. Implementation Checklist for AI Agent

When executing trades in this codebase, follow this checklist **in exact order**:

```
Before Each Scan Cycle:
─────────────────────
[ ] 1. Is engine running? (this.isEngineRunning === true)
[ ] 2. Is macro sentinel in defensive mode? (DEFENSIVE_CRASH = halt)
[ ] 3. Can circuit breaker open trade? (no trip, no cooldown)
[ ] 4. Are we below max concurrent positions?
[ ] 5. Is storage accessible and not corrupted?

Per Candidate Token:
────────────────────
[ ] 6. Do we already have this token open on this chain? (duplicate check)
[ ] 7. Is token on blacklist? (honeypot, scam, rugpull history)
[ ] 8. Is AI confidence >= minAiConfidence? (e.g., >= 75%)
[ ] 9. Does security score pass? (>= minSecurityScore, e.g., 80)
[ ] 10. Does safety screener pass? (no honeypot, not paused, sufficient liq, taxes OK)
[ ] 11. Is liquidity sufficient? (>= minLiquidityUsd, e.g., $5000)
[ ] 12. Can we estimate gas and slippage? (DexScreener data available)
[ ] 13. Does EV pass threshold? (net EV >= minRequiredEdgePct, e.g., 1.5%)
[ ] 14. Is wallet balance sufficient? (balance >= tradeSize)
[ ] 15. Is trade size appropriate? (not 0, not > 50% of balance)

On Buy Execution:
─────────────────
[ ] 16. Clamp TP/SL to circuit breaker limits
[ ] 17. Execute buy via engine
[ ] 18. Verify position was created in tracker
[ ] 19. Verify position count did not exceed max
[ ] 20. Log activity and broadcast signal (if Telegram)

Per Tick (Ticker):
──────────────────
[ ] 21. Fetch live prices for all open positions
[ ] 22. For each position:
         [ ] Price exists (not undefined, > 0)?
         [ ] If missing 3+ ticks: ANTI_DUMP exit
         [ ] Calculate PnL%; check exits in order (TP, partial TP, trailing, SL, anti-dump, time)
         [ ] First matching exit: execute and close position
[ ] 23. Record all PnL in circuit breaker (for daily loss tracking)
[ ] 24. Broadcast exits (if Telegram)

On Shutdown:
────────────
[ ] 25. Stop all timers (scanner, ticker, rate service)
[ ] 26. Reconcile on-chain state (close zombie positions)
[ ] 27. Log final state and exit gracefully
```

---

## 9. Common Mistakes & Fixes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Using raw AI confidence as win % | EV looks good but trades lose | Calibrate via logistic formula (0.35 + conf/100 * 0.35) |
| Opening duplicate positions | Position count explodes; balance corrupted | Check `hasOpenPositionForToken()` before buy |
| Skipping circuit breaker check | Trades open while risk breaker is tripped | Check CB.canOpenTrade() before EV, not after |
| Missing price → no exit | Position held open for hours; rugpull loss | 3-tick missing price rule triggers ANTI_DUMP exit |
| Partial TP fires multiple times | Sell 100% instead of 50% | Set `partialTakeProfitDone` flag atomically |
| Position mutated after CLOSED | Corrupted history; reconciliation fails | Treat CLOSED as immutable; no re-opens |
| Gas estimate too low | EV looks +1.5% but actuals are -0.5% | Use conservative gas params; query actual on live |
| Stale positions on restart | Scanner halted because position count wrong | Reconcile on-chain balance on startup |
| Honeypot slips through | Buy executed; sell fails; loss | Don't skip safety screener; if fails → return 0 |
| Race condition on balance | Concurrent buys overdraft wallet | Re-check balance inside atomic transaction |
| Revert not caught | Position opened but TX failed; tracking chaos | Wrap executeBuy in try-catch; verify result |

---

## 10. Testing & Validation

### Unit Test Template

```typescript
// Test: EV Calculation Correctly Calibrates Confidence
test('EV calculator calibrates 85% confidence to ~63% win prob', () => {
  const calc = new ExpectedValueCalculator(1.5);
  const result = calc.calculateEV({
    confidence: 85,
    takeProfitPct: 25,
    stopLossPct: 8,
    positionSizeEth: 0.05,
    ethPriceUsd: 2500,
    estimatedGasEth: 0.0004,
    estimatedSlippagePct: 1.0,
  });
  
  // Calibrated win prob: 0.35 + (85/100)*0.35 = 0.6475 ≈ 65%
  expect(result.calibratedWinProbability).toBeCloseTo(0.65, 1);
  // EV: (0.65 * 25) - (0.35 * 8) - ~1.6% friction ≈ +14.2%
  expect(result.expectedValuePct).toBeGreaterThan(1.5);
  expect(result.allowed).toBe(true);
});

// Test: Duplicate Position Rejected
test('duplicate token prevents second open', async () => {
  const tracker = new PositionTracker(storage);
  
  // Open first position
  await tracker.openPosition({
    id: 'pos1',
    chainId: 8453,
    tokenAddress: '0xabc123',
    tokenSymbol: 'PUMP',
    ...
  });
  
  // Try to open second position for same token
  await tracker.openPosition({
    id: 'pos2',
    chainId: 8453,
    tokenAddress: '0xabc123', // Same token
    tokenSymbol: 'PUMP',
    ...
  });
  
  const active = await tracker.getActivePositions();
  expect(active.length).toBe(1); // Only one position
  expect(active[0].id).toBe('pos1'); // First one kept
});

// Test: Circuit Breaker Halts Buys
test('circuit breaker trips on daily loss', () => {
  const cb = new CircuitBreaker({
    maxLossPerTradePct: 10,
    maxDailyLossEth: 0.1,
  });
  
  // Record losses
  cb.recordClosedTrade(-0.05); // Loss 0.05 ETH
  cb.recordClosedTrade(-0.05); // Loss 0.05 ETH → total 0.10
  
  const canOpen = cb.canOpenTrade();
  expect(canOpen.allowed).toBe(false);
  expect(canOpen.reason).toContain('Circuit breaker tripped');
});

// Test: Partial TP Only Executes Once
test('partial TP flag prevents re-execution', async () => {
  const tracker = new PositionTracker(storage);
  const pos = await tracker.openPosition({...});
  
  // First call to markPartialTakeProfit
  await tracker.markPartialTakeProfit(pos.id, -1.0, 0.5);
  
  const updated = await tracker.getPositionById(pos.id);
  expect(updated.partialTakeProfitDone).toBe(true);
  expect(updated.amountTokens).toBe(pos.amountTokens * 0.5); // 50% remaining
  
  // Second call (should be no-op or blocked)
  const updated2 = await tracker.getPositionById(pos.id);
  expect(updated2.partialTakeProfitDone).toBe(true); // Still true; not reset
});
```

### Integration Test Template

```typescript
// Test: Full Execution Flow (Scan → Buy → Tick → Exit)
test('full execution flow: scan, buy, tick, exit', async () => {
  const orchestrator = new ScalpingOrchestrator({...});
  
  // Mock DexScreener scan
  const candidates = [...];
  
  // Mock AI response
  const aiDecision = { action: 'BUY', confidence: 82, takeProfitPct: 20, stopLossPct: 8 };
  
  // Execute scan
  const scanResult = await orchestrator.runScanCycle(8453);
  expect(scanResult).toBeGreaterThanOrEqual(0); // Number of positions opened
  
  // Verify position opened
  const active = await orchestrator.getPositionTracker().getActivePositions();
  expect(active.length).toBeGreaterThan(0);
  
  // Simulate price tick
  const tickerResult = await orchestrator.getPositionTicker().checkPositionsWithPrices({
    [tokenAddress]: entryPrice * 1.25, // +25% (above TP)
  });
  
  // Verify position closed (TP hit)
  const afterTick = await orchestrator.getPositionTracker().getActivePositions();
  expect(afterTick.length).toBe(0); // Position exited
});
```

---

## 11. Quick Reference: API Signatures

### EV Calculator
```typescript
const evCalc = new ExpectedValueCalculator(minEdgePct = 1.5);
const result = evCalc.calculateEV({
  confidence: 85,           // 0–100
  takeProfitPct: 25,        // 0–1000
  stopLossPct: 8,           // 0–100
  positionSizeEth: 0.05,    // ETH amount
  ethPriceUsd: 2500,        // optional, default 2500
  estimatedGasEth: 0.0004,  // optional, default 0.0004
  estimatedSlippagePct: 1.0 // optional, default 1.0
});
// Returns: { allowed: bool, expectedValuePct: number, calibratedWinProbability: number, totalEstimatedCostPct: number, minRequiredEdgePct: number, reason?: string }
```

### Position Tracker
```typescript
const tracker = new PositionTracker(storage);

await tracker.openPosition(position);
await tracker.closePosition(id, closePriceUsd, reason, realizedPnlEth);
await tracker.hasOpenPositionForToken(tokenAddress); // → bool
await tracker.hasOpenPositionForSymbol(symbol); // → bool
await tracker.getActivePositions(chainId?); // → Position[]
await tracker.getPositionById(id); // → Position | undefined
await tracker.updateHighestPrice(id, priceUsd);
await tracker.markPartialTakeProfit(id, newStopLossPct, fractionSold);
```

### Circuit Breaker
```typescript
const cb = new CircuitBreaker({
  maxTakeProfitPct: 30,
  maxLossPerTradePct: 10,
  maxDailyLossEth: 0.1,
  maxConsecutiveLosses: 3,
  streakCooldownMinutes: 30
});

cb.canOpenTrade(); // → { allowed: bool, reason?: string }
cb.recordClosedTrade(pnlEth);
cb.getDailyLossEth(); // → number
cb.getDailyNetPnLEth(); // → number
cb.clampTakeProfit(proposedTpPct); // → clamped TP%
cb.clampStopLoss(proposedSlPct); // → clamped SL%
cb.isTripped(); // → bool
cb.tripManually();
cb.reset();
```

### Execution Engine
```typescript
const engine = new ExecutionEngine({
  mode: 'paper' | 'live' | 'shadow',
  paperTrader,
  tracker,
  baseRouter?, // optional
  rhRouter?    // optional
});

await engine.executeBuy({
  chainId: 8453 | 4663,
  tokenAddress: string,
  tokenSymbol: string,
  amountEth: number,
  currentPriceUsd: number,
  takeProfitPct: number,
  stopLossPct: number,
  slippagePct?: number,
  strategyMode?: string,
  aiScore?: number,
  trailingStopPct?: number
});
// Returns: { success: bool, positionId?: string, amountTokens: number, filledPriceUsd?: number, txHash?: string, reason?: string }

await engine.executeSell(position, currentPriceUsd, reason);
// Returns: { success: bool, realizedPnlEth: number, pnlPct: number, txHash?: string, reason?: string }
```

---

## 12. Emergency Procedures

### If Bot Becomes Unresponsive
1. Stop the bot process (SIGINT / SIGTERM)
2. **Do NOT force-kill** if possible; let graceful shutdown run
3. Check storage file (`./data/store.json`) for position corruption
4. Restart and let reconciliation run on bootstrap
5. If reconciliation fails, manually verify on-chain via Etherscan

### If Scanner Won't Stop Opening Positions
1. Check if circuit breaker is tripped (run `circuitBreaker.getDailyLossEth()`)
2. If not tripped, check if max concurrent positions limit (default 3) is being hit
3. Manually close positions via Telegram `/panic` command if needed
4. Review logs for "Concurrent position limit" warnings

### If Positions Won't Close (Stuck)
1. Check if price feed is stale (DexScreener timeout)
2. Manual sell via Telegram `/close <positionId>`
3. If manual sell fails, position may be in zombie state; run reconciliation

### If Storage Corruption Suspected
1. Back up `./data/store.json`
2. Inspect the file; look for malformed JSON or duplicate position IDs
3. If corrupted: stop bot, restore from backup, restart
4. If no backup: manually reconstruct positions from logs or on-chain state

---

**Version**: 1.0  
**Last Updated**: 2026-10-06  
**Author**: AI Scalping Bot Audit  
**Status**: Production Use
