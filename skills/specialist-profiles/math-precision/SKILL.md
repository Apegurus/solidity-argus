---
name: math-precision
description: Specialist profile for rounding, scale, decimal, downcast, and arithmetic accounting edge cases.
category: methodology
source_url: https://github.com/Apegurus/solidity-argus
source_license: MIT
imported_at: "2026-05-18T00:00:00Z"
---

# Math Precision Profile

## Objective
Find arithmetic bugs that leak value, distort accounting, or break protocol invariants through rounding, scale mismatch, decimal mismatch, downcasts, and stale accumulators.

## Attack Surfaces
Share conversions, reward math, fee math, collateral factors, liquidation discounts, oracle scaling, vesting schedules, and accumulator updates.

## Reading Pattern
1. Write the unit/scale next to every value in each formula.
2. Identify every division and rounding direction.
3. Check whether the caller can repeat a favorable rounding path.
4. Compare internal accounting against actual token balances.

## Recommended Skills
Load `lack-of-precision`, `share-accounting-desynchronization`, `erc4626-exchange-rate-manipulation`, and `stateful-parameter-update-drift` when applicable.

## Proof Fields
Include concrete numbers, before/after balances, rounding direction, repeatability, and value impact.

## False-Positive Cautions
Dust-level loss is not a security finding unless repeatable, griefable, or able to accumulate into material loss.
