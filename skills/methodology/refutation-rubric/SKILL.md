---
name: refutation-rubric
description: Four-gate validation rubric (Refutation, Reachability, Trigger, Impact) that Sentinel, Pythia, and Audit Specialist must apply before emitting any finding. Forces evidence-quoting and false-positive suppression. Use during finding identification, severity assignment, and confidence scoring.
category: methodology
source: pashov/skills (judging.md)
source_url: https://github.com/pashov/skills/blob/master/solidity-auditor/references/judging.md
source_license: MIT
---

# Refutation Rubric — 4-Gate Finding Validation

Every candidate finding passes four sequential gates before being recorded via `argus_record_finding`. Fail any gate → **REJECTED_DEMOTED** (record as Lead with `rubric_verdict="REJECTED_DEMOTED"` and `confidence_score ≤ 30`) or **DEMOTED** (record as Lead with `rubric_verdict="DEMOTED"` and `confidence_score ≤ 75`). Later gates are not evaluated for demoted findings — but every finding is recorded, never silently dropped.

This skill is REQUIRED reading at audit start for Sentinel, Pythia, and Audit Specialist.

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

Prove an unprivileged actor can trigger the harmful path in the current deployment state.

- Only trusted roles can trigger → **DEMOTE** (`confidence_score ≤ 75`)
- Costs (gas, capital) exceed extraction → **REJECTED_DEMOTED** (`confidence_score ≤ 30`; this is the most fragile gate — LLM cost calculations ignore flash loans, MEV efficiency, repeated extraction, TVL growth, and cross-protocol composability. Always demote rather than drop, so human reviewers can audit your cost reasoning.)
- Theft/drain claim lacks `attacker_net_gain > 0` after subtracting all attacker-funded inflows (deposits, seed balances, flash-loan principal/fees, and any test/setup funding) → **REJECTED_DEMOTED** until the PoC proves the exploit property. Passing tests are not proof unless the assertion checks the intended exploit property.
- Unprivileged actor triggers profitably → **clears**, continue to Gate 4

## Gate 4 — Impact

Prove material harm to an identifiable victim **in the current code**, not in hypothetical future code — the impact must be reachable in the contract as written.

- Self-harm only → **REJECTED_DEMOTED** (`confidence_score ≤ 30`; functions like `selfDestruct` or `burn` are usually intentional, but document who "self" is — a multisig signer under social engineering, or an admin under key compromise, both look like "self-harm" from a static viewpoint)
- Impact requires code not yet present (a placeholder returning a constant, an unwired setter, a `// TODO` integration) → **DEMOTE** at most (`confidence_score ≤ 75`): the deployed code has no exploit path, so it is an architectural lead. Never rate Critical/High on impact that depends on a future change landing.
- Primitive/library contract that custodies no funds and whose harm only materializes in an out-of-scope integrator (e.g., a price oracle, math library, or unprotected setter consumed elsewhere) → cap at **High** in isolation (`confidence_score ≤ 92`) and add an escalation note ("Critical for any integrating protocol that gates fund flows on this"). Do not rate Critical when no in-scope contract holds the affected funds; this keeps cross-agent scoring consistent for fund-less primitives.
- Trace the recipient before calling any issue "theft" or "drain": if assets flow back to the rightful holder rather than the caller or an alternate beneficiary → griefing / forced action, not theft. Classify by reachable impact and require conservation reasoning: total attributed outflows must not exceed funded inflows plus legitimate victim-funded balances.
- Dust-level, no compounding → **DEMOTE** (`confidence_score ≤ 75`)
- Material loss to identifiable victim → **CONFIRMED** (`confidence_score ≥ 80`)

## PoC Truthfulness for Theft and Drain Claims

Passing tests are not proof. A PoC only confirms a theft, drain, or direct-profit finding when the assertion checks the exploit property itself:

- Prove `attacker_net_gain > 0` in the allegedly stolen asset after subtracting all attacker-funded inflows (deposits, seed balances, flash-loan principal/fees, and any test/setup funding).
- Prove conservation of the relevant ETH/token/share balances across the protocol, attacker, and victims. If the observed balances imply more assets left the system than entered it, the PoC is invalid until corrected.
- Do not treat a passing/green test or a protocol balance decrease as theft by itself. Trace the recipient: if victim assets are returned to the victim, classify reachable impact as forced action/griefing/DoS, not attacker profit.
- Historical precedent can justify impact and recommendations, but a Critical/High current-code theft or drain still requires current-code profit proof.

Argus also applies a machine-enforced projection-time gate to Critical/High confirmed findings that claim value extraction — either explicitly via `claims_value_extraction: true`, or auto-derived from theft/drain/profit class wording in the `check`/`description` when the flag is omitted (so omission cannot bypass the gate): the Findings tier requires both a passing `argus_forge_test` somewhere in the run and a non-empty `net_gain_proof_ref` on the finding. If Foundry is available and either signal is missing, projection marks `gate_demoted: true` and changes the verdict to `DEMOTED`; if Foundry is unavailable, the verdict is not changed and the report renders `unproven — Foundry unavailable`.

Structured fields for this gate:

- `claims_value_extraction?: boolean` — set to `true` when the finding claims theft, drain, or direct attacker profit. When omitted, projection auto-derives it from value-extraction class wording; set it to `false` only as a deliberate, auditable opt-out.
- `net_gain_proof_ref?: string` — reference to the assertion-bearing PoC that proves positive attacker net gain for the current code.
- `gate_demoted?: boolean` — internal projection marker; once set, deduplication must not re-promote the issue to `CONFIRMED`.

This gate enforces evidence presence plus a passing forge run. It does not prove semantic conservation or link a forge result to a specific finding; a future per-finding artifact can strengthen that model.

## Demotion Is Not Suppression

Do not suppress latent technical issues when a theft/drain overclaim fails the gates. If direct attacker profit is not proven, demote only the overclaimed impact and still record the correct reachable impact, such as forced action, griefing, DoS, stale-state exposure, or architectural risk. Domain-specific safe-pattern and demotion rules live in the relevant vulnerability skills; the core rubric only requires current-code exploitability, value-flow tracing, and conservation-aware impact proof.

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

## Safe Patterns (DEMOTE to REJECTED_DEMOTED, do not silently drop)

These patterns are LIKELY not vulnerabilities, but the agent's pattern recognition can be wrong. Record each match with `rubric_verdict="REJECTED_DEMOTED"` and `confidence_score ≤ 30`. The Refutation quote MUST point to the actual pattern in the contract (e.g., the `nonReentrant` modifier on the specific function). Note in the rubric trace why this might still matter:

- `unchecked` blocks in Solidity 0.8+ where the math is provably bounded — **might still matter** if the bound depends on user-controllable state
- Native arithmetic in Solidity 0.8+ — **might still matter** at downcast boundaries (`uint256` → `uint128`)
- MINIMUM_LIQUIDITY burn on first deposit (UniswapV2 pattern) — **might still matter** with fee-on-transfer or rebasing pair tokens
- SafeERC20 calls (`safeTransfer` / `safeTransferFrom`) — **might still matter** if the wrapped ERC20 has fee-on-transfer or blacklist behavior the calling code does not handle
- `nonReentrant` modifier present and applicable to the function — **might still matter** for read-only reentrancy (state observed by a different protocol mid-call) or cross-contract reentrancy via a callback into a different `nonReentrant`-protected contract on the same shared state
- Two-step admin transfer (Ownable2Step pattern) — **might still matter** if `acceptOwnership` can be front-run or if the pending owner can grief
- Consistent protocol-favoring rounding — **might still matter** under compounding, zero-rounding edge cases, or when accumulated dust crosses a threshold

If you can prove the "might still matter" path is real, escalate to a CONFIRMED finding with full rubric trace and the proof.

## Audit Noise (REJECTED_DEMOTED with documentation)

These categories are often out of scope for security audits but argus users (solo devs, OSS maintainers, bounty hunters, CI/CD pipelines) frequently lack the context to recognize when a "noise" finding is actually material. Record each at `rubric_verdict="REJECTED_DEMOTED"` and `confidence_score ≤ 30` with the rubric trace stating which noise category it fell into AND why a user might still want to see it. Do not drop at source.

- **Linter / compiler warnings** — might still matter if the warning is about a deprecated cryptographic primitive or a known compiler bug for the target chain
- **Gas micro-optimizations** (e.g. `++i` vs `i++`) — might still matter inside an unbounded loop on user-controllable iteration count
- **Naming or NatSpec issues** — might still matter if the misnaming creates a behavioral expectation mismatch (e.g., `transferFrom` that actually mints)
- **Admin privileges that are by design** — **always record**; "by design" is a judgment the agent cannot fully verify without protocol documentation, and the argus user often does NOT know admin can rug. Quote the admin function in the Refutation quote so the user can make their own call.
- **Missing events without a concrete exploit path** — might still matter for off-chain indexer reliability, missing audit trails on admin actions, or governance proposal traceability
- **Centralization concerns without a concrete exploit path** — **always record**; same logic as admin-by-design. The user may not realize the protocol is centralized.
- **Implausible preconditions** — EXCEPT: fee-on-transfer, rebasing, and blacklisting tokens ARE plausible for any contract that accepts arbitrary ERC20 tokens. Treat these as Gate 2 reachability concerns, not noise.

The override remains: if you find evidence that the "might still matter" path is real, escalate to a CONFIRMED finding with proof.

## Rubric Trace Format

All 4 gate lines MUST be present in every recorded trace. CONFIRMED, DEMOTED, and REJECTED_DEMOTED findings are all recorded — only the verdict and confidence cap differ. No finding is ever silently dropped.

Every recorded finding MUST include a rubric trace as a markdown prefix in the `description` field. Format:

```
**Rubric Trace** · Verdict: <CONFIRMED|DEMOTED|REJECTED_DEMOTED> · Confidence: <integer 0-100>

- Refutation: <cleared|demoted|rejected_demoted> — <one-line reasoning>
- Reachability: <cleared|demoted|rejected_demoted> — <one-line reasoning>
- Trigger: <cleared|demoted|rejected_demoted> — <one-line reasoning>
- Impact: <cleared|demoted|rejected_demoted|confirmed> — <one-line reasoning>

**Refutation quote:** `<exact code line from the file under audit>` — <one sentence on why this quoted code does or does not block the attack>

---

<the actual finding description starts here>
```

The Verdict in the header MUST match the structured `rubric_verdict` field passed to `argus_record_finding`.

The Refutation quote MUST be a real line from the contract under audit, copied verbatim. Fabricated quotes are the worst possible failure mode of this rubric — they directly mislead the human reviewer. A REJECTED_DEMOTED verdict with a fabricated quote is worse than a dropped finding because the reader trusts what looks like evidence of a guard.

For REJECTED_DEMOTED findings sourced from Safe Patterns or Audit Noise categories (not from a specific gate), use `pre-filter` instead of a gate name on the matching trace line, e.g.: `- Refutation: pre-filter (Safe Pattern: nonReentrant) — quoted modifier blocks single-function reentrancy but read-only reentrancy not analyzed`.

## Cross-Contract Echo (single-agent guidance)

When you confirm a finding in one contract, scan the rest of the in-scope file set for the same pattern in other contracts. If found, record additional findings for each occurrence. Use the same rubric trace shape; the confidence may differ per occurrence based on context.

This is NOT a separate pipeline phase — it is your discipline. The orchestrator does not enforce it. Take responsibility.
