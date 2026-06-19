# 09 — DeFi-Depth Knowledge-Base Expansion (Port Plan)

**Status:** in progress (`feat/kb-defi-depth`)
**Target release:** `0.8.0` (additive knowledge only — no runtime/behavior changes)
**Driver:** gap analysis of `austintgriffith/ethskills` → `evm-audit-skills` (20 domain checklists, ~500 items) against Argus's bundled knowledge base.

---

## License stance

The aggregator repos (`austintgriffith/ethskills`, `…/evm-audit-skills`) carry **no LICENSE** → all-rights-reserved. We do **not** copy them line-by-line. Instead we **infer the underlying techniques** (security facts/patterns are not themselves copyrightable) and author original prose, citing the **primary sources** the aggregator itself credits — most of which are permissively licensed:

| Primary source | License | Used for |
|---|---|---|
| `devdacian/ai-auditor-primers` (Dacian) | MIT | liquidation, precision, ERC4626, signatures, lending, assembly |
| `0xJuancito/multichain-auditor` | MIT | chain-specific/L2 (backlog), token cross-chain drift |
| Sigma Prime blog | Reference (cited) | oracles, liquid restaking, governance |
| beirao.xyz checklist | Reference (cited) | general footguns, lending, staking |
| Cyfrin (Chainlink article, by Dacian) | Reference (cited) | oracle hardening |
| Hacken / OpenZeppelin (UniV4) | Reference (cited) | Uniswap V4 hooks |
| `d-xo/weird-erc20` | Reference (cited) | token quirks |
| Pyth docs | Apache-2.0 (SDK) | Pyth pull-oracle validation |

---

## Inventory — what Argus already covers (do NOT re-port)

Reentrancy and DoS — strong already; only minor regex/precision gains:

- **Reentrancy** (`vulnerability-patterns/reentrancy`): classic, cross-function, cross-contract, read-only, ERC777/721/1155 callbacks, flash-loan callbacks.
- **DoS** (`dos-revert`, `dos-gas-limit`, `insufficient-gas-griefing`, `unbounded-return-data`): force-send, unbounded loops, block-stuffing, return bombs.
- **Weird ERC20** (`weird-tokens`, `unsafe-erc20-transfers`, `fee-on-transfer-tokens`): FOT, rebasing, pausable, blocklist, flash-mint, decimals, approve-race, ERC777.
- **Cross-cutting** already present: `msgvalue-loop`, `uninitialized-storage-pointer`, `overflow-underflow` (downcasts), `hash-collision`.

Genuinely thin / absent → the focus of this work: oracle hardening detail, liquidation mechanics, precision rounding-direction, liquid-staking/restaking, concentrated-liquidity/UniV4, Pyth, arbitrary external call.

---

## Port plan — 5 NEW + 6 EXTEND + disciplined folds

### Tier A — NEW skills

| New file | `pattern_category` | Primary source |
|---|---|---|
| `vulnerability-patterns/liquidation-vulnerabilities` (incl. **auction** subsection) | `logic-error` | Dacian (MIT), Decurity, beirao |
| `protocol-patterns/liquid-staking-restaking` | `logic-error` (+`category: protocol-pattern`) | Sigma Prime, beirao |
| `protocol-patterns/concentrated-liquidity` (CLM + UniV4 hooks) | `front-running` (+`category: protocol-pattern`) | Dacian (CLM), Hacken/OZ |
| `vulnerability-patterns/pyth-oracle-validation` | `oracle-manipulation` | Pyth docs, Sigma Prime |
| `vulnerability-patterns/arbitrary-external-call` | `access-control` | beirao, Decurity |

> Pyth + arbitrary-external-call were promoted from "fold" after review: both are high-severity and distinct enough that folding would dilute them.

### Tier B — EXTEND (highest ROI)

- **`oracle-manipulation`** ⭐ — L2 sequencer-uptime feed + grace period, minAnswer/maxAnswer depeg breaker, per-feed heartbeat, unhandled-revert `try/catch`, decimals/wrong-feed/denomination.
- **`lack-of-precision`** ⭐ — rounding-DIRECTION matrix (protocol vs user), decimal-scaling mismatch, round-to-zero state updates, hidden WAD/RAY div-before-mul.
- **`lending-borrowing`** — AAVE/Compound integration semantics (siloed/isolated/eMode/debt-ceiling, cETH-no-`underlying()`), high-utilization withdrawal block, collateral valuation (depeg, LP-token, yield-share).

### Tier C — EXTEND (worthwhile)

- **`erc4626-exchange-rate-manipulation`** — EIP-4626 compliance: rounding direction per function, `totalAssets` rules, `max*` must-not-revert, withdraw-while-paused.
- **`flash-loan-attacks`** — flash-mint `totalSupply` manipulation, flash-deposit reward extraction, AAVE flash-loan index inflation.
- **`staking-vesting`** — slashing-accounting caps, `notifyRewardAmount(0)` rate-dilution, lock/cooldown bypass, pro-rata reward dust.

### Tier D — Disciplined folds (carry the `detection_rules`, do NOT drop)

- `weird-tokens` / `unsafe-erc20-transfers` ← native-as-ERC20 double-count, Solmate-no-code success, ERC677/1363 `transferAndCall` hooks, multi-address/aliased tokens, `approve(0)`-reverts.
- `logic-errors` ← ignored `EnumerableSet.add()` return, struct-deletion-leaves-mapping.
- `unchecked-return-values` ← `try/catch` swallow / forced-catch gas griefing.
- `weak-sources-randomness` ← Chainlink VRF subsection (reorg confirmations, no state-change after request).

**Fold discipline rule:** every folded pattern must keep a real `detection_rules` entry (regex + severity), not just a prose line — otherwise the detection capability is lost.

---

## Schema constraints (locked from `src/skills/skill-schema.ts`)

- `name`: lowercase slug `^[a-z0-9-]+$`.
- `source_url`: must be a valid URL when present.
- `severity ∈ {Critical, High, Medium, Low, Informational}`; `confidence ∈ {High, Medium, Low}`.
- **`detection_rules` only fire when `pattern_category` is set** (`src/tools/pattern-loader.ts`). Protocol-pattern skills that want live rules must set BOTH `category: protocol-pattern` and a valid `pattern_category`.
- `pattern_category ∈ {reentrancy, oracle-manipulation, flash-loan, access-control, erc4626, proxy, signature, dos, front-running, governance, token-standard, gas-optimization, logic-error, delegatecall}`.

---

## Validation gates (before PR)

1. `bun src/cli/index.ts lint-skills` → all skills pass schema.
2. `bun test` → green (incl. pattern-loader / corpus tests).
3. `tsc --noEmit` + `biome check` → clean.
4. Pattern checker discovers the new `detection_rules` (spot-check via `argus_check_patterns`).
5. `INVENTORY.md` + `skills/README.md` counts updated; `CHANGELOG.md` `0.8.0` entry; `package.json` bumped `0.7.1 → 0.8.0`.

---

## Backlog (explicitly out of scope here)

Assembly/Yul + chain-specific/L2 dedicated skills (Tier-1 from doc 08 follow-up) remain deferred — not "DeFi/reentrancy/DoS" scope. Several findings here (CREATE2 determinism, L2 cheap-gas array filling, multichain decimal drift) reinforce them for a future sprint.
