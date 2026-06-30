---
name: level-finance
description: "Case study of the 2023 Level Finance exploit: referral code reentrancy draining ~$1.1M"
category: reference
source_url: "https://rekt.news/level-finance-rekt/"
source_license: "CC0"
imported_at: "2025-02-20T00:00:00Z"
---
<!-- Source: rekt.news (CC0) -->
<!-- Source: SunWeb3Sec/DeFiHackLabs (Reference) -->

# Level Finance (2023)

## Overview
In May 2023, Level Finance, a decentralized perpetual exchange on BNB Chain, was exploited for approximately $1.1 million. The attacker exploited a reentrancy vulnerability in the protocol's referral contract, specifically within the `claimMultiple` function, allowing them to claim referral rewards multiple times in a single transaction.

## Root Cause
The vulnerability was in the `LevelReferralController` contract. The `claimMultiple` function allowed users to claim rewards for multiple referral epochs. However, the function did not follow the Checks-Effects-Interactions pattern and lacked a reentrancy guard. The contract sent rewards to the user before updating the `isClaimed` status for the epoch, allowing the attacker to re-enter the function and claim the same rewards repeatedly.

## Attack Flow
1. Attacker created multiple referral accounts and generated referral rewards.
2. Attacker called the `claimMultiple` function with a list of epoch IDs.
3. The contract calculated the rewards and sent them to the attacker's malicious contract.
4. The attacker's fallback function triggered another call to `claimMultiple` with the same epoch IDs.
5. Because the `isClaimed` status was only updated after the loop finished, the second call (and subsequent recursive calls) succeeded.
6. Attacker drained approximately 214,000 LVL tokens and swapped them for 3,345 BNB.

## Impact
- **Loss**: ~$1.1M
- **Protocol**: Level Finance
- **Chain**: BNB Chain
- **Date**: 2023-05-01

## Key Transactions
- Attack tx: `0xe18396571315154179da08573f38039c50f8c46653302f9c449e10ba575606f5`

## Detection Heuristics
- Pattern 1: Reward claiming functions that iterate over a list and make external calls within the loop before updating the "claimed" status.
- Pattern 2: Lack of reentrancy guards on functions that handle token transfers or sensitive state updates.

## Remediation
- Fix 1: Implement a reentrancy guard (`nonReentrant` modifier) on the `claimMultiple` function.
- Fix 2: Use the Checks-Effects-Interactions pattern. Update the `isClaimed` status for each epoch *before* sending the rewards.

## References
- [rekt.news/level-finance-rekt/](https://rekt.news/level-finance-rekt/)
- [twitter.com/Level__Finance/status/1653035345610817536](https://twitter.com/Level__Finance/status/1653035345610817536)
