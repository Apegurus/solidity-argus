---
name: nomad-bridge
description: "Case study of the 2022 Nomad Bridge exploit: initialization bug draining ~$190M"
category: reference
source_url: "https://rekt.news/nomad-rekt/"
source_license: "CC0"
imported_at: "2025-02-20T00:00:00Z"
detection_rules:
  - regex: '0x0000000000000000000000000000000000000000000000000000000000000000'
    severity: "High"
    description: "Detects usage of the zero hash as a trusted value, which can be dangerous if it's the default state of an uninitialized mapping."
---
<!-- Source: rekt.news (CC0) -->
<!-- Source: SunWeb3Sec/DeFiHackLabs (Reference) -->

# Nomad Bridge (2022)

## Overview
In August 2022, the Nomad bridge was drained of approximately $190 million in a "decentralized robbery." A routine upgrade accidentally initialized the bridge's trusted root to a zero hash (`0x00`), allowing anyone to bypass message verification by providing a message that hashed to a value already present in the uninitialized mapping.

## Root Cause
The vulnerability was introduced during a contract upgrade. The `Replica` contract's `confirmAt` mapping was intended to store the time at which a message root was confirmed. The upgrade set the default "trusted" root to `0x00`. Because uninitialized storage in Solidity is `0`, any message with a root of `0x00` was automatically considered "confirmed" by the contract. This allowed users to submit withdrawal messages with arbitrary data that would be executed without valid signatures.

## Attack Flow
1. Attacker noticed that the `Replica` contract accepted messages with a root of `0x00`.
2. Attacker crafted a message to withdraw funds from the bridge.
3. Attacker submitted the message to the `process` function.
4. The contract checked if the message's root was confirmed. Since the root was `0x00` and the mapping returned `0` (or a value that passed the check), the message was processed.
5. Once the first attack was public, hundreds of other users (copycats) simply copied the transaction data, changed the recipient address, and drained the remaining funds.

## Impact
- **Loss**: ~$190M
- **Protocol**: Nomad Bridge
- **Chain**: Ethereum / Moonbeam / Evmos / etc.
- **Date**: 2022-08-01

## Key Transactions
- First Attack tx: `0xa5ce309047a92177ad43c03f1f13a87339e38c89509cf5564d79775c4456cf92`

## Detection Heuristics
- Pattern 1: Trusting a zero value (`0x00` or `0`) in a mapping that is also the default state for uninitialized entries.
- Pattern 2: Lack of explicit checks to ensure that a root or hash is not the zero value before processing sensitive operations.

## Remediation
- Fix 1: Explicitly initialize trusted roots to a non-zero value or use a separate boolean mapping to track confirmation.
- Fix 2: Add a `require(root != bytes32(0))` check in the message verification logic.
- Fix 3: Implement more rigorous testing for contract upgrades, specifically checking the state of critical storage variables.

## References
- [rekt.news/nomad-rekt/](https://rekt.news/nomad-rekt/)
- [medium.com/nomad-xyz-blog/nomad-bridge-hack-post-mortem-e6f630cf3b7f](https://medium.com/nomad-xyz-blog/nomad-bridge-hack-post-mortem-e6f630cf3b7f)
