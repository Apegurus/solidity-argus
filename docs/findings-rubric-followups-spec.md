# Findings-Rubric Follow-ups Spec

> **Date**: 2026-06-11
> **Branch**: `fix/findings-rubric-followups` (off `staging` after PR #5 merge `5e74b08`)
> **Evidence run**: dogfood audit `9757deb4-8fb6-4c01-9beb-4ac8c79181a8` (VulnerableVault, plugin `v0.7.0-dev`)
> **Goal**: Make the v0.7.0 "mega release" ship with no issues — close the gaps the dogfood exposed after PR #5.

---

## Executive Summary

PR #5 ("findings-rubric") shipped and was validated end-to-end in a live audit: the report pipeline now materializes artifacts on demand, propagates rubric verdict + confidence through dedup, splits Findings/Leads correctly, and assigns stable citable IDs — all without faking session teardown. Build identity was confirmed by behavioral differential against the cached `0.6.2` source and by the new `finding-id-map.json` artifact.

The same dogfood run exposed the remaining work. None of it is a PR #5 regression; most is pre-deferred scope that the live run proved is now release-blocking. Priority order:

1. **P0** — Dual-ID reconciliation so deduped lineage can go clean (no growing `missing=N`).
2. **P0** — Finalization gap: a warn-level-complete run must reach `run.finalized`.
3. **P1** — `argus_generate_report` regeneration ergonomics (stop the `force`+`revision` / duplicate-write retry burst).
4. **P1** — Per-`(sessionID, run_id)` audit-state isolation.
5. **P2** — Slither flag correctness; Scribe latency; stable-ID display gap; repo hygiene.

---

## What Shipped In PR #5 (baseline for this branch)

| Area | Change | Commit |
| --- | --- | --- |
| Live-audit reporting | `allowLiveAudit` preflight; `ensureRunArtifactsMaterialized` on-demand in `read_findings`/`persist_deduped`; finalizer completeness = warn-by-default | `67de6f8` |
| Rubric/confidence | dedup carries strongest `rubric_verdict` + max `confidence_score`, narrates from the adjudicated observation | `67de6f8` |
| Parity | report-input re-projected from events (no stale `missing=N` source) | `67de6f8` |
| Stable IDs | per-run `finding-id-map.json` registry; IDs survive revisions/insertions | `67de6f8` |
| #3 (partial) | phantom `observation_id` rejection enriched with per-id source diagnostics | `67de6f8` |
| Build identity | self-verifying startup banner (load dir + git sha + dirty) | `0b4a77d` |

Dogfood verification artifacts: `.argus/runs/9757deb4-…/` (`findings.json`, `deduped-findings.json`, `finding-id-map.json`) and reports `…-9757deb4.md` (r1) / `…-9757deb4-r2.md` (r2).

---

## P0-1: Dual-ID Reconciliation (the blocker)

**Problem**: Deduped lineage can never go clean because raw observations are minted under two ID schemes, and Scribe's deduped set references only one. The report carries a Completeness Warning that *grows* as more findings arrive.

**Evidence (run 9757deb4)**:
- r1: `Finding parity mismatch: missing=16`; r2: `missing=25`.
- Missing IDs are all `${toolCallId}:index` (e.g. `e79cf414-…:1 … :15`) and `ses_…:1`.
- `argus_check_patterns` and tool-tracking mint `${toolCallId}:${index}`; adapters use a `${runId}:${seq}:${hash}` fallback; Scribe deduped findings reference `obs-*`/issue-fingerprint hashes.
- The gap grew from 16→25 as 9 more `finding.added` events (seqs 124–132) landed after the first dedup.

**Affected code**:
- `src/hooks/tool-tracking-hook.ts` (observation-id minting `${toolCallId}:${index}`)
- `src/state/adapters.ts` (fallback id minting)
- `src/shared/lineage-validator.ts` (parity/lineage semantics)
- `src/tools/persist-deduped-tool.ts`, `src/tools/report-generator-tool.ts` (consumers)

**Required behavior** (pick one, prefer A):
- **A — Canonicalize minting**: a single deterministic `observation_id` scheme for every recorded observation regardless of source tool, so raw and deduped IDs reconcile by construction. Remove the `adapters.ts` fallback scheme. Preserve historical-artifact readability.
- **B — Auto-reconcile unreferenced auto-observations**: at dedup/report time, any raw observation not mapped and not explicitly dropped is auto-recorded as a `dropped_observation` (reason e.g. `auto-detector-noise`) so lineage is complete and the warning clears. Lower-risk, but leaves the dual ID space.

**Acceptance**: a live audit on VulnerableVault produces a report with **no** parity-mismatch Completeness Warning, and lineage is provable against `findings.json`.

**Watch out**: do not weaken the lineage validator to hide the gap — completeness must be provable, not suppressed.

**Resolution (implemented, `78676f4`)**: the root cause was narrower than dual-scheme minting. The report's completeness check validated deduped lineage against the *raw* `projectFindings(events)` universe, while `argus_persist_deduped` validated against the *deduped* `findings.json`. Observations collapsed by `dedupeFindingsForFinalOutput` (same `issue_fingerprint`) therefore surfaced as false `missing` ids. Fix: validate against the already-computed deduped `eventFindings` so both checks share one raw universe. The lineage validator is unchanged, so genuine gaps still surface (covered by a no-suppression regression test). The `${sessionId}:n` vs `${toolCallId}:n` ids reconcile correctly once both sides use the deduped universe — no minting change was required.

---

## P0-2: Finalization Gap

**Problem**: A run that generated a report and recorded Themis dispositions did **not** finalize. No `run.finalized` event was ever written.

**Evidence (run 9757deb4)**:
- `argus_themis_disposition` completed twice (seqs 166, 202); `argus_generate_report` succeeded once (seq 109).
- `run.finalized`: 0. `session.deleted`: false. Run ended at `session.idle` (seq 203).
- PR #5 made completeness a *warning* (not error), so finalize should not have been blocked by the `missing=N` warning.

**Affected code**:
- `src/create-hooks.ts` (`argus_themis_disposition` handler → `finalizeRun`; gated on `state.reportGenerated`)
- `src/features/persistent-state/run-finalizer.ts`
- `src/hooks/event-hook.ts` (session.idle finalize path)

**Investigate**: why `finalizeRun` did not run / did not emit `run.finalized` after the seq-202 disposition. Candidate causes: `state.reportGenerated` reset by the failed regenerations; disposition not classified "resolved"; orchestrator idled before the async finalize completed.

**Required behavior**: a run with an accepted (warn-level) completeness state and a resolved Themis disposition must reach `run.finalized` (status `finalized`) deterministically, with a regression test.

---

## P1-1: Report Regeneration Ergonomics

**Problem**: After the first report, Scribe attempted rapid regenerations that all failed, producing a machine-speed retry burst.

**Evidence (run 9757deb4)** — `generate_report` seqs 160/162/164, 5–7s apart:
- `argus_generate_report failed: force and revision must not both be set.`
- `argus_generate_report failed: Report … -r2.md already exists. Single-writer policy prevents duplicate writes.`

**Affected code**:
- `src/tools/report-generator-tool.ts` (`invalidRegenerationOptions`, single-writer/duplicate-write checks, `force`/`revision` handling)
- `src/agents/scribe-prompt.ts` (guidance on revisions — note the prompt half may belong to the OMO layer)

**Required behavior**:
- `revision >= 2` alone should produce the `-r{n}` file without requiring `force`, and `force`+`revision` should be a clear, non-fatal usage error that tells Scribe the correct call.
- Scribe prompt: regenerate only with an explicit `revision` bump; never retry a duplicate write.

---

## P1-2: Per-(sessionID, run_id) State Isolation (#9)

**Problem**: Audit state is keyed by `sessionID` only, allowing stale prior-session context to bleed into a new run. Oracle flagged this as "do before the next dogfood."

**Affected code**: `src/create-managers.ts`, session/audit-state managers, `src/create-hooks.ts` session→agent mapping.

**Required behavior**: key active audit state by `(sessionID, run_id)`; a new run in a reused session must not inherit a prior run's findings/phase. Add a stale-state guard + regression test.

---

## P2 / Backlog

| ID | Item | Evidence / Notes | Affected |
| --- | --- | --- | --- |
| #5 | Slither flags wrong | `--exclude-detectors` is invalid; use `--exclude` (detectors) + `--filter-paths <regex>` (paths) + `--exclude-dependencies` | `src/tools/slither-tool.ts:126-142` |
| #8 | Scribe latency 15–19 min | serial enrichment; add parallelization and/or progress messaging | scribe enrichment path |
| UI | Stable-ID display gap | r2 shows `[CRIT-2]` with no `[CRIT-1]` after CRIT-1's finding left — correct-by-design; decide compact-render vs leave | `src/tools/finding-id-registry.ts`, `report-generator-tool.ts` |
| HYG | Tracked forge cache churns | `tests/fixtures/vulnerable-vault/cache/solidity-files-cache.json` is tracked and is rewritten by audit `forge` runs; consider gitignoring | `.gitignore`, fixture |
| #7 | "category: unknown" routing warning | Not in this repo — OhMyOpenCode layer; file upstream | (external) |

---

## Pending Findings — Consolidated Backlog

Status of every root-caused defect from the investigation + dogfood:

| # | Defect | Status | Where |
| --- | --- | --- | --- |
| 1 | Live-audit reporting blocked ("Scribe stuck") | ✅ Fixed (PR #5) | `report-preflight`, `findings-materializer`, `run-finalizer` |
| 2 | Rubric/confidence dropped in dedup | ✅ Fixed (PR #5) | `finding-aggregation` |
| 4 | Stale `missing=N` from polluted report-input | ✅ Fixed (PR #5) | `report-generator-tool` |
| 6 | Citable-ID instability across revisions | ✅ Fixed (PR #5) | `finding-id-registry` |
| 3a | Phantom-ID rejection diagnostics | ✅ Fixed (PR #5) | `persist-deduped-tool` |
| 3b | Parity validated against the raw (un-deduped) projection → false `missing=N` | ✅ Fixed (this branch, `78676f4`) | report-generator-tool (validate against deduped `eventFindings`) |
| F | **Finalization gap (no run.finalized)** | ✅ Fixed (this branch, `161b992`) | create-hooks (event-stream finalize gate, not siloed `reportGenerated`) |
| E | **generate_report regeneration ergonomics** | ✅ Fixed (this branch, `a97cc75`) | report-generator-tool (prescriptive errors + structured `revision<2`), scribe-prompt |
| 9 | Session-state isolation (reused finalized session) | ✅ Fixed (this branch, `ade78f4`) | create-hooks (finalized-run stale guard) |
| 5 | Slither `--exclude-detectors` invalid | ⛔ P2 | slither-tool |
| 8 | Scribe latency | ⛔ Backlog | scribe enrichment |
| U | Stable-ID display gap (cosmetic) | ⛔ P3 | finding-id-registry |
| H | Tracked forge cache churn | ⛔ P3 hygiene | .gitignore |
| 7 | Model-routing warning | ↗ Upstream (OMO) | external |

---

## Release-Readiness Checklist (v0.7.0)

- [x] P0-1 parity: report validates deduped lineage against the deduped universe (matches `persist_deduped`). Verified clean against the real run-`9757deb4` event stream that previously showed `missing=25`.
- [x] P0-2 finalization: report + resolved disposition across sessions reaches `run.finalized` (regression test in `create-hooks.test.ts`).
- [x] P1-1 ergonomics: prescriptive regeneration errors; `revision<2` returns a structured error (no fatal throw); Scribe prompt documents the revision-bump workflow.
- [x] P1-2 isolation: a reused finalized session starts a fresh run (regression test in `create-hooks.test.ts`).
- [x] Full `bun test` green (1701 pass / 3 skip / 0 fail), `tsc --noEmit` clean, `biome check .` clean.
- [ ] Fresh **live** dogfood on VulnerableVault finalizes cleanly end-to-end (recorded-stream validation done; live agent-loop run still recommended before tag).
- [ ] Version bump `0.7.0-dev` → `0.7.0` and changelog.
- [ ] Revert global `~/.config/opencode/opencode.json` `solidity-argus` from the `file://` worktree path before release.
