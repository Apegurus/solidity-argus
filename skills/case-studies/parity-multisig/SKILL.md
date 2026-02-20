---
name: parity-multisig
description: "Case study of the 2017 Parity Multisig Freeze: delegatecall + self-destruct exploit freezing ~$150M"
category: reference
source_url: "https://rekt.news/parity-rekt/"
source_license: "CC0"
imported_at: "2025-02-20T00:00:00Z"
detection_rules:
  - regex: 'delegatecall\(.*\)'
    severity: "High"
    description: "Detects use of delegatecall, which can be dangerous if the target contract is not trusted or can be modified."
  - regex: 'selfdestruct\(.*\)'
    severity: "High"
    description: "Detects use of selfdestruct, which can be used to destroy a contract and freeze funds if not properly protected."
---
<!-- Source: rekt.news (CC0) -->
<!-- Source: SunWeb3Sec/DeFiHackLabs (Reference) -->

# Parity Multisig Freeze (2017)

## Overview
In November 2017, a user accidentally triggered a vulnerability in the Parity Multisig wallet library contract. By calling an uninitialized `initWallet` function, the user became the owner of the library contract and subsequently called `kill()`, which executed `selfdestruct`. This froze approximately 513,000 ETH (worth ~$150M at the time) across 587 wallets that depended on this library.

## Root Cause
The Parity Multisig wallets used `delegatecall` to execute logic from a shared library contract. However, the library contract itself was not initialized. This allowed any user to call the `initWallet` function on the library contract directly, making them the owner of the library. Once they were the owner, they could call the `kill` function, which contained a `selfdestruct` instruction.

## Attack Flow
1. A user (devops199) found the uninitialized library contract.
2. The user called `initWallet()` on the library contract, becoming its owner.
3. The user then called `kill()` on the library contract.
4. The library contract executed `selfdestruct`, removing its code from the blockchain.
5. All multisig wallets that used `delegatecall` to this library now had no logic to execute, effectively freezing all funds held in them.

## Impact
- **Loss**: ~$150M (513k ETH)
- **Protocol**: Parity Multisig
- **Chain**: Ethereum
- **Date**: 2017-11-06

## Key Transactions
- Initialization tx: `0x05f5c113c130f928d4d0d261046c5511846909b77060ef6568bf9158ad312a06`
- Kill tx: `0x47f7cff3ad8733831a0e273108ef239bb0d0657da3a4279b1d17ac2616a12487`

## Detection Heuristics
- Pattern 1: Uninitialized library contracts that contain sensitive functions like `selfdestruct` or `init`.
- Pattern 2: Use of `delegatecall` to a contract that can be destroyed or modified by unauthorized users.

## Remediation
- Fix 1: Initialize library contracts during deployment or use a constructor to disable initialization functions.
- Fix 2: Avoid using `selfdestruct` in library contracts.
- Fix 3: Use static libraries or ensure the target of `delegatecall` is immutable and properly initialized.

## References
- [rekt.news/parity-rekt/](https://rekt.news/parity-rekt/)
- [paritytech.io/blog/security-alert-heavy-update/](https://www.parity.io/blog/security-alert-heavy-update/)
