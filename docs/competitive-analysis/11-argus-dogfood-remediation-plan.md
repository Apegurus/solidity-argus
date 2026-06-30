# Argus Dogfood Remediation Plan — Pre-Implementation Notes

> Generated: 2026-06-22
> Scope: follow-up to vulnerable-vault dogfood run `6019e52c-cad5-45ba-bca1-047a49976bdd` and PR #26 branch `feat/skill-discovery-cleanup`.
> Status: planning record only. Items below are the agreed implementation targets; not all are implemented yet.

---

## Why this exists

The latest vulnerable-vault dogfood reached the right final severity posture for the narrow `VulnerableVault.sol` scope, but it did so because the orchestrator distrusted a passing PoC and manually checked conservation. The pipeline itself still allowed Sentinel/Pythia to record a false-positive Critical claim backed by a green Foundry test.

This document persists the remediation plan that was previously only captured in chat handoff context.

---

## Already implemented mid-run in this branch

These changes exist as local WIP and should be preserved unless deliberately superseded:

- `dropped_observations` is now the intended model for out-of-scope, false-positive, or non-actionable raw observations that should not render as final findings.
- Scribe and Argus prompt guidance now tells Scribe to account for excluded raw observations in `dropped_observations` rather than forcing them into report findings.
- `argus_persist_deduped` now documents the accepted object payload shape: `{ "findings": [...], "dropped_observations": [...] }`.
- `validateFindingLineage` now treats nested raw `observation_ids` as canonical raw lineage, avoiding phantom-ID failures when raw observations have already been collapsed.
- `argus_read_findings` guidance now tells Scribe to use nested canonical raw `observation_ids`, not finding IDs, session IDs, or fingerprints.
- Report methodology now says `Foundry tests` for `argus_forge_test`; it no longer claims fuzzing unless `argus_forge_fuzz` actually ran.

Relevant WIP files:

- `src/agents/argus-prompt.ts`
- `src/agents/scribe-prompt.ts`
- `src/shared/lineage-validator.ts`
- `src/tools/persist-deduped-tool.ts`
- `src/tools/read-findings-tool.ts`
- `src/tools/report-generator-tool.ts`
- `src/tools/live-audit-pipeline.test.ts`
- `src/shared/lineage-validator.test.ts`
- `src/tools/read-findings-tool.test.ts`
- `src/tools/report-generator-tool.test.ts`

---

## P0 — Fix PoC truthfulness before anything else

### Problem

A passing Foundry test (`testReentrancyDrain`) confirmed a false-positive Critical: “full vault drain, 1 ETH profit.” The test fabricated profit because the attacker contract was funded with `vm.deal`, but the deposit call was paid by the test contract’s ambient Foundry balance. The logs revealed the conservation violation: attacker 2 ETH + Alice 10 ETH = 12 ETH out of an 11 ETH vault.

### Required changes

- Add mandatory Sentinel/Pythia/Audit Specialist rubric language: before recording any drain/theft finding, prove both:
  - `attacker_net_gain > 0` for the asset allegedly stolen.
  - Total attributable outflows do not exceed funded inflows plus legitimate victim-funded balances.
- PoCs must assert the security property, not a hardcoded end balance. Prefer assertions like:
  - `attackerNetVaultGain > 0` for confirmed theft.
  - `attackerNetVaultGain == 0` for no-theft regressions.
  - Conservation across vault, attacker, victim, and test harness balances.
- Passing tests are not proof unless the assertion checks the intended exploit property.
- Update `src/agents/sentinel-prompt.ts`: remove or qualify the current rule that “If the PoC passes, the vulnerability is confirmed.”
- Update `src/agents/refutation-rubric-instructions.ts`: Gate 3/4 must require profit-positive, conservation-aware evidence for theft/drain claims.
- Update `src/agents/pythia-prompt.ts`: historical reentrancy precedent may suggest a lead, but cannot upgrade current-code severity without current-code profit proof.

### Regression fixture

Keep the new truth PoC as a regression after cleaning it up deliberately:

- `tests/fixtures/vulnerable-vault/test/ArgusReentrancyTruth.t.sol`

Decide the fate of the older PoC:

- Rewrite `tests/fixtures/vulnerable-vault/test/ReentrancyPoC.t.sol` so it no longer fabricates profit, or
- Keep it only as a documented negative/regression fixture, or
- Remove it if `ArgusReentrancyTruth.t.sol` fully replaces it.

---

## P0 — Add the Solidity >=0.8 same-recipient reentrancy safe pattern, but keep it narrow

### Decision

The same-recipient reentrancy nuance should demote false theft/full-drain claims, not broadly suppress reentrancy findings.

### Safe-pattern conditions

Only apply the demotion when all of the following are true:

1. The contract is compiled with Solidity `>=0.8.0`, or checked arithmetic is otherwise guaranteed.
2. The ETH/token recipient is exactly the same account whose balance/share/credit slot is decremented.
3. The same asset unit is transferred and decremented.
4. There is no `unchecked` arithmetic on the decrement path.
5. There is no alternate beneficiary, fee recipient, callback-controlled recipient, or attacker-controlled transfer target that receives value from another account’s credit.
6. There is no cross-function or shared-accounting path that can mutate the relevant balance before unwind.
7. There is no read-only/state-observation impact that can still be exploited during the reentrancy window.

### What it must not do

- Do not label same-recipient external-call-before-state as “safe” globally.
- Do not suppress CEI findings; classify them as latent/architectural leads when direct theft is neutralized.
- Do not suppress cross-function, read-only, alternate-beneficiary, token-hook, ERC777, share-accounting, or `unchecked` variants.

---

## P0 — Bless an Argus verification budget

### Problem

The orchestrator prompt strongly discourages direct tactical inspection and caps direct reads/shell probes. In this dogfood, following pure delegation would have shipped the false Critical. The correct result depended on Argus manually reading the PoC and rerunning Forge.

### Required changes

- Update `src/agents/argus-prompt.ts` so Critical/High findings get an explicit verification budget.
- Before dispatching Scribe, Argus must independently verify every Critical/High PoC or strong-reasoning claim by:
  - reading the relevant contract lines,
  - reading the PoC/test file or proof source,
  - rerunning the focused test when possible,
  - checking the exploit property and conservation assumptions.
- This verification should not count as a budget violation.
- Tactical discovery remains delegated; the exception is final ground-truth verification of Critical/High claims.

---

## P1 — Harden run isolation and scope discipline

### Problem

The run accumulated raw observations for files outside the requested scope. Scribe handled the contamination by dropping out-of-scope observations, but raw-state bleed is still a reporting-integrity hazard.

### Required changes

- Warn or reject `argus_record_finding` when a finding file is outside declared scope unless explicitly marked as out-of-scope/non-actionable.
- Revisit the “newest active run sink” fallback in `src/hooks/session-activation.ts`; it helps child-session races but can bind unrelated active sessions to the wrong run.
- Keep `dropped_observations` as the reporting layer’s accounting model for observations that were legitimately collected but excluded from the final report.

---

## P1 — Add finding supersession/update semantics

### Problem

Correcting a finding currently means recording another observation and relying on merge/dropped-lineage behavior. This made a legitimate severity correction look like a lineage defect in Themis.

### Required changes

- Add metadata-only supersession fields (`supersedes_observation_id` / `supersedes_observation_ids`). Do not add `argus_update_finding` in this batch.
- Keep lineage accounting explicit: supersession metadata may be validated for phantom IDs, but it does not account for a raw observation. Observations omitted from final findings must be covered by `dropped_observations` with a valid reason.
- Keep original observations auditable; do not delete historical records.

---

## P1 — Polish operator feedback

### Required changes

- `argus_record_finding` should surface canonical run reconciliation, not only return findings with `run_id: "tool-local"` plus an explanatory note.
- The tool response should include normalization diagnostics from `normalizeToCanonicalFinding`, especially:
  - auto-demoted `CONFIRMED` due to sub-threshold `confidence_score`,
  - dropped invalid fields,
  - alias normalization where helpful.
- This makes automatic adjustments visible to the caller instead of silent.

---

## P1 — Fix Scribe multi-revision churn

### Problem

Scribe took too long and emitted `.md`, `-r2`, and `-r3` artifacts. The current prompt policy encourages revision churn by telling Scribe to bump `revision` after corrections, while the tool only rejects duplicate writes for the exact target path.

### Required changes

#### 1. Content-address report writes

- `argus_generate_report` already computes `contentHash`.
- Before writing, scan existing reports for the same `run_id`.
- If an existing report has the same content hash, return that existing `filePath` with `idempotent: true`.
- Do not write `-r2` / `-r3` for identical content.

#### 2. Only create a revision when content actually changed

- Same content: reuse the existing report.
- Different content and no `revision`: return a structured error saying the existing report differs and the caller must pass `revision: N`.
- Different content with `revision`: write the revision.

#### 3. Stop Scribe from guessing revision numbers

- Update `src/agents/scribe-prompt.ts` so Scribe does not blindly bump revisions after duplicate-write errors.
- Scribe should only regenerate after:
  - re-persisting changed deduped findings, or
  - responding to Themis remediation.

#### 4. Add a per-run report manifest

- Add `.argus/runs/{run_id}/reports.json`.
- Track entries like:
  - `revision`
  - `filePath`
  - `contentHash`
  - `dedupedContentHash`
  - `createdAt`
- Use the manifest to diagnose whether churn came from changed findings, changed renderer output, or a plain retry.

---

## Keep working behavior intact

- Preserve independent-provider Themis validation; it correctly reproduced the conservation/underflow proof.
- Preserve the refutation rubric (`confidence_score`, `rubric_verdict`, Findings-vs-Leads routing).
- Preserve `argus_themis_disposition` as the recorded escape hatch for approved/remediated/overridden Themis outcomes.
- Preserve dropped-observation accounting; it solved the scoped-reporting part of the contamination problem.
- Preserve single-writer report policy; idempotence should strengthen it, not bypass it.

---

## Verification after implementation

Minimum verification set:

- `bunx tsc --noEmit`
- `bunx biome check .`
- `bun test`
- focused tests for:
  - `record-finding-tool`
  - `lineage-validator`
  - `persist-deduped-tool`
  - `read-findings-tool`
  - `report-generator-tool`
  - prompt boundary tests
- Forge tests for vulnerable-vault fixtures:
  - `forge test --match-path 'test/ArgusReentrancyTruth.t.sol'`
  - `forge test --match-path 'test/ReentrancyPoC.t.sol'` if retained
  - `forge test --match-path 'test/AccessCtrlPoC.t.sol'`

After source verification, reload/repoint the OpenCode plugin and run a clean full-fixture dogfood. The prior run `6019e52c-cad5-45ba-bca1-047a49976bdd` is not pristine and must not be treated as final validation.
