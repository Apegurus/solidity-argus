---
name: execution-trace
description: Specialist profile for stale reads, parameter divergence, branch ordering, callbacks, and cross-transaction interleavings.
category: methodology
source_url: https://github.com/Apegurus/solidity-argus
source_license: MIT
imported_at: "2026-05-18T00:00:00Z"
---

# Execution Trace Profile

## Objective
Find bugs that appear only when execution order, callbacks, stale reads, queued requests, or multi-transaction interleavings are traced precisely.

## Attack Surfaces
External calls, token hooks, receiver callbacks, routers, queues, delayed settlement, permit/signature flows, and multi-step lifecycle functions.

## Reading Pattern
1. Trace each critical function as ordered reads, checks, effects, and interactions.
2. Mark every value read before an external call and used after it.
3. Identify stored request parameters and mutable globals used during later fulfillment.
4. Consider same-block and cross-transaction ordering attacks.

## Recommended Skills
Load `reentrancy`, `front-running-attacks`, `dos-revert`, `missing-protection-signature-replay`, and `unbounded-return-data` when relevant.

## Proof Fields
Include ordered trace, stale/divergent value, attacker-controlled step, and state/asset impact.

## False-Positive Cautions
Callbacks are not vulnerabilities by themselves; show the callback can observe or mutate shared state in a harmful way.
