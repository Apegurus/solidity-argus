# Argus Audit Postmortem — Corrected Fix Backlog

> Generated: 2026-06-15 · Updated: 2026-06-17 (reconciled against shipped `0.7.0`)
> Source: postmortem of run `1c832735` (vulnerable-vault dogfood, `0.7.0-dev`) cross-checked against HEAD `5e74b08`.
> Method: every postmortem claim was re-verified against current source / run artifacts before being accepted. Verdicts and priorities below are the *corrected* ones, not the postmortem's originals.
> Status (2026-06-17): #5, #6, #4, and the scoped reporting-gate reframe (#1/#7) shipped in `0.7.0`. The "remaining" table below is the post-0.7.0 open set.

---

## How this backlog was derived

The in-run Argus agent produced a 10-point postmortem. Each point was independently verified:

- **Confirmed real** (gap exists in HEAD source): #5, #6, #4, #1/#7.
- **Misdiagnosed** (corrected here): #3 — the "phantom observation IDs accepted silently" framing is false; see Corrections.
- **Low-priority ergonomics**: #2, #8, #9, #10.

Two methodological corrections also came out of this pass and are recorded below so they don't recur.

---

## Landed this pass

### P0-A — Unambiguous build provenance in the event stream ✅

**Problem.** Run events recorded only `"plugin_version":"0.7.0-dev"` with no commit, and the published `@latest` package (`0.6.2`) had `gitHead: NONE`. Result: it was impossible to prove which commit a run executed on — exactly the ambiguity that derailed release validation.

**Fix.**
- `src/shared/plugin-metadata.ts` — `computeBuildProvenance()` (pure, reader-injected), `resolveBuildProvenance()` priority chain **stamp → runtime git → version-only**, `formatBuildId()` → semver build-metadata descriptor, exported `ARGUS_BUILD_PROVENANCE` + `ARGUS_PLUGIN_BUILD`.
- `scripts/stamp-build-info.ts` (new) wired as `prepack` → writes `build-info.json` (commit, dirty, version, builtAt). This is the only provenance that survives into an npm install (no `.git` at runtime).
- 4 emit sites now record the descriptor + structured fields: `src/hooks/event-hook.ts` (session.created, session.deleted), `src/create-hooks.ts` (session.created), `src/features/persistent-state/run-finalizer.ts` (run.finalized) — `plugin_version: ARGUS_PLUGIN_BUILD`, plus `build_commit` / `build_dirty`.
- `package.json` (`prepack` + `files: build-info.json`), `.gitignore` (stamp is generated).

**Result.**
- Dev/worktree: `plugin_version = 0.7.0-dev+g5e74b08.dirty`, `source:"git"`.
- Published: `prepack` stamps the full commit; a packed install reports `0.7.0-dev+g5e74b08ca12c.dirty`, `source:"stamp"`.

**Verified.** lsp clean (4 files); `tsc --noEmit` exit 0; `bun test` 1702 pass / 0 fail; `npm pack --dry-run` runs `prepack` and ships `build-info.json` (143B) in the tarball; both provenance paths printed and confirmed. No schema_version bump (additive optional payload fields; `plugin_version` was never parsed as pure semver).

### Shipped in 0.7.0 ✅

Closed during the v0.7.0 release pass (folded into `c7ef411`; finalizer fix `3e1957b`; see CHANGELOG 0.7.0):

- **#5 (P0) — CONFIRMED ⇒ confidence_score ≥ 80.** Enforced at ingest, dedup-merge, and report tiering; a low-confidence `CONFIRMED` can no longer reach the Findings tier under verdict-first routing.
- **#6 (P1) — Methodology/tools-used from the executed-tools ledger.** The report no longer claims a tool ran when it did not.
- **#4 (P1) — Severity over-classification.** Rubric Gate-4 now requires impact reachable in *current* code; the access-control skill adds the theft-vs-griefing value-flow rule.
- **#1/#7 (P1) — *partial*.** The reporting-gate advisory now reports `DELEGATED` (not a false `BLOCKED`) once subagents dispatch. The full status enum + ledger propagation remains open (see table).

0.7.0 also closed two finalization defects outside this numbered set: the missing-`run.finalized` emit gap, and finalization failing on legitimate subagent re-dispatch (`3e1957b`, validated by the `bd6ae9a1` dogfood through 2+ remediation cycles with `invariantsPassed: true`).

---

## Prioritized backlog (remaining)

| Pri | ID | Item | Primary evidence | Effort |
|---|---|---|---|---|
| 🟠 P1 | #11 | Gate the orchestrator's "audit complete" claim on the `run.finalized` event — don't declare done while `finalized:false` | dogfood `6feabcc8` reported complete while `run.finalized` was `finalized:false`; surfaced after this doc was written | S–M |
| 🟠 P1 | #1/#7 | *(remainder)* Reporting-gate **state model** (`pending`/`executed`/`failed`/`compensated`) + subagent-ledger propagation — the `DELEGATED` reframe shipped in 0.7.0; the status enum did not | `src/shared/key-tools.ts:35-46` (`success===true` only); `src/state/types.ts:113-121` (`success:boolean`, no status enum) | M |
| 🟡 P2 | #3 | Ingest-side dedup + `dropped_observations` reconciliation | `src/tools/record-finding-tool.ts` no ingest dedup; raw ≠ lineage + dropped 0 | S–M |
| 🟡 P2 | #2 | `load_skills` footgun (runtime skills vs `argus_skill_load`) — clearer error / routing | orchestrator dispatch boundary | S |
| 🟡 P2 | #9 | Scale recon direct-tool budget with project size (or `recon_summary` tool) | 8-call ceiling | M |
| 🟢 P3 | #8 | Unify `argus_*` file-path resolution (re: `argus_proxy_detection`) | path-resolver inconsistency | S |
| 🟢 P3 | #10 | Subagent handoff manifests (IDs + brief; pull full via `argus_read_findings`) | context burn on long audits | M |

---

## Detail

### ✅ #5 (shipped 0.7.0) — Enforce CONFIRMED ⇒ confidence_score ≥ 80
The rubric threshold is defined only in guidance (`refutation-rubric/SKILL.md:45,59,68`). No code couples verdict to score: `adapters.ts` / `schemas.ts` validate each field in isolation, `persist-deduped-tool.ts` checks only lineage, and `finding-aggregation.ts:40-48,106-109` takes the *max* score across observations without a verdict guard.
- **Why it's urgent now:** the recent `d53c2e3` *verdict-first tiering* routes `CONFIRMED → Findings tier` by verdict, so a sub-80 CONFIRMED lands in Findings (previously the confidence threshold alone would have demoted it). The refactor + missing coupling interact badly.
- **Fix:** in `normalizeToCanonicalFinding` (adapters), if `rubric_verdict==="CONFIRMED" && confidence_score < threshold` → auto-DEMOTE (`confidence_score` capped, verdict `DEMOTED`). Flip the assertion in `finding-aggregation.test.ts:68-78`.

### ✅ #6 (shipped 0.7.0) — Methodology from the tools ledger
`report-generator-tool.ts:1513-1521` always prints "Slither static analysis, Foundry…, Pattern Analysis, Solodit" regardless of execution — producing a self-contradiction with the report's own "slither not executed" Completeness Warning. The per-tool success data already exists (`:1334-1361`, from `ToolExecution.success`) and `unavailableTools` is in `ReportInput` (`schemas.ts:111-133`).
- **Fix:** build the Tools-used list from `toolsExecuted` where `success===true` (with display-name mapping); keep the Approach paragraph. Optional follow-on: `methodology_notes[]` field for custom limitations text.

### ✅ #4 (shipped 0.7.0) — Severity over-classification (guidance)
Gate 4 says "prove material harm" with no reachable-vs-hypothetical distinction and no placeholder-code anti-pattern; access-control skill has no "trace who receives the asset" guidance (so `withdraw(to,amount)` got rated theft when ETH returns to the debited holder = griefing).
- **Fix:** (a) Gate 4: "harm must be reachable in *current* code; if impact depends on not-yet-present code (e.g. `getPrice()` returns a constant), DEMOTE/REJECTED_DEMOTED." (b) access-control skill + specialist `Reading Pattern`: add "map each unauthorized function to its asset recipient; attacker-receives = theft, holder-receives = griefing."
- **Note:** complementary to #5 — #4 reduces over-classification at the source, #5 is the code backstop.

### 🟠 #1/#7 (partial) — Reporting-gate state
**Shipped in 0.7.0:** the gate now reports `DELEGATED` once subagents dispatch (no more false `BLOCKED`). **Remaining:** the structured state model + ledger propagation below.

`computeMissingKeyTools` (`key-tools.ts:35-46`) treats "never attempted" and "attempted-but-failed" identically (filters `success===true`); `ToolExecution` (`types.ts:113-121`) has no status enum. The hook **does** recompute every turn (so "doesn't update mid-run" is wrong); the likely real cause of the perpetually-stuck gate is **subagent tool executions not propagating into the orchestrator's `toolsExecuted` ledger**.
- **Fix:** verify the propagation hypothesis first; then add a `status: "pending"|"executed"|"failed"|"compensated"` field and surface "compensated" distinctly from "pending" in the gate text.

### P2 — #3 Ingest reconciliation (corrected from postmortem)
**The postmortem's "phantom IDs accepted silently" is false.** Run artifacts show the 48 `f7971b27-*` IDs **are** canonical entries in `findings.json`; `deduped-findings.json` references **zero** of them, so `persist_deduped` never accepted a phantom reference. The lineage validator (`persist-deduped-tool.ts:175-204` → `lineage-validator.ts:101`) correctly accepts IDs present in the raw store.
- **Actual issue:** the pattern scanner emits duplicate observations at ingest (`record-finding-tool.ts` has no ingest dedup), and the raw→deduped reconciliation reports `dropped_observations_count=0` while 115 raw observations collapse to 67 in lineage. `115 ≠ 67 + 0` is what made Themis suspicious and cost a documentation cycle.
- **Fix:** dedupe pattern-scan observations at ingest, **or** count excluded duplicates in `dropped_observations` so the parity math closes.

### P1 — #11 Gate "audit complete" on `run.finalized`
The orchestrator can declare an audit complete while the run is not finalized: dogfood `6feabcc8` reported success while `run.finalized` was `{finalized:false, invariantsPassed:false}`. The finalizer bug behind that specific run is fixed (`3e1957b`), but the orchestrator-side gap — treating "report generated" as "done" without confirming the terminal `run.finalized` event — remains.
- **Fix:** before emitting the completion summary, require a `run.finalized` event with `finalized:true`; if it is absent or `invariantsPassed:false`, surface the run as not-complete rather than done.

---

## Second dogfood (run `bd6ae9a1`, 0.7.0+g3e1957b) — verified items

A 10-point self-postmortem from the release-candidate dogfood was verified against source + run artifacts (same discipline as above). Numbering follows that postmortem and is independent of the #1–#11 set above.

### Fixed in 0.7.0 (this pass) ✅
- **DF-1 — `observation_id` collision.** `record-finding-tool.ts` stamped `${sessionId}:${index+1}` with a per-invocation index, so repeated single-finding calls in one session all got `:1` (verified: 3× `ses_…98e8:1` in `findings.json`). Now uses a per-call-unique token. Fixed + regression test.
- **DF-2 — cross-file dedup merge.** Consequence of DF-1; first-pass Scribe merged findings from different files (Themis caught it). `validateFindingLineage` now rejects deduped findings whose mapped observations span >1 file (`cross_file_merges`); `persist-deduped` surfaces a corrective hint. Fixed + tests.
- **DF-8/DF-3 (messaging) — `tool-local` run_id.** The response note now explains the transient placeholder instead of conflicting with it. Verified: `findings.json` reconciles all 84 observations to the canonical run_id, so the placeholder is cosmetic (the scary "cross-run bleed" claim was refuted).

### Deferred (verified real, but design/profiling required)

| Pri | ID | Item | Notes |
|---|---|---|---|
| 🟠 P1 | DF-4 | First-pass severity biased high (Pythia emitted reentrancy `Critical/100`; only the executed PoC + Themis demoted it to latent/Medium) | The 0.7.0 Gate-4 *guidance* shipped yet did not prevent it → needs a code backstop (e.g. auto-demote a Critical reentrancy lacking a profit-positive PoC). Re-validate against the eval harness. |
| 🟡 P2 | DF-9 | Eval fixture `tests/eval/fixtures/vulnerable-vault/fixture.yaml` asserts `Critical` / `>= High` for the ^0.8.20-neutralized reentrancy | Test-oracle rewards the over-classification in DF-4. Recalibrate expected severities (tie to DF-4). |
| 🟡 P2 | DF-6 | Scribe report step slow (~14m first / ~22m regen observed) | Profile before fixing; the elapsed likely includes the remediation re-dispatch, not pure Scribe. |
| 🟢 P3 | DF-7 | Subagent routing logs show `via category: unknown` | Likely an orchestration-layer label, not plugin code; confirm scope. |
| 🟢 P3 | DF-10 | No refreshed `<argus-context>` showing the post-Scribe gate cleared | Overlaps #11 and #1/#7 above. |

### Refuted (no action)
- **DF-5 — score==80 → Leads (`>` vs `>=`).** `splitFindingsByTier` uses `score < threshold → leads` (= the documented `>=`); the score-80 `CONFIRMED` findings landed in **Findings** in the final report-input. The first-pass Leads placement was a DF-1 side effect, not a code off-by-one.

---

## Methodological corrections (so they don't recur)

1. **Build identity must come from artifacts, not inference.** Resolved by P0-A: every run now records its commit in `plugin_version` + `build_commit`. The prior "the run was on an older build" claim was unprovable and was applied inconsistently — it cannot selectively explain one finding while crediting others to current source.
2. **Verify postmortem claims against source/artifacts before triaging.** #3 was the cautionary case: accepted at face value it reads as a P0 data-integrity bug; verified against `findings.json` / `deduped-findings.json` it is a P2 bookkeeping issue.
3. **Content presence ≠ commit ancestry under squash/rebase merges.** A squash merge collapses a branch into one new commit and drops the source SHAs from the target's ancestry, so `git merge-base --is-ancestor <old-sha> HEAD` returns "false" for fully-merged work. Check presence by *content* (`git show <sha> --stat` + grep HEAD source, or `git cherry`), never by ancestry of a pre-squash SHA. (This retracted a false "branch divergence" flag: `6746f2b`'s out-of-scope-appendix content is present in HEAD as `collectOutOfScopeFindings` in `report-generator-tool.ts`, and the staging→main squash merge carried it into `main`.)
