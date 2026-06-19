---
name: concentrated-liquidity
description: "Concentrated-liquidity managers (UniV3 ALMs) and Uniswap V4 hooks are exploited through sandwichable owner/rebalance functions, missing TWAP calm-period checks, stale approvals, and hook permission/delta/settlement bugs."
category: protocol-pattern
source_url: "https://dacian.me/concentrated-liquidity-manager-vulnerabilities"
imported_at: "2026-06-19T00:00:00Z"
detection_rules:
  - regex: '(rebalance|reposition|compound|rerange|tend)\s*\('
    severity: High
    confidence: Low
    description: "CLM rebalance/reposition — if it mints/swaps at spot without a TWAP calm-period check it is sandwichable by MEV"
  - regex: '\bslot0\s*\(\s*\)'
    severity: High
    confidence: Medium
    description: "slot0() spot price/tick read — manipulable in-block; CLM/position logic must use a TWAP, not slot0"
  - regex: '(beforeSwap|afterSwap|beforeAddLiquidity|afterAddLiquidity|beforeRemoveLiquidity)\s*\('
    severity: Medium
    confidence: Low
    description: "Uniswap V4 hook callback — verify onlyPoolManager gating, delta accounting, and pool isolation"
  - regex: '(BeforeSwapDelta|toBeforeSwapDelta|lpFeeOverride|LPFeeLibrary)'
    severity: High
    confidence: Medium
    description: "V4 hook delta/fee override — wrong sign/direction or unbounded fee override can drain swappers or the pool"
  - regex: '(unlockCallback|lockAcquired)\s*\('
    severity: High
    confidence: Medium
    description: "V4 unlock callback — must authenticate the PoolManager caller; an unauthenticated callback can forge settlement"
  - regex: '(safeApprove|approve)\s*\([^)]*type\s*\(\s*uint256\s*\)\s*\.\s*max'
    severity: Medium
    confidence: Low
    description: "Standing max router approval in a CLM — stale approval becomes a drain surface if the router is compromised"
---
<!-- Source: Dacian — Concentrated Liquidity Manager Vulnerabilities (cited) -->
<!-- Source: Hacken / OpenZeppelin — Uniswap V4 hooks security (cited) -->

# Concentrated Liquidity & Uniswap V4 Hooks

## Overview

Concentrated-liquidity managers (CLMs / automated liquidity managers built on Uniswap V3 — Gamma, Arrakis, vault wrappers) and the new Uniswap V4 **hook** model add a class of bugs that generic AMM review misses. The recurring theme is that **privileged or callback functions touch live pool state** (price, ticks, deltas) and can be manipulated within a block, or that hook accounting (`BeforeSwapDelta`, settlement) is subtly wrong. Distilled from Dacian's CLM research and the Hacken/OpenZeppelin V4-hooks guides.

---

## Part 1 — Concentrated Liquidity Managers (UniV3 ALMs)

### 1. Sandwichable owner/rebalance functions (Critical)

The flagship CLM bug: `rebalance()` / `reposition()` / `compound()` mints or swaps liquidity at the **current spot price/tick**. An MEV bot sandwiches the rebalance — moving the price before and after — so the manager deposits at a manipulated ratio and the vault realizes a loss. The fix is a **TWAP calm-period check**: revert if `|spotTick − twapTick|` exceeds a bound before repositioning.

```solidity
// VULNERABLE: rebalance trusts slot0 spot
(, int24 tick,,,,,) = pool.slot0();
_mintLiquidity(tick, ...); // sandwichable

// SAFE: require spot close to TWAP
int24 twapTick = _consultTwap(twapInterval);
require(_absDiff(tick, twapTick) <= maxTickDeviation, "price not calm");
```

### 2. Ineffective TWAP parameters (High)

A `twapInterval` of a few seconds, or reading `slot0` "TWAP", provides no protection. The window must be long enough to make multi-block manipulation uneconomical for the pool's liquidity.

### 3. Stale router approvals (Medium)

CLMs that `approve(router, max)` once leave a standing drain surface if the router is upgraded/compromised.

### 4. Retrospective fee changes, dust, zero-withdraw burns (Medium/Low)

- A fee parameter applied retroactively to already-accrued fees mis-attributes value.
- Rounding leaves **stuck dust** in positions; zero-amount withdrawals can burn shares for nothing.
- `sqrtPriceX96` math can overflow at extreme ticks.

---

## Part 2 — Uniswap V4 hooks

### 5. Hook permission bits / mined addresses (High)

V4 encodes which callbacks a hook implements in the **hook address bits**. A hook deployed to the wrong address (or a malicious hook mined to a permissioned address) can have unexpected callbacks invoked. Verify the address-encoded permissions match the implemented functions.

### 6. `BeforeSwapDelta` sign & direction (Critical)

Hook return deltas use a packed signed type. Getting the **sign or specified/unspecified direction** wrong lets a hook hand value to the swapper or extract it from the pool. Review all four swap modes (exact-in/out × zeroForOne).

### 7. Settlement (`settle`/`take`/`sync`) (High)

Hooks and routers must conserve the PoolManager's flash-accounting: every `take` must be matched by `settle`. Missing/early settlement, or custody held async by the hook, can break pool solvency.

### 8. `onlyPoolManager` / unlock-callback auth (High)

Hook callbacks and `unlockCallback` must reject callers other than the PoolManager. An unauthenticated callback lets an attacker forge swap/settlement context.

### 9. Pool isolation & `lpFeeOverride` (Medium/High)

A hook serving multiple pools must isolate per-`PoolKey` state. A dynamic `lpFeeOverride` must be bounded — an unbounded fee can grief swappers; a JIT fee-accounting mistake can misallocate fees.

---

## Detection Heuristics

- Every CLM mint/rebalance: is there a **TWAP calm-period** check, with a real window?
- Any `slot0()` used for value decisions → flag (use TWAP).
- V4 hooks: confirm address-bit permissions, delta sign/direction across all swap modes, balanced `settle`/`take`, `onlyPoolManager` gating, per-pool isolation, and bounded fee overrides.

## Remediation

Gate all CLM liquidity moves behind a TWAP deviation check with a sufficient window; never make value decisions from `slot0`. Pull exact approvals per action. For V4 hooks: validate address-encoded permissions, prove delta signs for every swap mode with tests, conserve flash accounting (`settle`/`take`), authenticate every callback to the PoolManager, isolate per-`PoolKey` state, and bound any dynamic fee.

## References

- [Dacian — Concentrated Liquidity Manager Vulnerabilities](https://dacian.me/concentrated-liquidity-manager-vulnerabilities)
- [Uniswap V4 — hooks documentation](https://docs.uniswap.org/contracts/v4/concepts/hooks)
- [OpenZeppelin — Uniswap V4 hooks security](https://blog.openzeppelin.com/)
