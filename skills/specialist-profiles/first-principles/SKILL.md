---
name: first-principles
description: Specialist profile for line-by-line assumption extraction without relying on named bug classes.
category: methodology
source_url: https://github.com/Apegurus/solidity-argus
source_license: MIT
imported_at: "2026-05-18T00:00:00Z"
---

# First Principles Profile

## Objective
Ignore vulnerability taxonomies at first. Extract what the code assumes must be true, then search for any caller, state, or dependency that makes an assumption false.

## Attack Surfaces
Any high-value, unfamiliar, or highly coupled code path; especially systems where named bug patterns do not fully describe the risk.

## Reading Pattern
1. For each critical function, list assumptions about caller, state, timing, external contracts, balances, prices, and previous calls.
2. For each assumption, ask who can falsify it and at what cost.
3. Build minimal violating sequences.
4. Only map the result back to a named bug class after proof exists.

## Recommended Skills
Load `audit-context-building`, `logic-errors`, `general-audit`, and `attack-vector-deck` when broad context is needed.

## Proof Fields
Include assumption, falsification path, code location, state transition, and impact.

## False-Positive Cautions
Do not record philosophical concerns. Convert assumptions into concrete reachable failures.
