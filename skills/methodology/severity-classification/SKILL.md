---
name: severity-classification
description: Impact-versus-likelihood rubric to classify Solidity findings from informational through critical severity.
---
<!-- Source: DeFiFoFum/fofum-solidity-skills (MIT) -->

# Severity Classification Guide

## Overview

Severity is determined by **Impact × Likelihood**.

```
                    LIKELIHOOD
                 Low    Medium    High
          ┌────────┬─────────┬─────────┐
     High │ Medium │  High   │Critical │
IMPACT Med│  Low   │ Medium  │  High   │
      Low │  Info  │   Low   │ Medium  │
          └────────┴─────────┴─────────┘
```

---

## Critical

**Definition:** Direct, immediate loss of significant funds without requiring user action.

**Criteria:**
- Attacker can drain protocol funds
- No user interaction required
- Exploit is profitable and repeatable
- Funds at risk > $100k (or significant % of TVL)

**Examples:**
- Unprotected withdrawal allowing anyone to drain
- Price oracle manipulation enabling undercollateralized borrows
- Reentrancy allowing multiple withdrawals

**Required for Report:**
- Working Foundry PoC
- Exact funds at risk calculation
- Step-by-step attack path

---

## High

**Definition:** Loss of funds requiring specific conditions or user action, OR protocol insolvency risk.

**Criteria:**
- Attacker can steal user funds (with user action)
- Protocol can become insolvent
- Permanent freezing of funds
- Governance takeover

**Examples:**
- Frontrunning user transactions for profit
- Flash loan attack requiring specific market conditions
- Permanent DOS of critical functions
- Missing access control on privileged functions

**Required for Report:**
- PoC or detailed attack scenario
- Conditions required for exploit
- Estimated impact

---

## Medium

**Definition:** Conditional loss of funds, protocol disruption, or violation of core invariants.

**Criteria:**
- Loss of funds under unlikely conditions
- Temporary DOS of non-critical functions
- Griefing attacks (cost attacker money too)
- Breaking of stated invariants

**Examples:**
- Rounding errors that leak small amounts over time
- Incorrect fee calculations
- Missing slippage protection (user can set it)
- Stale oracle data used briefly

**Required for Report:**
- Clear explanation of conditions
- Impact assessment
- Recommended fix

---

## Low

**Definition:** Minor issues with limited impact, best practice violations.

**Criteria:**
- No direct loss of funds
- Code quality issues
- Missing events
- Inconsistent behavior (not exploitable)
- Edge cases with minimal impact

**Examples:**
- Missing zero-address validation (with no exploit path)
- Unlocked compiler version
- Inconsistent naming conventions
- Missing natspec documentation

**Required for Report:**
- Issue description
- Recommended fix

---

## Informational

**Definition:** Gas optimizations, code style, suggestions.

**Criteria:**
- No security impact
- Potential improvements
- Gas savings

**Examples:**
- Using `++i` instead of `i++`
- Caching array length in loops
- Using `calldata` instead of `memory`
- Redundant checks

---

## Special Categories

### Centralization Risk

**Severity:** Depends on trust model

- Single admin key → High (if not disclosed)
- Multisig + timelock → Low/Info
- Documented and accepted → Info

### Compiler/Dependency Issues

**Severity:** Depends on exploitability

- Known vulnerable dependency → Medium-Critical
- Outdated but not vulnerable → Info

### Gas Griefing

**Severity:** Usually Medium

- Can cause transaction failures
- Can force users to pay more gas
- Doesn't result in loss of principal

---

## Severity Comparison: Industry Standards

| This Guide | Code4rena | Sherlock | Immunefi |
|------------|-----------|----------|----------|
| Critical | High (3) | High | Critical |
| High | High (2) | High | High |
| Medium | Medium | Medium | Medium |
| Low | Low/QA | Low | Low |
| Info | Gas/QA | Info | None |

---

## Disputes & Edge Cases

When severity is unclear:

1. **Default to higher severity** when uncertain
2. **Consider worst-case scenario**
3. **Account for composability** (other protocols building on top)
4. **Time-sensitivity** (can it be fixed before exploit?)
