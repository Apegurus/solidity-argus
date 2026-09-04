---
name: euler-finance
description: "Case study of the 2023 Euler Finance exploit: donation attack draining ~$197M"
category: reference
source_url: "https://rekt.news/euler-rekt/"
source_license: "CC0"
imported_at: "2025-02-20T00:00:00Z"
---
<!-- Source: rekt.news (CC0) -->
<!-- Source: SunWeb3Sec/DeFiHackLabs (Reference) -->

# Euler Finance (2023)

## Overview
In March 2023, Euler Finance, a non-custodial lending protocol, was exploited for approximately $197 million. The attacker used a "donation attack" where they intentionally made their own position underwater by donating funds to the protocol's reserves, allowing them to liquidate themselves and profit from the protocol's bad debt handling.

## Root Cause
The vulnerability was in the `donateToReserves` function of the EToken contract. This function allowed a user to donate their EToken balance to the protocol's reserves. However, it did not check if the donation would make the user's position insolvent. By donating a large amount of collateral while having a large debt, the attacker could make their position underwater and then use a separate account to liquidate the position at a massive discount.

## Attack Flow
1. Attacker took a flash loan of 30M DAI from Aave.
2. Attacker deposited 20M DAI into Euler to receive eDAI.
3. Attacker leveraged their position by minting 200M dDAI (debt) and 195M eDAI (collateral).
4. Attacker called `donateToReserves` with 100M eDAI. This reduced their collateral but kept their debt the same, making the position heavily underwater.
5. Attacker used a second account to liquidate the first account. Due to the way Euler's liquidation worked, the liquidator received the remaining eDAI at a massive discount, while the protocol was left with bad debt.
6. Attacker repeated this for other assets (wBTC, wETH, stETH).
7. Attacker repaid the flash loan and kept the profit.

## Impact
- **Loss**: ~$197M
- **Protocol**: Euler Finance
- **Chain**: Ethereum
- **Date**: 2023-03-13

## Key Transactions
- Attack tx (DAI): `0xc310a0affe2169d1f6feec1c63dbc7f7c62a88bf44e7906e2bc6445e10086615`

## Detection Heuristics
- Pattern 1: Functions that allow users to reduce their collateral (e.g., via donation or transfer) without checking their health factor or solvency.
- Pattern 2: Liquidation logic that doesn't properly account for "donated" or "burned" collateral.

## Remediation
- Fix 1: Add a health factor check to the `donateToReserves` function to ensure the user remains solvent after the donation.
- Fix 2: Implement stricter checks on liquidation bonuses and ensure that the protocol's reserves are not used to subsidize malicious liquidations.

## References
- [rekt.news/euler-rekt/](https://rekt.news/euler-rekt/)
- [euler.finance/blog/euler-vault-kit-post-mortem](https://www.euler.finance/blog/euler-vault-kit-post-mortem)
