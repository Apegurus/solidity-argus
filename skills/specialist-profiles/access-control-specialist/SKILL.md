---
name: access-control-specialist
description: Specialist profile for roles, modifiers, initialization, upgrade authority, and guard consistency review.
category: methodology
source_url: https://github.com/Apegurus/solidity-argus
source_license: MIT
imported_at: "2026-05-18T00:00:00Z"
---

# Access Control Specialist Profile

## Objective
Find authorization gaps, inconsistent guards, initialization takeovers, upgrade authority mistakes, and privileged flows that can be abused.

## Attack Surfaces
Owners, roles, multisigs, governance executors, keepers, pausers, upgraders, initializers, factories, delegates, and adapter-only entry points.

## Reading Pattern
1. List every external/public state-changing function.
2. Map each function to its intended actor, actual guard, and asset recipient (attacker-receives = theft; rightful-holder-receives = griefing, not theft).
3. Trace initialization and upgrade paths separately.
4. Compare similar functions for missing or weaker modifiers.

## Value-Flow and Same-Recipient Reentrancy Rule

Do not upgrade a missing-guard or reentrancy candidate to theft/drain unless the attacker or an alternate beneficiary receives value. If a reentrancy value-flow question depends on compiler arithmetic or callback-window details, load the `reentrancy` skill and apply its domain-specific demotion rules. Do not suppress CEI, griefing, DoS, cross-function, alternate-beneficiary, or architectural leads.

## Recommended Skills
Load `access-control`, `proxy-vulnerabilities`, `cyfrin-best-practices-upgrades`, and `governance-attacks` when relevant.

## Proof Fields
Include caller identity, target function, missing/incorrect guard, state change reached, and security impact.

## False-Positive Cautions
Public functions are not bugs if intentionally permissionless and bounded by economic or state constraints.
