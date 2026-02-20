---
name: harvest-finance
description: "Case study of the 2020 Harvest Finance exploit: flash loan + price manipulation draining ~$34M"
category: reference
source_url: "https://rekt.news/harvest-finance-rekt/"
source_license: "CC0"
imported_at: "2025-02-20T00:00:00Z"
detection_rules:
  - regex: 'getPricePerFullShare'
    severity: "Medium"
    description: "Detects usage of share price functions which can be manipulated by large trades in underlying pools."
---
<!-- Source: rekt.news (CC0) -->
<!-- Source: SunWeb3Sec/DeFiHackLabs (Reference) -->

# Harvest Finance (2020)

## Overview
In October 2020, Harvest Finance was exploited for approximately $34 million. The attacker used flash loans to manipulate the price of stablecoins (USDC and USDT) within Curve Finance pools, which Harvest used to calculate the value of its vault shares.

## Root Cause
Harvest Finance vaults calculated the value of their shares based on the "virtual price" of assets in Curve pools. By using a flash loan to execute a massive swap in a Curve pool, the attacker could temporarily depress the price of an asset. They then deposited that asset into Harvest at the depressed price, swapped back in Curve to restore the price, and withdrew from Harvest at the higher price.

## Attack Flow
1. Attacker took a flash loan of 50M USDC and 17.3M USDT from Uniswap V2.
2. Attacker swapped 11.4M USDC for USDT on Curve's Y pool, pushing down the USDC price.
3. Attacker deposited 60.6M USDC into the Harvest fUSDC vault. Because the USDC price was manipulated downwards, the attacker received more fUSDC shares than they should have.
4. Attacker swapped the USDT back for USDC on Curve, restoring the price.
5. Attacker withdrew USDC from the Harvest vault. Since the price was now higher, their shares were worth more USDC than they deposited.
6. Attacker repeated this process multiple times.
7. Attacker repaid the flash loan and walked away with the profit.

## Impact
- **Loss**: ~$34M
- **Protocol**: Harvest Finance
- **Chain**: Ethereum
- **Date**: 2020-10-26

## Key Transactions
- Attack tx: `0x35f8d2f572fceaac9288e5632737885a062dd0c8587ce9044329942b694a9974`

## Detection Heuristics
- Pattern 1: Calculating share value or collateral value based on instantaneous on-chain prices from a single pool.
- Pattern 2: Lack of slippage protection or "sanity checks" against a more robust oracle when depositing or withdrawing from vaults.

## Remediation
- Fix 1: Use a decentralized oracle (like Chainlink) or a TWAP for asset valuation.
- Fix 2: Implement a "slippage" or "premium" check that prevents deposits/withdrawals when the pool price deviates significantly from the oracle price.

## References
- [rekt.news/harvest-finance-rekt/](https://rekt.news/harvest-finance-rekt/)
- [medium.com/harvest-finance/harvest-flashloan-economic-attack-post-mortem-3cf900d65bc6](https://medium.com/harvest-finance/harvest-flashloan-economic-attack-post-mortem-3cf900d65bc6)
