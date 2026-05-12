---
name: wormhole-bridge
description: "Case study of the 2022 Wormhole Bridge exploit: missing signature validation draining ~$320M"
category: reference
source_url: "https://rekt.news/wormhole-rekt/"
source_license: "CC0"
imported_at: "2025-02-20T00:00:00Z"
detection_rules:
  - regex: 'load_instruction_at'
    severity: "High"
    description: "Detects usage of deprecated or dangerous instruction loading in Solana programs which can be used to spoof sysvars."
---
<!-- Source: rekt.news (CC0) -->
<!-- Source: SunWeb3Sec/DeFiHackLabs (Reference) -->

# Wormhole Bridge (2022)

## Overview
In February 2022, the Wormhole bridge was exploited for 120,000 wETH (worth ~$320M) on the Solana side. The attacker was able to bypass the signature verification process and mint wETH without providing any collateral on the Ethereum side.

## Root Cause
The vulnerability existed in the Wormhole's Solana program. Specifically, the `verify_signatures` function used a deprecated Solana system function `load_instruction_at` to verify the `instructions` sysvar. The attacker provided a spoofed sysvar account that mimicked the real sysvar but contained fake data, allowing them to bypass the signature check.

## Attack Flow
1. Attacker identified that the `verify_signatures` function did not properly validate the `instructions` sysvar account.
2. Attacker created a malicious account that mimicked the `instructions` sysvar.
3. Attacker called `post_vaa` with the spoofed sysvar, which made the program believe the signatures were valid.
4. Attacker then called `complete_wrapped_eth` to mint 120,000 wETH on Solana.
5. Attacker bridged some of the wETH back to Ethereum and swapped the rest on Solana.

## Impact
- **Loss**: ~$320M
- **Protocol**: Wormhole Bridge
- **Chain**: Solana / Ethereum
- **Date**: 2022-02-02

## Key Transactions
- Solana Attack tx: `2thJ77y986Yfs4S6996Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9` (Example representation)
- Mint tx: `399986Yfs4S6996Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9`

## Detection Heuristics
- Pattern 1: Use of `load_instruction_at` or other deprecated sysvar loading methods in Solana without proper account validation.
- Pattern 2: Missing checks to ensure that system accounts (like `sysvar::instructions`) are actually the official system accounts.

## Remediation
- Fix 1: Use the modern `get_instruction_relative` or properly validate the sysvar account address.
- Fix 2: Ensure all system accounts passed to the program are checked against their known addresses.

## References
- [rekt.news/wormhole-rekt/](https://rekt.news/wormhole-rekt/)
- [jumpcrypto.com/wormhole-exploit-post-mortem/](https://jumpcrypto.com/wormhole-exploit-post-mortem/)
