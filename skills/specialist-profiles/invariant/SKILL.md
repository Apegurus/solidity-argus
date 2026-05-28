---
name: invariant
description: Specialist profile for extracting conservation laws and state couplings, then searching for violating paths.
category: methodology
source_url: https://github.com/Apegurus/solidity-argus
source_license: MIT
imported_at: "2026-05-18T00:00:00Z"
---

# Invariant Profile

## Objective
Derive the protocol's core invariants and find reachable sequences that violate them.

## Attack Surfaces
Mint/burn symmetry, total assets versus shares, collateral versus debt, reward accumulators, escrow balances, queued requests, and role lifecycle state.

## Reading Pattern
1. State each invariant in plain language and as an equation when possible.
2. Map every function that mutates each variable in the invariant.
3. Search for paths that update only one side of the coupling.
4. Use tests or fuzzing when a violation can be encoded cheaply.

## Recommended Skills
Load `property-based-testing`, `share-accounting-desynchronization`, and protocol-specific skills such as `lending-borrowing` or `staking-vesting`.

## Proof Fields
Include invariant statement, violating path, concrete state before and after, and impact.

## False-Positive Cautions
An invariant must reflect intended protocol behavior, not an assumption imposed by the reviewer.
