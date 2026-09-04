---
name: beanstalk-governance
description: "Case study of the 2022 Beanstalk exploit: flash loan + governance manipulation draining ~$182M"
category: reference
source_url: "https://rekt.news/beanstalk-rekt/"
source_license: "CC0"
imported_at: "2025-02-20T00:00:00Z"
---
<!-- Source: rekt.news (CC0) -->
<!-- Source: SunWeb3Sec/DeFiHackLabs (Reference) -->

# Beanstalk Governance (2022)

## Overview
In April 2022, Beanstalk Farms, a decentralized credit-based stablecoin protocol, was exploited for approximately $182 million. The attacker used a flash loan to acquire a massive amount of the protocol's governance token (Stalk), allowing them to pass a malicious governance proposal and drain the protocol's reserves.

## Root Cause
The vulnerability was in the protocol's governance mechanism, which allowed users to gain voting power (Stalk) by depositing assets into the "Silo". Crucially, the protocol did not prevent users from using flash-loaned assets to gain this voting power and immediately vote on proposals. The attacker used this to reach the 67% supermajority required to execute a "BIP" (Beanstalk Improvement Proposal) instantly.

## Attack Flow
1. Attacker took a massive flash loan from Aave, Uniswap, and SushiSwap (including ~350M DAI, 500M USDC, 150M USDT, 32M BEAN, and 11M LUSD).
2. Attacker deposited these assets into the Beanstalk Silo to gain a huge amount of Stalk (voting power).
3. Attacker had already submitted two malicious proposals (BIP-18 and BIP-19) one day prior.
4. With the flash-loaned Stalk, the attacker voted in favor of their own proposals, reaching the 67% threshold.
5. The proposals were executed immediately, sending all assets in the Beanstalk Silo to the attacker's address.
6. Attacker repaid the flash loans and kept the remaining assets (mostly ETH and stablecoins).

## Impact
- **Loss**: ~$182M
- **Protocol**: Beanstalk Farms
- **Chain**: Ethereum
- **Date**: 2022-04-17

## Key Transactions
- Attack tx: `0xcd314c6351513518c37cba34ba8225939f8f5787a0a0d958999cc468992275d6`

## Detection Heuristics
- Pattern 1: Governance systems where voting power can be acquired and used within the same transaction (vulnerable to flash loans).
- Pattern 2: Lack of a delay between proposal submission, voting, and execution.

## Remediation
- Fix 1: Implement a "snapshot" mechanism for voting power, where power is determined by balances at a previous block.
- Fix 2: Introduce a mandatory delay (e.g., 2-3 days) between proposal submission and the start of voting, and another delay before execution.
- Fix 3: Prevent flash-loaned assets from being used to gain governance rights (e.g., by checking if the balance was acquired in the same block).

## References
- [rekt.news/beanstalk-rekt/](https://rekt.news/beanstalk-rekt/)
- [bean.money/blog/2022-04-18-post-mortem-of-the-beanstalk-exploit](https://bean.money/blog/2022-04-18-post-mortem-of-the-beanstalk-exploit)
