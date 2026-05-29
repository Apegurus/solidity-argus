---
name: refutation-rubric
description: Four-gate validation rubric (Refutation, Reachability, Trigger, Impact) that Sentinel and Pythia must apply before emitting any finding. Forces evidence-quoting and false-positive suppression. Use during finding identification, severity assignment, and confidence scoring.
category: methodology
source: pashov/skills (judging.md)
source_url: https://github.com/pashov/skills/blob/master/solidity-auditor/references/judging.md
source_license: MIT
---

# Refutation Rubric — 4-Gate Finding Validation

Every candidate finding passes four sequential gates before being recorded via `argus_record_finding`. Fail any gate → REJECTED (drop, do not record) or DEMOTE (record as Lead). Later gates are not evaluated for failed findings.

This skill is REQUIRED reading at audit start for Sentinel and Pythia.

## Gate 1 — Refutation

Construct the strongest argument that the finding is wrong. Find the guard, check, or constraint that kills the attack. **You must quote the exact line of code that blocks (or fails to block) the claimed step.**

- Concrete refutation (specific guard blocks the exact claimed step) → **REJECTED_DEMOTED** (record with `rubric_verdict="REJECTED_DEMOTED"` and `confidence_score ≤ 30`; the quoted guard goes in the Refutation quote so a human reviewer can verify the guard is real and effective)
- Speculative refutation ("probably wouldn't happen") → **clears**, continue to Gate 2

## Gate 2 — Reachability

Prove the vulnerable state exists in a live deployment.

- Structurally impossible (an enforced invariant prevents it) → **REJECTED_DEMOTED** (`confidence_score ≤ 30`; quote the invariant in the Refutation quote so the reviewer can verify it is enforced rather than merely conventional)
- Requires privileged actions outside normal operation → **DEMOTE** (`confidence_score ≤ 75`)
- Achievable through normal usage or common token behaviors → **clears**, continue to Gate 3

## Gate 3 — Trigger

Prove an unprivileged actor executes the attack.

- Only trusted roles can trigger → **DEMOTE** (`confidence_score ≤ 75`)
- Costs (gas, capital) exceed extraction → **REJECTED_DEMOTED** (`confidence_score ≤ 30`; this is the most fragile gate — LLM cost calculations ignore flash loans, MEV efficiency, repeated extraction, TVL growth, and cross-protocol composability. Always demote rather than drop, so human reviewers can audit your cost reasoning.)
- Unprivileged actor triggers profitably → **clears**, continue to Gate 4

## Gate 4 — Impact

Prove material harm to an identifiable victim.

- Self-harm only → **REJECTED_DEMOTED** (`confidence_score ≤ 30`; functions like `selfDestruct` or `burn` are usually intentional, but document who "self" is — a multisig signer under social engineering, or an admin under key compromise, both look like "self-harm" from a static viewpoint)
- Dust-level, no compounding → **DEMOTE** (`confidence_score ≤ 75`)
- Material loss to identifiable victim → **CONFIRMED** (`confidence_score ≥ 80`)

## Confidence Scoring

Pass the resulting score to `argus_record_finding` as the `confidence_score` field (integer, 0-100). Also pass `rubric_verdict` (string enum) so the reporter can group findings deterministically.

Start at **100**, then deduct:

- Partial attack path: **-20**
- Bounded non-compounding impact: **-15**
- Requires specific (but achievable) state: **-10**
- Demoted at any gate (not REJECTED_DEMOTED): take min(current, 75) → typical Lead range with `rubric_verdict="DEMOTED"`
- REJECTED_DEMOTED at any gate, Safe Pattern, or Do Not Report: take min(current, 30) → bottom of Leads with `rubric_verdict="REJECTED_DEMOTED"`

The default reporter splits at `confidence_score ≥ 80` (Findings) vs `< 80` (Leads). The threshold is configurable via `reporting.confidenceThreshold`. REJECTED_DEMOTED entries always land in Leads under the default threshold.

Confidence ≥ 80 → goes in `## Findings` section of the report with a `Fix` block.
Confidence < 80 → goes in `## Leads` section, description only, no `Fix`.

## Verdicts

Every recorded finding has exactly one `rubric_verdict` value:

- **CONFIRMED**: cleared all 4 gates → `record_finding` with full rubric trace and `confidence_score ≥ 80`
- **DEMOTED**: cleared some gates, demoted at others → `record_finding` with full rubric trace and `confidence_score ≤ 75` (lands in Leads)
- **REJECTED_DEMOTED**: failed a hard gate, hit a Safe Pattern, or hit a Do Not Report category → `record_finding` with full rubric trace and `confidence_score ≤ 30` (lands at the bottom of Leads). **This verdict replaces the prior "REJECTED = drop" semantics — we never drop findings, because argus users may lack a human auditor to backfill the missed reasoning.**

## Safe Patterns (DO NOT FLAG)

These patterns are NOT vulnerabilities. Do not record findings for them unless you have specific concrete reasoning that overrides:

- `unchecked` blocks in Solidity 0.8+ where the math is provably bounded
- Native arithmetic in Solidity 0.8+ (`+`, `-`, `*`, `/`) where the compiler inserts overflow checks outside `unchecked` blocks
- MINIMUM_LIQUIDITY burn on first deposit (UniswapV2 pattern)
- SafeERC20 calls (`safeTransfer` / `safeTransferFrom`)
- `nonReentrant` modifier present and applicable to the function (only flag if you can prove cross-contract attack bypass)
- Two-step admin transfer (Ownable2Step pattern)
- Consistent protocol-favoring rounding (unless compounding or zero-rounding edge case)

## Do Not Report

Out of scope for security audits. Drop these at source — they are noise:

- Linter / compiler warnings
- Gas micro-optimizations (e.g. `++i` vs `i++`)
- Naming or NatSpec issues
- Admin privileges that are by design
- Missing events without a concrete exploit path
- Centralization concerns without a concrete exploit path
- Implausible preconditions — EXCEPT: fee-on-transfer, rebasing, and blacklisting tokens ARE plausible for any contract that accepts arbitrary ERC20 tokens

## Rubric Trace Format

All 4 gate lines MUST be present in every recorded trace. REJECTED findings are not recorded (no trace at all). For DEMOTE and CONFIRMED findings, every gate was evaluated and has a result.

Every recorded finding MUST include a rubric trace as a markdown prefix in the `description` field. Format:

```
**Rubric Trace** · Confidence: <integer 0-100>

- Refutation: <cleared|demoted|rejected> — <one-line reasoning>
- Reachability: <cleared|demoted|rejected> — <one-line reasoning>
- Trigger: <cleared|demoted|rejected> — <one-line reasoning>
- Impact: <cleared|demoted|confirmed> — <one-line reasoning>

**Refutation quote:** `<exact code line from the file under audit>` — <one sentence on why this quoted code does or does not block the attack>

---

<the actual finding description starts here>
```

The Refutation quote MUST be a real line from the contract under audit, copied verbatim. Fabricated quotes are the worst possible failure mode of this rubric — they directly mislead the human reviewer.

## Cross-Contract Echo (single-agent guidance)

When you confirm a finding in one contract, scan the rest of the in-scope file set for the same pattern in other contracts. If found, record additional findings for each occurrence. Use the same rubric trace shape; the confidence may differ per occurrence based on context.

This is NOT a separate pipeline phase — it is your discipline. The orchestrator does not enforce it. Take responsibility.
