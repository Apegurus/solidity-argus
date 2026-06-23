---
name: dao-hack
description: "Case study of the 2016 DAO hack: reentrancy exploit draining ~$60M"
category: reference
source_url: "https://rekt.news/dao-rekt/"
source_license: "CC0"
imported_at: "2025-02-20T00:00:00Z"
---
<!-- Source: rekt.news (CC0) -->
<!-- Source: SunWeb3Sec/DeFiHackLabs (Reference) -->

# DAO Hack (2016)

## Overview
The DAO was a decentralized autonomous organization launched in 2016 on the Ethereum blockchain. It was designed to operate as a venture capital fund for the crypto space. In June 2016, an attacker exploited a reentrancy vulnerability in the DAO's smart contract, draining approximately 3.6 million ETH, worth about $60 million at the time.

## Root Cause
The vulnerability was a classic reentrancy bug. The `splitDAO` function allowed a member to withdraw their ETH and receive "Child DAO" tokens. The contract sent ETH to the user using a low-level `.call()` before updating the user's balance. This allowed the attacker to recursively call the `splitDAO` function from their malicious contract's fallback function before the first call finished, effectively draining the contract.

## Attack Flow
1. The attacker created a malicious contract and funded it with DAO tokens.
2. The attacker called the `splitDAO` function.
3. The DAO contract sent ETH to the attacker's contract via a low-level call.
4. The attacker's fallback function triggered another call to `splitDAO`.
5. Steps 3 and 4 repeated recursively until the gas limit was reached or the contract was drained.
6. The state update (reducing the attacker's balance) only happened after the recursive calls finished, which was too late.

## Impact
- **Loss**: ~$60M (3.6M ETH)
- **Protocol**: The DAO
- **Chain**: Ethereum
- **Date**: 2016-06-17

## Key Transactions
- Attack tx: `0x0eb3f4d006903f621f048358878b2ad9046f00d28e5540fa24644433252170e4`

## Detection Heuristics
- Pattern 1: Low-level `.call()` used for ETH transfers without a reentrancy guard.
- Pattern 2: State variables (like balances) updated after an external call.

## Remediation
- Fix 1: Use the Checks-Effects-Interactions pattern. Update state before making external calls.
- Fix 2: Implement a reentrancy guard (e.g., OpenZeppelin's `ReentrancyGuard`).

## References
- [rekt.news/dao-rekt/](https://rekt.news/dao-rekt/)
- [blog.slock.it/the-history-of-the-dao-628d50257c3d](https://blog.slock.it/the-history-of-the-dao-628d50257c3d)
