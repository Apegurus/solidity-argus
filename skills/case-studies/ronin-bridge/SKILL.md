---
name: ronin-bridge
description: "Case study of the 2022 Ronin Bridge exploit: compromised validator keys draining ~$625M"
category: reference
source_url: "https://rekt.news/ronin-rekt/"
source_license: "CC0"
imported_at: "2025-02-20T00:00:00Z"
detection_rules:
  - regex: 'onlyValidator'
    severity: "Low"
    description: "Detects validator-only functions. While not a bug, it highlights the critical trust points in the system."
---
<!-- Source: rekt.news (CC0) -->
<!-- Source: SunWeb3Sec/DeFiHackLabs (Reference) -->

# Ronin Bridge (2022)

## Overview
In March 2022, the Ronin Network, an Ethereum-linked sidechain for the Axie Infinity game, was exploited for 173,600 ETH and 25.5M USDC (worth ~$625M). This was not a smart contract bug but a social engineering attack that led to the compromise of 5 out of 9 validator private keys.

## Root Cause
The Ronin bridge required 5 out of 9 validator signatures to authorize withdrawals. The attacker (Lazarus Group) used a fake job offer to compromise a developer's computer, gaining access to 4 validator keys held by Sky Mavis. They also gained access to a 5th validator key held by the Axie DAO, which had been granted a temporary "allowance" to sign on behalf of Sky Mavis during a period of high traffic and was never revoked.

## Attack Flow
1. Attacker used social engineering (fake job interview/PDF) to plant malware on a Sky Mavis engineer's laptop.
2. Attacker extracted 4 validator private keys from Sky Mavis infrastructure.
3. Attacker discovered an RPC backdoor to the Axie DAO validator, which had been authorized to sign for Sky Mavis months earlier.
4. With 5 keys, the attacker had the supermajority needed to sign withdrawal transactions.
5. Attacker submitted two withdrawal transactions to the Ronin bridge on Ethereum, draining the funds.

## Impact
- **Loss**: ~$625M
- **Protocol**: Ronin Bridge (Sky Mavis)
- **Chain**: Ronin / Ethereum
- **Date**: 2022-03-23 (Discovered 2022-03-29)

## Key Transactions
- Withdrawal tx 1: `0xc28fad5e8d5e0ce6a2eaf67b6687be5d58113e16be590824d6cfa1a691f6d7b3`
- Withdrawal tx 2: `0xed2c1225a57b6811c570930c7e9996a8a18b19a472f5502013f80f53c7a32730`

## Detection Heuristics
- Pattern 1: Low validator count (centralization risk).
- Pattern 2: Long-standing "temporary" permissions or allowances in governance/bridge contracts.

## Remediation
- Fix 1: Increase the number of validators and the threshold for consensus (Ronin moved to 21 validators).
- Fix 2: Implement strict security protocols for validator key management (HSMs, multi-party computation).
- Fix 3: Regular audits of off-chain infrastructure and social engineering training for employees.

## References
- [rekt.news/ronin-rekt/](https://rekt.news/ronin-rekt/)
- [roninchain.com/blog/posts/community-alert-ronin-bridge-exploit-post-mortem](https://roninchain.com/blog/posts/community-alert-ronin-bridge-exploit-post-mortem)
