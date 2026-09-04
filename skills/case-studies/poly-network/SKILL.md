---
name: poly-network
description: "Case study of the 2021 Poly Network exploit: cross-chain relay manipulation draining ~$600M"
category: reference
source_url: "https://rekt.news/polynetwork-rekt/"
source_license: "CC0"
imported_at: "2025-02-20T00:00:00Z"
---
<!-- Source: rekt.news (CC0) -->
<!-- Source: SunWeb3Sec/DeFiHackLabs (Reference) -->

# Poly Network (2021)

## Overview
In August 2021, Poly Network, a cross-chain interoperability protocol, was exploited for approximately $611 million across Ethereum, Binance Smart Chain, and Polygon. The attacker was able to manipulate the protocol's "keeper" role, allowing them to sign and execute arbitrary cross-chain transactions.

## Root Cause
The vulnerability was in the `EthCrossChainManager` contract. The contract had a function `crossChain` that could call any contract on the target chain. The attacker used this to call the `EthCrossChainData` contract's `putCurEpochConPubKeyBytes` function. This function was intended to update the public keys of the "keepers" (the entities that sign cross-chain messages). Because the `EthCrossChainManager` was the owner of the `EthCrossChainData` contract, the call was authorized, allowing the attacker to replace the official keeper keys with their own.

## Attack Flow
1. Attacker crafted a cross-chain message on a source chain (e.g., Ontology).
2. The message was designed to trigger a call to `putCurEpochConPubKeyBytes` on the target chain (Ethereum/BSC/Polygon).
3. The `EthCrossChainManager` received the message and, because it was the owner of the data contract, executed the call.
4. The attacker's public key was now registered as the only valid keeper key.
5. The attacker then crafted and signed withdrawal transactions for the bridge's assets using their own key.
6. The bridge accepted these transactions as valid and released the funds.

## Impact
- **Loss**: ~$611M (Most was later returned by the attacker)
- **Protocol**: Poly Network
- **Chain**: Ethereum, BSC, Polygon
- **Date**: 2021-08-10

## Key Transactions
- Attack tx (Ethereum): `0xb1f3535b698f3a0917a219673e7c0e1501c35f9bb8a2811b7a781363bd23c228`

## Detection Heuristics
- Pattern 1: Cross-chain managers that can call arbitrary functions on internal data or configuration contracts.
- Pattern 2: Lack of strict access control on functions that modify critical system roles (like keepers or validators).

## Remediation
- Fix 1: Implement a whitelist of allowed functions that can be called via cross-chain messages.
- Fix 2: Ensure that critical configuration functions (like updating keeper keys) require multi-signature authorization or a time-lock, and cannot be triggered by a single cross-chain call.

## References
- [rekt.news/polynetwork-rekt/](https://rekt.news/polynetwork-rekt/)
- [slowmist.medium.com/the-analysis-and-q-a-of-poly-network-hack-8112a353e439](https://slowmist.medium.com/the-analysis-and-q-a-of-poly-network-hack-8112a353e439)
