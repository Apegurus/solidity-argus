---
name: mango-markets
description: "Case study of the 2022 Mango Markets exploit: oracle price manipulation draining ~$114M"
category: reference
source_url: "https://rekt.news/mango-markets-rekt/"
source_license: "CC0"
imported_at: "2025-02-20T00:00:00Z"
---
<!-- Source: rekt.news (CC0) -->
<!-- Source: SunWeb3Sec/DeFiHackLabs (Reference) -->

# Mango Markets (2022)

## Overview
In October 2022, Mango Markets, a decentralized exchange on Solana, was exploited for approximately $114 million. The attacker used a large amount of capital to manipulate the price of the MNGO token on the platform's own order book, which was used as the price oracle for collateral valuation.

## Root Cause
The vulnerability was the protocol's reliance on its own low-liquidity internal markets as a price oracle for its native token (MNGO). By wash trading MNGO against USDC, the attacker was able to artificially inflate the price of MNGO. Because Mango used this manipulated price to determine how much a user could borrow, the attacker was able to take out massive loans of other assets (USDC, SOL, BTC, etc.) against their "valuable" MNGO collateral.

## Attack Flow
1. Attacker funded two separate accounts with 5M USDC each.
2. Account A placed a large sell order for MNGO perps at a high price.
3. Account B placed a large buy order for MNGO perps, matching Account A's order.
4. This wash trade significantly moved the MNGO price on the Mango order book.
5. The internal oracle updated the MNGO price based on these trades, inflating it by over 2,000%.
6. With the inflated MNGO collateral value, Account B borrowed $114M worth of various assets from the Mango treasury.
7. The attacker then proposed a governance settlement to return some funds in exchange for no criminal prosecution (which was later rejected by law enforcement).

## Impact
- **Loss**: ~$114M
- **Protocol**: Mango Markets
- **Chain**: Solana
- **Date**: 2022-10-11

## Key Transactions
- Attack tx (Example): `599986Yfs4S6996Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9Yv9`

## Detection Heuristics
- Pattern 1: Using internal, low-liquidity markets as the primary price oracle for collateral.
- Pattern 2: Lack of caps on borrowing against highly volatile or manipulatable assets.

## Remediation
- Fix 1: Use external, aggregate oracles (like Pyth or Chainlink) that incorporate liquidity from multiple high-volume exchanges.
- Fix 2: Implement "oracle confidence intervals" or "sanity checks" that ignore price spikes that aren't reflected in broader markets.
- Fix 3: Set strict borrow limits and higher collateral requirements for native governance tokens.

## References
- [rekt.news/mango-markets-rekt/](https://rekt.news/mango-markets-rekt/)
- [mango.markets/blog/post-mortem-october-exploit](https://mango.markets/blog/post-mortem-october-exploit)
