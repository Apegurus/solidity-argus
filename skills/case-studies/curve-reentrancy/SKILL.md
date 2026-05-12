---
name: curve-reentrancy
description: "Case study of the 2023 Curve reentrancy exploit: Vyper compiler bug draining ~$70M"
category: reference
source_url: "https://rekt.news/curve-lp-rekt-vyper-reentrancy/"
source_license: "CC0"
imported_at: "2025-02-20T00:00:00Z"
detection_rules:
  - regex: '@nonreentrant'
    severity: "High"
    description: "Detects Vyper's nonreentrant decorator. In certain compiler versions (0.2.15, 0.2.16, 0.3.0), this was broken for cross-function reentrancy."
---
<!-- Source: rekt.news (CC0) -->
<!-- Source: SunWeb3Sec/DeFiHackLabs (Reference) -->

# Curve Reentrancy (2023)

## Overview
In July 2023, several Curve Finance liquidity pools (alETH, msETH, pETH) were exploited for approximately $70 million. Unlike most reentrancy attacks caused by developer error, this was caused by a bug in the Vyper compiler (versions 0.2.15, 0.2.16, and 0.3.0) that failed to properly implement reentrancy guards.

## Root Cause
The vulnerability was a compiler-level bug in Vyper's `@nonreentrant` decorator. In the affected versions, the compiler used the same storage slot for reentrancy locks across different functions if they were in the same "reentrancy group", but it failed to correctly handle the lock state in certain scenarios involving cross-function calls. This allowed an attacker to re-enter a contract through a different function even if both were marked `@nonreentrant`.

## Attack Flow
1. Attacker identified Curve pools using vulnerable Vyper versions (specifically those with `add_liquidity` and `remove_liquidity` functions).
2. Attacker called `add_liquidity` to deposit assets.
3. During the execution of `add_liquidity`, the contract made an external call (e.g., to a token's `transfer` or `fallback` function).
4. The attacker's malicious contract re-entered the Curve pool by calling `remove_liquidity`.
5. Because the reentrancy guard was broken at the compiler level, the second call was allowed to proceed before the first call's state updates (like updating the pool's total supply) were finalized.
6. This allowed the attacker to withdraw more assets than they were entitled to.

## Impact
- **Loss**: ~$70M
- **Protocol**: Curve Finance
- **Chain**: Ethereum
- **Date**: 2023-07-30

## Key Transactions
- Attack tx (pETH pool): `0xa84aa0650c3e6f849339384388e1a769a540003ade07ba379c2d3efc4fb7ca7d`

## Detection Heuristics
- Pattern 1: Use of Vyper compiler versions 0.2.15, 0.2.16, or 0.3.0.
- Pattern 2: Contracts with multiple functions using the same reentrancy lock key.

## Remediation
- Fix 1: Upgrade to a patched version of the Vyper compiler (0.3.1 or later).
- Fix 2: Manually implement reentrancy guards using storage variables if the compiler version cannot be changed.
- Fix 3: Conduct thorough audits that include checking the underlying compiler and infrastructure vulnerabilities.

## References
- [rekt.news/curve-lp-rekt-vyper-reentrancy/](https://rekt.news/curve-lp-rekt-vyper-reentrancy/)
- [hackmd.io/@vyperlang/H1No9_h_h](https://hackmd.io/@vyperlang/H1No9_h_h)
