---
name: economic-security
description: Specialist profile for external dependencies, token behavior, incentives, oracle assumptions, and value-flow attacks.
category: methodology
source_url: https://github.com/Apegurus/solidity-argus
source_license: MIT
imported_at: "2026-05-18T00:00:00Z"
---

# Economic Security Profile

## Objective
Find attacks where the code is locally correct but economically exploitable through prices, incentives, liquidity, token behavior, governance, or integration assumptions.

## Attack Surfaces
AMM reserves, oracle feeds, collateral values, liquidation incentives, reward emissions, fee paths, arbitrary ERC20 integrations, governance power, and flash-loan-amplified flows.

## Reading Pattern
1. Trace all value flows into and out of the protocol.
2. Identify assumptions about price, liquidity, token behavior, and participant incentives.
3. Ask whether capital, same-block execution, or governance power can bend those assumptions.
4. Search historical precedents when the shape matches known DeFi exploits.

## Recommended Skills
Load `oracle-manipulation`, `flash-loan-attacks`, `weird-tokens`, `unsafe-erc20-transfers`, `amm-dex`, and `lending-borrowing` as needed.

## Proof Fields
Include dependency manipulated, attack capital/sequence, resulting mispricing or incentive break, and value impact.

## False-Positive Cautions
Do not report generic centralization or market risk unless a code path makes the risk exploitable or materially worse.
