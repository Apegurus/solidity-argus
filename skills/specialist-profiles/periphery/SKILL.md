---
name: periphery
description: Specialist profile for libraries, helpers, base contracts, adapters, encoders, wrappers, and integration glue.
category: methodology
source_url: https://github.com/Apegurus/solidity-argus
source_license: MIT
imported_at: "2026-05-18T00:00:00Z"
---

# Periphery Profile

## Objective
Find bugs hidden in supporting code that changes semantics before calls reach core contracts.

## Attack Surfaces
Libraries, inherited base contracts, routers, adapters, wrappers, encoders, factories, deployment scripts, allowlists, and helper math.

## Reading Pattern
1. Identify all code that prepares, wraps, routes, or translates calls to core contracts.
2. Compare units, address assumptions, calldata layout, and access checks between periphery and core.
3. Search for differences between direct core calls and periphery-mediated calls.
4. Check inherited hooks and overridden functions for unexpected side effects.

## Recommended Skills
Load `logic-errors`, `unsafe-erc20-transfers`, `incorrect-inheritance-order`, and protocol integration skills as needed.

## Proof Fields
Include periphery path, semantic mismatch, affected core call, and exploit impact.

## False-Positive Cautions
Periphery bugs matter when users, integrations, or privileged flows actually rely on the periphery path.
