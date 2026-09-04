---
name: bzx-flash-loan
description: "Case study of the 2020 bZx exploits: oracle manipulation via flash loans draining ~$1M"
category: reference
source_url: "https://rekt.news/bzx-rekt/"
source_license: "CC0"
imported_at: "2025-02-20T00:00:00Z"
---
<!-- Source: rekt.news (CC0) -->
<!-- Source: SunWeb3Sec/DeFiHackLabs (Reference) -->

# bZx Flash Loan Exploits (2020)

## Overview
In February 2020, bZx was hit by two separate flash loan attacks within days. The first attack involved a complex sequence of trades to manipulate the price of WBTC on Kyber, while the second attack manipulated the sUSD price on Kyber using a flash loan from bZx itself. Total losses were approximately $1M.

## Root Cause
The primary vulnerability was bZx's reliance on a single on-chain liquidity source (Kyber) as a price oracle. By using flash loans to execute large trades on Kyber, the attacker could significantly move the price, allowing them to take out undercollateralized loans or execute profitable liquidations on bZx.

## Attack Flow (First Attack)
1. Attacker took a flash loan of 10,000 ETH from dYdX.
2. Attacker deposited 5,500 ETH to Compound to borrow 112 WBTC.
3. Attacker deposited 1,300 ETH to bZx to open a 5x short position on ETH/BTC.
4. bZx executed the short by swapping ETH for WBTC on Kyber, which routed to Uniswap.
5. The large trade on Uniswap caused massive slippage, driving up the WBTC price.
6. Attacker sold the 112 WBTC borrowed from Compound back into the manipulated market for a huge profit.
7. Attacker repaid the dYdX flash loan.

## Impact
- **Loss**: ~$1M
- **Protocol**: bZx (Fulcrum/Torque)
- **Chain**: Ethereum
- **Date**: 2020-02-15 (First), 2020-02-18 (Second)

## Key Transactions
- First Attack tx: `0xb5c8bd9430b6cc87a0e2fe110ece6bf527fa4f170a4bc8cd032f768fc5219838`
- Second Attack tx: `0x762881dda4f35930d15524a4413fde45bc75096f0a7a495caeac6197b928e934`

## Detection Heuristics
- Pattern 1: Use of low-liquidity DEX pools as the sole price oracle for lending or margin trading.
- Pattern 2: Lack of slippage checks or price deviation checks against external oracles (like Chainlink).

## Remediation
- Fix 1: Use decentralized, aggregate oracles like Chainlink or Time-Weighted Average Prices (TWAP) from Uniswap V2+.
- Fix 2: Implement circuit breakers or maximum slippage limits for large trades.

## References
- [rekt.news/bzx-rekt/](https://rekt.news/bzx-rekt/)
- [bzx.network/blog/post-mortem-eth-btc-margin-tokens-exploit](https://bzx.network/blog/post-mortem-eth-btc-margin-tokens-exploit)
