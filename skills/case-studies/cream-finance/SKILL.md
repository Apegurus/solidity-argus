---
name: cream-finance
description: "Case study of the 2021 Cream Finance exploit: flash loan + oracle manipulation draining ~$130M"
category: reference
source_url: "https://rekt.news/cream-rekt-2/"
source_license: "CC0"
imported_at: "2025-02-20T00:00:00Z"
detection_rules:
  - regex: 'yUSD|yETH'
    severity: "Medium"
    description: "Detects usage of Yearn vault tokens which can have complex pricing mechanisms vulnerable to manipulation."
---
<!-- Source: rekt.news (CC0) -->
<!-- Source: SunWeb3Sec/DeFiHackLabs (Reference) -->

# Cream Finance (2021)

## Overview
In October 2021, Cream Finance was exploited for approximately $130 million. The attacker used a complex flash loan attack to manipulate the price of Yearn's yUSD vault tokens, which were used as collateral on Cream. By inflating the value of yUSD, the attacker was able to borrow almost all other assets available on the platform.

## Root Cause
The vulnerability lay in how Cream Finance calculated the price of Yearn vault tokens (yUSD). The price was derived from the total assets in the Yearn vault divided by the total supply of vault shares. The attacker used flash loans to deposit a massive amount of assets into the Yearn vault, which temporarily inflated the "price per share" used by Cream's oracle.

## Attack Flow
1. Attacker took a massive flash loan of 500M DAI and other assets from MakerDAO and Aave.
2. Attacker deposited the DAI into Yearn's yUSD vault to receive yUSD tokens.
3. Attacker then deposited the yUSD into Cream Finance as collateral.
4. Attacker used more flash-loaned assets to further manipulate the Yearn vault's internal state, significantly increasing the reported value of yUSD on Cream.
5. With the inflated collateral value, the attacker borrowed almost all liquid assets from Cream's lending pools (ETH, WBTC, stablecoins).
6. Attacker repaid the flash loans and kept the borrowed assets.

## Impact
- **Loss**: ~$130M
- **Protocol**: Cream Finance
- **Chain**: Ethereum
- **Date**: 2021-10-27

## Key Transactions
- Attack tx: `0x0fe2588608f3588c4a273c63e47ae7793c920909623d9d55666e082059d3c7df`

## Detection Heuristics
- Pattern 1: Using vault share prices (like `pricePerShare`) as an oracle without accounting for potential manipulation of the underlying vault's reserves.
- Pattern 2: Lack of caps on how much a single asset can be used as collateral, especially for complex derivative tokens.

## Remediation
- Fix 1: Use more robust oracles that are resistant to instantaneous reserve manipulation (e.g., Chainlink or TWAP).
- Fix 2: Implement collateral caps and borrow limits to prevent a single exploit from draining the entire protocol.
- Fix 3: Add a delay or "sanity check" when the price of a collateral asset changes significantly within a short period.

## References
- [rekt.news/cream-rekt-2/](https://rekt.news/cream-rekt-2/)
- [medium.com/cream-finance/c-r-e-a-m-finance-post-mortem-october-27-2021-d5a411f3f87a](https://medium.com/cream-finance/c-r-e-a-m-finance-post-mortem-october-27-2021-d5a411f3f87a)
