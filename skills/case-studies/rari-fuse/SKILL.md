---
name: rari-fuse
description: "Case study of the 2022 Rari Fuse exploit: reentrancy in Compound fork draining ~$80M"
category: reference
source_url: "https://rekt.news/rari-fuse-rekt/"
source_license: "CC0"
imported_at: "2025-02-20T00:00:00Z"
detection_rules:
  - regex: 'CEther|CToken'
    severity: "Medium"
    description: "Detects usage of Compound-style lending tokens. Forks must ensure reentrancy guards are applied to all sensitive functions."
---
<!-- Source: rekt.news (CC0) -->
<!-- Source: SunWeb3Sec/DeFiHackLabs (Reference) -->

# Rari Fuse (2022)

## Overview
In April 2022, several Rari Fuse lending pools were exploited for approximately $80 million. The attack targeted a reentrancy vulnerability in the protocol's `CEther` contract, which was a fork of Compound. The attacker was able to borrow assets against their collateral and then re-enter the contract to withdraw the collateral before the borrow was recorded.

## Root Cause
The vulnerability was a classic reentrancy bug in the `exitMarket` function of the `Comptroller` or the `redeem` function of the `CEther` contract. When a user withdrew ETH, the contract made an external call to the user's address before updating the internal state. Because Rari's fork of Compound did not have a reentrancy guard on these specific functions (or the guard was bypassed), the attacker could recursively call the contract to drain funds.

## Attack Flow
1. Attacker deposited collateral into a Rari Fuse pool.
2. Attacker initiated a withdrawal of their collateral (ETH).
3. The `CEther` contract sent ETH to the attacker's malicious contract via a low-level call.
4. The attacker's fallback function triggered a call to borrow other assets from the same pool.
5. Because the collateral withdrawal was not yet finalized in the state, the protocol still saw the attacker as having full collateral, allowing the borrow to succeed.
6. The attacker effectively withdrew their collateral AND borrowed assets against it, leaving the pool with bad debt.

## Impact
- **Loss**: ~$80M
- **Protocol**: Rari Capital (Fuse)
- **Chain**: Ethereum
- **Date**: 2022-04-30

## Key Transactions
- Attack tx: `0xab4860125185a341599c543974807217b3911714771725567b746761632a2939`

## Detection Heuristics
- Pattern 1: Compound forks that lack reentrancy guards on `redeem`, `borrow`, or `exitMarket` functions.
- Pattern 2: External calls (especially ETH transfers) made before state updates in lending protocols.

## Remediation
- Fix 1: Apply the `nonReentrant` modifier to all functions that involve external calls or state changes.
- Fix 2: Use the Checks-Effects-Interactions pattern to ensure state is updated before any external interaction.

## References
- [rekt.news/rari-fuse-rekt/](https://rekt.news/rari-fuse-rekt/)
- [twitter.com/BlockSecTeam/status/1520351351111651328](https://twitter.com/BlockSecTeam/status/1520351351111651328)
