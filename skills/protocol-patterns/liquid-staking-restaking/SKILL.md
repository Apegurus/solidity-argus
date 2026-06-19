---
name: liquid-staking-restaking
description: "Liquid-staking (stETH/rETH/cbETH/sfrxETH) and restaking/EigenLayer integrations are exploited through rebasing/exchange-rate assumptions, validator-credential hijacking, phantom unverified-ETH accounting, and broken beacon-chain proofs."
category: protocol-pattern
pattern_category: logic-error
source_url: "https://blog.sigmaprime.io/liquid-restaking.html"
source_license: "Reference"
imported_at: "2026-06-19T00:00:00Z"
detection_rules:
  - regex: '\b(stETH|wstETH|rETH|cbETH|sfrxETH|frxETH|ankrETH|swETH)\b'
    severity: Medium
    confidence: Low
    description: "Liquid-staking token integration — verify rebasing vs wrapped handling, non-monotonic/downward rates, blocklist, and withdrawal-queue assumptions"
  - regex: '(withdrawal_credentials|withdrawalCredentials)'
    severity: Critical
    confidence: Medium
    description: "Validator withdrawal credentials — front-runnable same-pubkey deposit can hijack credentials if not bound/verified"
  - regex: '(DepositContract|depositContract)\b[\s\S]{0,200}\.deposit\s*\('
    severity: High
    confidence: Medium
    description: "Beacon deposit path — verify pubkey/credential binding and front-running protection"
  - regex: '(stakedButUnverified|effectiveBalance|BEACON_CHAIN_STRATEGY)'
    severity: High
    confidence: Medium
    description: "Restaking native-ETH accounting — phantom shares if verification subtracts effective balance instead of nominal 32 ETH"
  - regex: '(BeaconChainProof|beaconStateRoot|validatorFields|proofLength|treeHeight|DENEB|CAPELLA)'
    severity: Critical
    confidence: Low
    description: "Beacon-chain proof verification — hardcoded pre-Deneb tree height / field layout breaks after a consensus upgrade"
  - regex: '(rebasing|rebase|sharesOf|getPooledEth|getExchangeRate)\s*\('
    severity: Medium
    confidence: Low
    description: "Rebasing/share accounting — balance can change without a transfer; integrate the wrapped (non-rebasing) version"
---
<!-- Source: Sigma Prime — Liquid Restaking security research (cited) -->
<!-- Source: beirao.xyz audit checklist (cited) -->

# Liquid Staking & Restaking Security

## Overview

Liquid-staking derivatives (LSDs) and restaking (EigenLayer and friends) break several assumptions that hold for ordinary ERC20s and vaults: balances rebase without transfers, exchange rates can move *down* (slashing), redemption can revert or queue, and a large part of the accounting depends on **beacon-chain** state proven on-chain. This skill covers the integration hazards distilled from Sigma Prime's liquid-restaking research and beirao's checklist.

---

## Part 1 — LSD token integration

### 1. Rebasing vs wrapped (Medium/High)

`stETH` **rebases**: balances grow daily without a `transfer`, so `balanceOf`-based accounting drifts and snapshot logic breaks. The wrapped `wstETH` is non-rebasing. Protocols that store "shares" must use the wrapped form or track `sharesOf`, not `balanceOf`.

### 2. Non-monotonic / downward rates (High)

`rETH`/`cbETH` exchange rates are **not guaranteed monotonic up** — slashing can reduce the backing. Code that assumes `rate(t+1) >= rate(t)` (e.g. for reward accounting or invariants) can underflow or misprice.

### 3. Token-specific quirks (Medium)

- **rETH** burn/redeem can **revert** when the deposit pool lacks liquidity.
- **cbETH** is Coinbase-controlled — blocklist + oracle/rate controlled by an EOA/multisig.
- **sfrxETH** can transiently detach from frxETH.
- **Lido withdrawals** are an NFT-queue with timing assumptions.

**Look for:** LSD addresses used with `balanceOf` accounting, monotonic-rate assumptions, or 1:1 peg assumptions.

---

## Part 2 — Restaking / EigenLayer

### 4. Validator withdrawal-credential front-running (Critical)

If a pod/operator deposits to the beacon deposit contract without binding the pubkey to verified withdrawal credentials, an attacker can front-run with the **same pubkey** and set their own withdrawal credentials — hijacking the validator's withdrawals.

### 5. `stakedButUnverified` phantom accounting (High)

A classic restaking bug: native-ETH shares are credited at the nominal **32 ETH**, but on verification the protocol subtracts the validator's **effective balance** (which can be less) — leaving permanent phantom shares that inflate TVL/exchange rate.

### 6. Beacon-chain proof breakage (Critical)

Proof verifiers that hardcode a pre-Deneb **Merkle tree height** or field layout silently break (or become forgeable) after a consensus-layer upgrade (Capella → Deneb → …). Proof constants must track the active fork.

### 7. Cooldown / deposit-reduction slashing evasion (High)

If an operator can reduce their delegated stake or start an unbonding cooldown *after* committing to a service but *before* a slashable fault is finalized, they evade slashing while users bear the risk.

### 8. Forced delegation / share-tracking manipulation (High)

Flawed share or delegation tracking can let TVL or the exchange rate be flash-manipulated, or force delegation to an attacker-controlled operator.

---

## Detection Heuristics

- LSD: confirm wrapped-vs-rebasing handling, downward-rate tolerance, redemption-revert handling, and no 1:1 peg assumption.
- Restaking: confirm pubkey↔credential binding, nominal-vs-effective-balance accounting, fork-aware proof constants, and that stake reduction cannot precede slashing finality.

## Remediation

Integrate the **wrapped** LSD and track shares, not `balanceOf`. Tolerate downward rates and redemption reverts. Bind validator pubkeys to verified credentials. Account native ETH by verified effective balance, never nominal 32 ETH. Make beacon-proof constants fork-aware. Enforce that unbonding/cooldown cannot finalize before outstanding slashable obligations.

## References

- [Sigma Prime — Liquid Restaking](https://blog.sigmaprime.io/liquid-restaking.html)
- [EigenLayer — security & withdrawal-credential model](https://docs.eigenlayer.xyz/)
