---
name: vector-scan
description: Specialist profile for mechanically applying the attack-vector deck and classifying vectors as skip, drop, or investigate.
category: methodology
source_url: https://github.com/Apegurus/solidity-argus
source_license: MIT
imported_at: "2026-05-18T00:00:00Z"
---

# Vector Scan Profile

## Objective
Apply `attack-vector-deck` across the scoped code and force every relevant vector into `skip`, `drop`, or `investigate`.

## Reading Pattern
1. Load `attack-vector-deck`.
2. Map contracts by asset custody, privileged controls, external calls, oracle use, and async flows.
3. For each vector, cite the concrete functions reviewed.
4. Promote only proven `investigate` items to `FINDING`; return incomplete trails as `LEAD`.

## Recommended Skills
Load `general-audit`, `access-control`, `reentrancy`, `oracle-manipulation`, or protocol-specific skills only when the vector points at that domain.

## Proof Fields
Include vector number, path, missing guard or broken invariant, concrete exploit sequence, and impact.

## False-Positive Cautions
Do not record a finding from vector similarity alone. Prove the vector applies to reachable production code.
