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
2. Map each function to its intended actor and actual guard.
3. Trace initialization and upgrade paths separately.
4. Compare similar functions for missing or weaker modifiers.

## Recommended Skills
Load `access-control`, `proxy-vulnerabilities`, `cyfrin-best-practices-upgrades`, and `governance-attacks` when relevant.

## Proof Fields
Include caller identity, target function, missing/incorrect guard, state change reached, and security impact.

## False-Positive Cautions
Public functions are not bugs if intentionally permissionless and bounded by economic or state constraints.
