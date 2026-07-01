# solidity-argus — Security & Correctness Remediation Plan

| | |
|---|---|
| **Date** | 2026-07-01 |
| **Base** | `origin/staging` @ `82d76a2` (feat(argus): skill-discovery + regex safety, SCVD schema-0.1, and pipeline conservation-gate hardening, #26) |
| **Worktree** | `/projects/argus-security-hardening` |
| **Branch** | `fix/security-hardening` (tracks `origin/staging`) |
| **Sources** | `[R1]` `.reviews/codebase-solidity-argus-2026-07-01.md` — FULL profile, core source (`src/**/*.ts` non-test + `scripts/*.ts`), 148 files / 27,218 LOC, 9 lenses × 14 batches → 373 findings.<br>`[R2]` `.reviews/codebase-argus-2026-07-01.md` — complementary FULL run over `src/state/`, `src/config/`, `src/cli/`, `src/utils/`, `tests/`, `.github/` (adds `reviewer-database` + `reviewer-dependency` specialists that R1 did not dispatch), 20 batches → 27 findings. |
| **Overall verdict** | **needs_significant_work** — defects concentrate at the exact trust boundaries a security-audit tool depends on. |
| **Execution status** | **PENDING USER APPROVAL** — this is a plan; implementation begins only on an explicit go-ahead. |
| **Merge target** | Default assumption: one PR `fix/security-hardening` → `origin/staging`, opened after the final re-audit gate. Confirm if you want per-phase PRs or a different base. |
| **Plan persistence** | ⚠️ Both `.reviews/` and `.omo/plans/` are gitignored, so this plan is **not** in git history. Commit it to a tracked path (e.g. `docs/remediation/`) if you want a durable record — not done automatically (no commit without an explicit request). |
| **Reviewed by** | Metis (pre-plan consultant) + Momus (plan critic), 2026-07-01 — see §11. Momus: ready to execute as-is; Metis: execute after the minor amendments now folded in below. |

> This is a **plan**, not an implementation. No source files under `src/` or `scripts/` have been modified. The two source reports are colocated in this worktree's `.reviews/` for self-containment (gitignored). Execute the workstreams **in the phase order below**; the Phase 0 modules are prerequisites for Phases 1–3, and the **WS-3 state-machine + Phase-0 API Oracle design review is itself a Phase-0 exit gate** (§3, §10).

---

## 1. Executive summary

Two independent reviews of the same tree converge on one story: `solidity-argus` is mature, broad, and heavily tested, but it has **recurring hard-edge defects at the boundaries where untrusted input meets privileged action** — untrusted project/agent/knowledge inputs, durable audit state, and external tool execution. Because this is itself a *security* tool, these are not cosmetic: they let a hostile audited repository read files outside the project, steer audit agents via injected prompt/Markdown, corrupt or silently drop audit evidence, or make a failed run report success.

### Merged finding inventory

| Source | Critical | High | Medium | Low | Info | Total |
|---|---:|---:|---:|---:|---:|---:|
| `[R1]` solidity-argus (core-source, full rigor) | 0 | 27 | 206 | 136 | 4 | 373 |
| `[R2]` argus (state/config/test/CI complement) | 0 | 6 | 13 | 8 | 0 | 27 |
| **Cross-report duplicate** (report-generator-tool.ts:2133) | — | −1 | — | — | — | — |
| **Unique high-severity (dedup-verified)** | **0** | **32** | — | — | — | — |

Medium/low totals across the two runs are **not** fully cross-deduplicated (R2's state/config/test surfaces barely overlap R1's core-source scope); treat `~219 medium / ~144 low` as an upper bound. The high-severity set was dedup-verified by `file:line`: the only overlap is the out-of-scope report-count finding, which appears in **both** runs and is therefore the single most cross-validated defect in the codebase.

### Strategy thesis — fix the boundary, not the 400 call sites

The synthesis of `[R1]` is explicit and `[R2]` reinforces it: **the same root cause recurs as ad-hoc, per-module string checks instead of one canonical boundary.** The plan therefore front-loads a small set of **hardened shared boundary modules** (Phase 0), then routes every existing call site through them (Phase 1+). This closes the most findings per unit of effort, prevents the defect class from silently reappearing, and gives the regression suite a single, testable seam. Patching each of the 32 highs in place would be slower, leave the medium/low tail open, and invite drift.

**Net line-reduction opportunity surfaced by the reviews:** `~−1028 LOC [R1]` + `~−141 LOC [R2]` (0 removable dependencies) — realized in Phase 4, not by weakening behavior but by removing duplication, dead code, and oversized mixed-responsibility modules.

---

## 2. Root-cause clusters → workstreams

Nine workstreams map 1:1 onto the eight cross-batch clusters from the `[R1]` synthesis plus one enabling coverage/maintainability stream. Every high-severity finding lands in exactly one **primary** workstream.

| WS | Workstream | Synthesis cluster | New/changed shared surface | Unique highs closed |
|---|---|---|---|---:|
| **WS-1** | Filesystem containment & path-component validation | Cluster 1 | **new** `src/shared/path-safety.ts` | 7 |
| **WS-2** | Untrusted content → never privileged prompt/Markdown | Cluster 2 | **new** `src/shared/untrusted-content.ts` | 3 |
| **WS-3** | Audit-state durability & lifecycle | Cluster 3 | sink/session/finalizer lifecycle | 10 |
| **WS-4** | Tool success/error contracts | Cluster 4 | shared scoped report model + result envelope | 4 |
| **WS-5** | Canonical finding identity & lineage | Cluster 5 | finding-store / schema migration / hashing | 3 |
| **WS-6** | Global resource limits | Cluster 6 | caps helper + call-site budgets | 0 (mediums) |
| **WS-7** | External process policy | Cluster 7 | **new** `src/shared/process-runner.ts` | 4 |
| **WS-8** | Config/schema trust boundaries | Cluster 8 | hardened `deepMerge` + schema refinements | 1 |
| **WS-9** | Regression coverage, de-dup, hermeticity | Cluster 9 + R2 maint. | tests + module splits + CI | 0 (enabling) |
| | | | **Total unique highs** | **32** |

*(WS totals sum to 32; several highs are touched by a second workstream — e.g. `report-generator-tool.ts:1005` is closed by WS-1 containment but its injection aspect is hardened by WS-2, and `tool-tracking-hook.ts:658` orphan buffers is durability (WS-3) with a resource-cap (WS-6) aspect. Each is counted once, under its primary WS.)*

---

## 3. Phased roadmap

Dependency order is load-bearing: you cannot route a call site through a boundary module that does not exist yet.

```
Phase 0  Foundational boundary modules ─────────────┐  (prereq for 1,2,3)
  path-safety.ts · untrusted-content.ts ·           │
  process-runner.ts · deepMerge hardening           │
                                                     ▼
Phase 1  Route call sites + tool contracts (WS-1/2/7/8 migration, WS-4)
                                                     │
                    ┌────────────────────────────────┤ (WS-3 starts after Phase-0 Oracle gate — §3/§11)
                    ▼                                 ▼
Phase 2  Durability & lifecycle (WS-3) + Finding identity (WS-5)
                                                     │
                                                     ▼
Phase 3  Global resource limits (WS-6)
                                                     ▼
Phase 4  Regression coverage + de-dup + hermeticity (WS-9)
```

| Phase | Goal | Workstreams | Exit gate |
|---|---|---|---|
| **0** | Build the hardened seams (no call-site migration yet) | WS-1, WS-2, WS-7 module cores; WS-8 deepMerge | New modules exist with unit tests, including the **verified** `deepMerge` prototype-pollution PoC as a locking test. `bun test` (full existing suite) + `tsc`/lsp clean. **Oracle design review of the WS-3 sink/session/finalizer state machine AND the four Phase-0 module public APIs is completed and approved here — before any WS-3 code or call-site migration begins.** |
| **1** | Route every existing site through the seams; fix the report-generator contract | WS-1, WS-2, WS-7, WS-8 migration; WS-4 | All highs **except** the WS-3/WS-5 durability set are closed with a locking test each. Boundary tests (symlink escape, `..`/separator run IDs, injected project name, arbitrary-host SCVD, unpinned npx) are red-before/green-after. |
| **2** | Repair durable audit state and finding identity | WS-3, WS-5 | Durability highs closed; replay-determinism, sink-eviction-safety, recovery-rebind, and schema read-compat tests green. Implementation **conforms to the Phase-0-approved state-machine design** (no ad-hoc lifecycle changes); schema migration is copy-on-read (WS-5). |
| **3** | Bound every unbounded input | WS-6 | Byte/count/time caps enforced with tests on the largest surfaces (report source reads, pattern/skill scans, remote responses, forge stdout, orphan buffers, global indexes). |
| **4** | Lock behavior with tests, cut the fat, make CI hermetic | WS-9 | Adversarial/lifecycle/parser/prompt/CLI/ingestion regression tests added; oversized modules split; dead code removed; CI Bun pinned; tests hermetic. Net `−1028/−141 LOC` realized. |

**Re-audit gate (final):** re-run both review profiles against `fix/security-hardening`; every one of the 32 highs must be **closed with a named locking test**, and no new high may be introduced by the refactor.

---

## 4. Workstream detail

Each workstream lists its root cause, the concrete shared fix (with an API sketch grounded in the real symbols named by the findings), the highs it closes, acceptance criteria + locking tests, effort (T-shirt), and dependencies.

### WS-1 — Filesystem containment & path-component validation  ·  effort **L**  ·  deps: none (Phase 0)

**Root cause.** Run IDs, session IDs, `finding.file`, `customSkillsDir`, Forge targets, and report/event payload paths reach `fs`/`spawn` through **lexical** normalization or bare `path.join`. The existing `isPathInsideDirectory`/`path-containment` guard is purely lexical and does **not** resolve symlinks, so an in-repo symlink to an external directory passes it (consensus **6/9** — the highest-consensus finding in the review).

**Shared fix — `src/shared/path-safety.ts`:**
```ts
// canonicalizes root and the nearest-existing ancestor of child via realpath,
// then verifies containment; lexical ".." check remains a cheap first pass.
export function assertContained(root: string, child: string): string        // returns canonical path or throws
export function isContained(root: string, child: string): boolean
// strict safe-identifier alphabet; rejects separators, "..", NUL, absolute, empty.
export function validateRunId(id: string): string
export function validateSessionId(id: string): string
// Forge/analysis target: default to projectRoot, assertContained for supplied targets,
// constrain match_path to an in-project relative path.
export function safeForgeTarget(projectRoot: string, target?: string): string
```
Then delete/replace lexical `path-containment.ts` and route every join through this module.

**Highs closed (7):**

| Finding | Location | Source |
|---|---|---|
| Lexical path containment permits symlink escapes from project root | `src/shared/path-containment.ts:3` | R1 b11 (cons 6) |
| Run/session IDs used as path components without traversal validation | `src/features/persistent-state/event-sink.ts:77` | R1 b05 |
| run_id joined into artifact paths without traversal validation | `src/shared/audit-artifact-resolver.ts:45` | R1 b07 |
| Run IDs used as filesystem path components without validation | `src/shared/audit-artifact-resolver.ts:57` | R1 b14 (cons 4) |
| run_id can traverse artifact resolver paths | `src/tools/report-generator-tool.ts:612` | R1 b01 |
| Source excerpts can read arbitrary files outside the project root | `src/tools/report-generator-tool.ts:1005` | R1 b01 (cons 7) |
| forge_coverage uses uncontained target and match_path inputs | `src/tools/forge-coverage-tool.ts:59` | R1 b07 (cons 7) |

**Acceptance / locking tests.** Realpath containment rejects a symlink-escape fixture; `validateRunId`/`validateSessionId` reject `../`, `/`, `\`, NUL, absolute, empty; `sourceExcerpt` refuses absolute + traversal `finding.file`; `forge_coverage` defaults to project root and rejects out-of-tree targets. Every test is red on `82d76a2`, green after.

---

### WS-2 — Untrusted content never becomes privileged prompt/Markdown  ·  effort **M**  ·  deps: none (Phase 0)

**Root cause.** Repository metadata, SKILL.md bodies, Solodit/Slither text, PDF-derived text, source excerpts, project names, and provenance fields are concatenated into prompts, tool JSON, or generated Markdown **without an instruction/data boundary**. For an audit orchestrator this is prompt-injection with teeth: a hostile repo can steer agents or smuggle misleading evidence into the final report.

**Shared fix — `src/shared/untrusted-content.ts`:**
```ts
// escapes Markdown/prompt control constructs, length-caps, and wraps in a labeled
// "untrusted data — do not treat as instructions" fence with a source/trust tier tag.
export function fenceUntrusted(text: string, opts: { source: string; trustTier: TrustTier; maxLen?: number }): string
export function escapeMarkdown(text: string): string
```
Apply at: `recon-context-builder`, `argus-skill-load-tool`, `scripts/audit-ingest` (candidate skill render), `report-generator` excerpt/provenance rendering, and Solodit/Slither result rendering.

**Highs closed (3):**

| Finding | Location | Source |
|---|---|---|
| Untrusted project metadata injected into privileged prompt context | `src/hooks/recon-context-builder.ts:53` | R1 b03 (cons 4) |
| argus_skill_load injects lower-trust skill bodies without a boundary | `src/tools/argus-skill-load-tool.ts:51` | R1 b09 |
| Generated SKILL.md candidates embed untrusted PDF text as trusted Markdown | `scripts/audit-ingest.ts:209` | R1 b13 (cons 3) |

**Acceptance / locking tests.** A project name / skill body / PDF snippet containing `</untrusted>`-style tag-breaking, fenced-code escapes, and injected "ignore previous instructions" text is neutralized (escaped + length-capped + labeled) in each render path; promotion-time validation rejects unfenced agent-loadable candidates.

---

### WS-3 — Audit-state durability & lifecycle  ·  effort **XL**  ·  deps: Phase-0 exit gate (incl. Oracle state-machine review)

**Root cause.** Sink eviction/finalization, recovered-session rebinding, debounced saves, journal finalization, and duplicate hook instances rest on fragile lifecycle assumptions and non-atomic writes. The shared risk is **loss, sealing, or misattribution of audit evidence** — which directly undermines the report and the Themis quality gate. This is the largest and subtlest workstream.

**Shared fix.** Reference-count/owner-track sinks so eviction never finalizes a live-referenced run; make session delete/evict `await debouncedSave.flush()` before dispose; fail activation (keep retryable/degraded) when sink init fails; do **not** rebind recovered runs to a fresh run id — preserve `sessionId`/`startTime` or migrate artifacts explicitly; only seal **successful** finalizations and model failed finalization as recoverable; guard teardown of unactivated sessions; verify a durable sink exists **before** mutating live state in `record_finding`.

**⚠️ Do not implement the 10 fixes in listed order — they form one state machine and interact.** The Oracle design review (Phase-0 gate) fixes the canonical order; known dependencies: reference-counting (#11) must land before flush-on-delete (#12) and before eviction can be made safe; sink-existence-before-mutate (#16) depends on the graceful sink-init-failure path (#15) so the "no sink" state is representable; recovered-id preservation (#14) must be reconciled with the `reportGenerated` guard (#13) so a recovered post-report session is neither discarded nor rebound. Treat the R2 **uncertain** finding (`audit-state-manager.ts:162`) as verify-in-source-first: confirm the stale-state impact against the actual projector/repair code before writing a fix.

**Highs closed (10):**

| Finding | Location | Source |
|---|---|---|
| Bounded sink eviction can finalize sinks still referenced by live sessions | `src/hooks/bounded-sink-registry.ts:45` | R1 b02 (cons 2) |
| Deleting/evicting a session discards pending debounced state saves | `src/hooks/session-state-registry.ts:26` | R1 b02 (cons 3) |
| reportGenerated recovery guard discards active post-report state | `src/hooks/session-activation.ts:153` | R1 b03 |
| Recovered audit state is rebound to a fresh run id | `src/hooks/session-activation.ts:167` | R1 b03 (cons 2) |
| Sink init failure swallowed but session still marked activated | `src/hooks/session-activation.ts:196` | R1 b03 |
| record_finding mutates live state before proving a durable sink exists | `src/hooks/tool-tracking-hook.ts:449` | R1 b02 (cons 2) |
| Orphan event buffers never pruned for sessions that never flush | `src/hooks/tool-tracking-hook.ts:658` | R1 b02 (cons 3) |
| Failed finalization still permanently seals the event sink | `src/features/persistent-state/run-finalizer.ts:469` | R1 b05 (cons 2) |
| Report finalization gates consume metadata the event never emits | `src/features/persistent-state/run-finalizer.ts:101` | R1 b05 |
| Session deletion can archive global state for unactivated sessions | `src/create-hooks.ts:415` | R1 b11 |

**Also folds in (mediums):** replay renumbering can change primary-finding selection (`event-sink.ts:103` R2), missing snapshot stamps treated as no-mismatch (`audit-state-manager.ts:162` R2 uncertain), `projectors.ts` replay mediums (R1).

**Acceptance / locking tests.** Evicting a live-referenced sink is refused/deferred; delete-with-pending-save flushes before dispose (no lost findings); activation with a failing sink is not marked success and is retryable; recovered run keeps its original id/journal; a run that fails quality gates can still record remediation + Themis disposition + a regenerated report; `record_finding` with no durable sink does not leave state/journal inconsistent.

---

### WS-4 — Tool success/error contracts  ·  effort **M**  ·  deps: Phase 0 (WS-1 for the scoped model paths)

**Root cause.** Tools treat partial parses, nonzero exits, malformed events, missing sinks, stale syncs, and warning-only preflight as usable *success*. Downstream agents and the report gate key off machine-readable flags more than human-visible caveats, so a failed run can certify green.

**Shared fix.** Build **one scoped report model** and derive rendered Markdown, returned counts, and quality gates from it (kills the count/scope contradiction). Introduce a result envelope that distinguishes `success | partial | warning | failure` with machine-readable fields; `execute` throws or returns a tool-level error when `result.error` is set, reserving embedded errors for recoverable warnings.

**Highs closed (4):**

| Finding | Location | Source |
|---|---|---|
| Tool returns success payload even when result.error means no report was written | `src/tools/report-generator-tool.ts:2374` | R1 b01 |
| Returned counts & quality gates include out-of-scope findings the report excludes | `src/tools/report-generator-tool.ts:2133` | **R1 b01 + R2** (cross-validated) |
| Report filename default path drifts from configured output_dir | `src/tools/report-generator-tool.ts:2204` | R2 |
| Incremental SCVD sync treats equal counts as current, leaves stale metadata | `src/knowledge/scvd-sync.ts:182` | R1 b10 (cons 4) |

**Acceptance / locking tests.** A write failure/policy refusal surfaces as a tool-level error (not success); rendered counts == returned counts == gate inputs for a mixed in/out-of-scope fixture; returned `filename` equals the actual written path under configured `reporting.output_dir`; SCVD sync refreshes metadata on no-op and forces full sync when the local index is stale.

---

### WS-5 — Canonical finding identity & lineage  ·  effort **L**  ·  deps: Phase 0

**Root cause.** Finding identity, dedupe keys, severity/confidence reconciliation, provenance, and dropped-observation semantics differ between recording, projection, aggregation, persistence, reporting, and prompts — producing duplicate splitting, evidence loss, and false demotion/confirmation. Plus a strict `schema_version` reject with **no** migration path can make persisted journals unreadable after upgrade.

**Shared fix.** One canonical schema for dedupe keys / confidence-rubric reconciliation / provenance / `dropped_observations` / evidence merging, consumed by `FindingStore`, adapters, fingerprints, projectors, persist/read tools, report generation, Scribe, and Themis. Add supported-version **read compatibility / migration** before strict current-version validation. Hash the object with stable key-sorting (not pre-stringified JSON). Preserve append order (immutable append index) as the replay tiebreaker.

**Highs closed (3):**

| Finding | Location | Source |
|---|---|---|
| Hydration dedup only keys on persisted id (ID-scheme change duplicates findings) | `src/state/finding-store.ts:55` | R2 |
| hasFinding does not normalize absolute paths like addFinding | `src/state/finding-store.ts:92` | R2 |
| Schema version hard-reject has no migration path | `src/state/schemas.ts:458` | R2 |

**Also folds in (mediums):** content_hash hashes pre-stringified JSON (`findings-materializer.ts:76` R2), replay renumber tiebreaker (`event-sink.ts:103` R2), `finding-aggregation.ts` (6 mediums R1), `projectors.ts` (7 mediums R1).

**Acceptance / locking tests.** Hydrating a journal written under an old id scheme dedupes logically-identical findings; `hasFinding(absPath)` matches an entry stored by `addFinding`; a journal at a prior `schema_version` replays via migration instead of hard-reject; equal findings in different insertion order hash equal. **Migration is copy-on-read — the original journal is never mutated in place; a migration/parse failure leaves the original intact and surfaces a typed `MigrationError` rather than a partial write.** Test with a fixture journal at the prior `schema_version` (happy path) and a deliberately corrupt one (original preserved, typed error).

---

### WS-6 — Global resource limits  ·  effort **M**  ·  deps: Phases 0–2 (cap the migrated paths)

**Root cause.** Inputs from projects, remote knowledge sources, PDFs, skills, tool stdout, orphan events, global indexes, and background tasks are buffered/retained without byte/count/time caps — a DoS class for long audits and adversary-controlled repos.

**Shared fix.** A small caps helper + explicit budgets at each site: source-excerpt bytes, project-config read size, pattern/skill corpus scan count + time, SCVD/PDF/Solodit response size, Forge stdout/stderr caps, orphan-buffer global cap + TTL sweep, global run-index compaction, background-task retention bound.

**Highs closed:** none directly (the orphan-buffer high is counted in WS-3). This is a broad **medium** sweep — ~33 security + a share of the 110 correctness mediums live here.

**Also folds in:** pattern checker scans `lib`/`node_modules`/`.git`/`out` without exclusion (`pattern-checker-tool.ts:202` R2).

**Acceptance / locking tests.** Oversized project file / remote response / forge stdout is truncated with a machine-readable "capped" flag rather than buffered unbounded; orphan buffers are cleared on `session.deleted` and swept by TTL; pattern scan excludes dependency/build dirs by default.

---

### WS-7 — External process policy  ·  effort **M**  ·  deps: none (Phase 0)

**Root cause.** Forge, Slither, Solodit, doctor probes, and parser subprocesses mix bare binaries, ignored configured paths, inherited environments, absent timeouts, and brittle arg construction. No single process-runner policy exists.

**Shared fix — `src/shared/process-runner.ts`:** always use configured Slither/Forge paths; minimal **env allowlist** (no inherited secrets); default timeouts; stdout/stderr caps; harden path/flag-shaped args; SCVD **host allowlist** (reject loopback/link-local/private by default); pin/bundle or disable-by-default the unpinned `npx` Solodit auto-install; make companion clone/sync **explicit/lazy** and injectable for tests.

**Highs closed (4):**

| Finding | Location | Source |
|---|---|---|
| Solodit MCP auto-installed via unpinned npx with full inherited environment | `src/solodit-lifecycle.ts:59` | R1 b08 (cons 2) |
| Project config can redirect SCVD auto-sync fetches to arbitrary hosts | `src/hooks/knowledge-sync-hook.ts:37` | R1 b03 |
| Contract profiling ignores configured forgePath | `src/utils/solidity-parser.ts:148` | R1 b10 |
| Config handler triggers background network I/O during plugin registration | `src/hooks/config-handler.ts:249` | R2 |

**Also folds in (mediums):** Slither fallback broad speculative triggers (`slither-tool.ts:144` R2), doctor probes ignore configured paths (`doctor.ts` R1 mediums).

**Acceptance / locking tests.** Subprocess spawns with configured paths + allowlisted env + default timeout + stdout cap; SCVD sync rejects a loopback/private host from project config; plugin registration performs **no** network I/O (clone/sync is lazy + injectable); parser uses resolved `forgePath`.

---

### WS-8 — Config/schema trust boundaries  ·  effort **S**  ·  deps: none (Phase 0)

**Root cause.** Prototype-polluting deep merge, permissive `disabled_hooks`, union array-merge that blocks project override, JSONC fallback masking, and divergent frontmatter parsing make behavior depend on *where* data enters rather than one validated schema.

**Shared fix.** In `deepMerge`: reject `__proto__`/`constructor`/`prototype`, use null-prototype merge targets, `Object.hasOwn` in loader recovery (**verified PoC** in prior analysis: `_mergeConfigs(null, {"__proto__": {...}})` returns a polluted object). Validate `disabled_hooks` against canonical hook names; give project-level `disabled_hooks` replacement (last-wins) semantics. Make JSONC parse errors visible. Validate projector/event numeric ranges + schema versions. Standardize on one YAML frontmatter parser.

**Highs closed (1):**

| Finding | Location | Source |
|---|---|---|
| `__proto__` config keys can inject inherited settings into merged config | `src/shared/deep-merge.ts:64` | R1 b14 (cons 4) |

**Also folds in:** array-merge blocks project override of `disabled_hooks` (`deep-merge.ts:52` R2), `disabled_hooks` accepts arbitrary strings (`schema.ts:95` R2), threshold duplicated across config/validation/prompt (`schema.ts:37` R2, low → see WS-9).

**Acceptance / locking tests.** The prototype-pollution PoC is a **red-before/green-after** unit test; a project `disabled_hooks: []` re-enables a user-disabled hook; an unknown hook name warns; malformed JSONC fails loudly instead of silently falling back.

---

### WS-9 — Regression coverage, de-duplication & hermeticity  ·  effort **L**  ·  deps: runs alongside every phase (lock) + a Phase-4 sweep

**Root cause.** High-risk branches (adversarial path, Markdown, lifecycle recovery, persistence failure, parser drift, prompt invariant, CLI diagnostic, ingestion failure) lack regression coverage; several modules are oversized/duplicated; some tests are non-hermetic.

**Shared fix.** (a) Each WS-1..WS-8 fix ships with its locking test (TDD). (b) Phase-4 sweep: split `pattern-loader.ts` (985 LOC — extract regex-safety/parsing) and the oversized `report-generator-tool.ts`; remove duplication (forge-test coverage path now owned by `forge-coverage-tool`; unused `select`/`text` TUI helpers; trivial `smoke.test.ts`; stale `coverage_out.txt`); fix ABI-mutability-as-visibility mislabel (`solidity-parser.ts:237`); collapse the duplicated refutation rubric to a single pointer (`refutation-rubric-instructions.ts:23`); export one confidence-threshold constant (`schema.ts:37`); pin CI Bun (`.github/workflows/ci.yml:36`); make integration/CLI tests hermetic (`mkdtemp` fixtures, stub command handlers).

**Findings folded in (R2 maintainability/testing, R1 net-reduction tail):** `pattern-loader.ts:11`, `forge-test-tool.ts:44`, `tui-prompts.ts:27`, `smoke.test.ts:1`, `coverage_out.txt:1`, `solidity-parser.ts:237`, `refutation-rubric-instructions.ts:23`, `session-activation.ts:30` (missing tests), `full-audit.test.ts:18` (shared fixture state), `cli-program.test.ts:126` (side-effecting registration tests), `ci.yml:36`, plus the `~−1028/−141 LOC` reduction tail.

**Acceptance / locking tests.** The adversarial-boundary suite from WS-1/2/7/8 exists and is green; integration tests use isolated `mkdtemp` roots; CLI registration tests use stubs (no real `doctor`/`init`/`install`); CI pins `bun-version`; `bun test` + `tsc` green; net LOC reduced without behavior change (existing suites still pass).

---

## 5. High-severity remediation matrix (all 32, grouped by workstream)

> Fix column condensed from each finding's `suggested_fix_direction`. `[cons N]` = number of independent first-pass reviewers who raised it.

**WS-1 — Path containment (7)**
1. `path-containment.ts:3` — realpath-canonicalize root + nearest ancestor, reject symlink escape; keep lexical `..` as first pass. `[cons 6]`
2. `event-sink.ts:77` — `validateRunId` before every runId-derived join. `[R1]`
3. `audit-artifact-resolver.ts:45` — strict safe alphabet + assert `runDir` under `writeRoot(projectDir)/runs`. `[R1]`
4. `audit-artifact-resolver.ts:57` — conservative runId regex + assert resolved path under intended root. `[cons 4]`
5. `report-generator-tool.ts:612` — validate `run_id` at boundary; reject separators/`..`. `[R1]`
6. `report-generator-tool.ts:1005` — resolve `finding.file` against `projectDir`; refuse absolute/traversal before stat/read. `[cons 7]`
7. `forge-coverage-tool.ts:59` — shared Forge target normalizer (default projectRoot, `assertContained`, in-project `match_path`). `[cons 7]`

**WS-2 — Untrusted-content boundary (3)**
8. `recon-context-builder.ts:53` — encode/escape + length-cap project-derived values; label untrusted. `[cons 4]`
9. `argus-skill-load-tool.ts:51` — fence non-bundled skill bodies; surface trust tier/source warnings. `[R1]`
10. `scripts/audit-ingest.ts:209` — render extracted text as quoted/provenance-labelled data; escape Markdown; promotion-time validation. `[cons 3]`

**WS-3 — Durability & lifecycle (10)**
11. `bounded-sink-registry.ts:45` — reference-count/owner-track; finalize only when unreferenced. `[cons 2]`
12. `session-state-registry.ts:26` — async delete/evict awaiting `debouncedSave.flush()`. `[cons 3]`
13. `session-activation.ts:153` — use sink/run finalization or explicit disposition, not `reportGenerated` alone. `[R1]`
14. `session-activation.ts:167` — preserve recovered `sessionId`/`startTime` or migrate artifacts. `[cons 2]`
15. `session-activation.ts:196` — do not mark activated on sink-setup failure; keep retryable/degraded. `[R1]`
16. `tool-tracking-hook.ts:449` — verify sink before mutating; roll back appended findings if durability unproven. `[cons 2]`
17. `tool-tracking-hook.ts:658` — `clearOrphanEvents` on `session.deleted` + global cap/TTL sweep. `[cons 3]`
18. `run-finalizer.ts:469` — seal only successful finalizations; model failure as recoverable. `[cons 2]`
19. `run-finalizer.ts:101` — persist normalized report metadata in the `argus_generate_report` completed event. `[R1]`
20. `create-hooks.ts:415` — mirror `activatedSessions` guard in `safeEventHook` finally before archive cleanup. `[R1]`

**WS-4 — Tool contracts (4)**
21. `report-generator-tool.ts:2374` — throw/return tool-level error on `result.error`; embedded errors only for recoverable warnings. `[R1]`
22. `report-generator-tool.ts:2133` — centralize threshold/scope/tier projection; one in-scope set for render + gates + counts. `[R1+R2]`
23. `report-generator-tool.ts:2204` — compute canonical filename from loaded `reporting.output_dir` / after final path resolution. `[R2]`
24. `scvd-sync.ts:182` — compare `last_updated`/revision/content-hash; refresh metadata on no-op; force full sync when stale. `[cons 4]`

**WS-5 — Finding identity (3)**
25. `finding-store.ts:55` — dedupe hydrated findings by normalized content or normalize ids on hydration. `[R2]`
26. `finding-store.ts:92` — normalize `hasFinding` file args through `normalizeStorePath`. `[R2]`
27. `schemas.ts:458` — supported-version read compatibility / migrate event payloads before strict validation. `[R2]`

**WS-7 — Process policy (4)**
28. `solodit-lifecycle.ts:59` — pin/bundle MCP package + minimal env allowlist. `[cons 2]`
29. `knowledge-sync-hook.ts:37` — allowlist/pin SCVD host; reject private/link-local/loopback. `[R1]`
30. `solidity-parser.ts:148` — thread resolved forge binary through `extractContractInfo`/`spawnForgeInspect`. `[R1]`
31. `config-handler.ts:249` — make companion sync explicit/lazy; inject clone/sync for tests. `[R2]`

**WS-8 — Config/schema (1)**
32. `deep-merge.ts:64` — reject dangerous keys, null-prototype merge targets, `Object.hasOwn` in loader recovery. `[cons 4]` *(verified PoC)*

---

## 6. Medium / low backlog (themed)

The 32 highs are the merge/gate blockers. The `~219 medium / ~144 low` tail is **not** re-listed here — it lives in the two source reports — but it clusters cleanly and is mostly **absorbed by the same nine workstreams** once the shared seams exist. **Scope for this execution:** close all 32 highs **plus** the "highest-value mediums" called out below (they ride their owning workstream, no separate pass). The remaining medium/low tail is **out of scope for this branch** and should be filed as a follow-up tracking issue rather than expanded here — this keeps the PR reviewable and prevents scope creep. Distribution from `[R1]` (`consolidated.json`):

| Medium by category (206) | n | | Low by category (136) | n |
|---|---:|---|---|---:|
| correctness | 110 | | maintainability | 55 |
| security | 33 | | correctness | 33 |
| api-contract | 24 | | testing | 18 |
| testing | 16 | | api-contract | 10 |
| performance | 8 | | performance / architecture / security | 7/6/6 |
| maintainability / architecture | 5/4 | | observability | 1 |

**Medium file hotspots (top):** `report-generator-tool.ts` (11), `tool-tracking-hook.ts` (10), `slither-tool.ts` (9), `pattern-checker-tool.ts` (8), `projectors.ts` (7), `solidity-parser.ts` (7), `finding-aggregation.ts` (6), `argus-skill-resolver.ts` (6), `create-hooks.ts` (6), `doctor.ts` (6).

**Highest-value mediums to pull forward** (do them inside the owning WS, not as a separate pass): the `report-generator`/`tool-tracking`/`slither`/`pattern-checker` correctness+security mediums (WS-4/WS-6), `projectors`/`finding-aggregation` lineage mediums (WS-5), and `argus-skill-resolver` frontmatter/precedence mediums (WS-2/WS-8). The `api-contract` mediums (24+10) are largely the same "success/partial/warning/failure" clarification as WS-4 and should ride that envelope. Low-severity `maintainability` (55) is the bulk of the Phase-4 LOC reduction.

---

## 7. Engineering standards for every fix

- **TDD lock, red-before-green.** No high is "closed" without a named regression test that fails on `82d76a2` and passes after. Boundary tests use adversarial fixtures (symlink escape, `..` ids, injected project names, prototype-pollution config, arbitrary SCVD host, unpinned npx).
- **No gaming.** Tests pass as a consequence of correct behavior — no hard-coded expected values, no special-casing to satisfy a gate, no deleting failing tests.
- **No type-safety escapes.** No `as any` / `@ts-ignore` / `@ts-expect-error`. Parse-don't-validate at the new boundaries; Zod at config edges.
- **Smallest correct change.** Bug fix ≠ refactor. Duplication > premature abstraction, *except* where the review proves the abstraction (the four Phase-0 modules) removes a whole defect class.
- **Respect the maintenance guardrails** in `AGENTS.md`: single source of truth for cross-agent rules; eval-as-guardrail not prompt-as-guardrail; don't generalize from N=1; detection rules only in `vulnerability-pattern` skills.
- **LOC reduction is a deliverable** (`~−1028/−141`), realized in Phase 4 by deletion/splitting — never by weakening a security check. Any deletion that removes an error-handling branch or reduces test coverage requires an explicit commit-message justification (the full-suite gate in §8 guards against silently dropping tests).

---

## 8. Verification & exit gates

| Level | Gate |
|---|---|
| Per fix | Locking test red→green; `tsc`/lsp clean on changed files. |
| Per phase | The **full existing** `bun test` suite green (not only the new locking tests — this is the silent-regression guard when routing call sites through the new seams); phase exit criteria in §3 met; no new high introduced. |
| Boundary suite | Adversarial fixtures for WS-1/2/7/8 all green. |
| **Final re-audit** | Re-run both review profiles on `fix/security-hardening`; **all 32 highs closed with a named test**; medium/low tail materially reduced; net LOC reduction realized; build + full suite green. |

---

## 9. Effort & sequencing summary

| Phase | Workstreams | Effort | Rationale |
|---|---|---|---|
| 0 | WS-1/2/7 module cores + WS-8 deepMerge | M–L | Small surface, highest leverage; unblocks everything. |
| 1 | WS-1/2/7/8 migration + WS-4 | L | Mechanical once seams exist; closes ~20 highs. |
| 2 | WS-3 (**XL**) + WS-5 (L) | XL | Event-sourcing subtlety; implements the **Phase-0-approved** state-machine design (the Oracle review is a Phase-0 gate — §3/§11 — not here). |
| 3 | WS-6 | M | Caps sweep across migrated paths. |
| 4 | WS-9 | L | Regression suite + de-dup + CI/test hermeticity. |

WS-3 dominates risk and effort; everything else is comfortably parallelizable behind Phase 0.

---

## 10. Risks & recommended consultations

- **WS-3 lifecycle state machine is the sharp edge.** The fixes interact (seal-on-success vs. recoverable-failure vs. eviction vs. rebind vs. flush-on-delete). Get an **Oracle architecture review of the sink/session/finalizer state machine and the four Phase-0 module APIs — as a Phase-0 exit gate, before any WS-3 or call-site code** (§3, §11) — this is exactly the multi-system-tradeoff case Oracle exists for.
- **Don't over-fix the contracts.** Several WS-4/api-contract items are *contract clarifications* (return a typed error, share one scoped model), not rewrites. Keep them minimal.
- **Schema migration (WS-5) touches persisted user data.** Ship read-compat + a migration, never a silent format change; add a fixture journal at the prior `schema_version`.
- **Process policy (WS-7) can break environments if over-tightened.** The env allowlist and host allowlist need escape hatches via existing config (`tools.slitherPath`/`forgePath`, SCVD `apiUrl`) — respect configured values rather than hard-coding.
- **Coverage gaps are themselves a finding (Cluster 9).** Treat the WS-9 regression suite as non-optional; it is what prevents this defect class from silently returning.

---

## 11. Execution governance (added after Metis + Momus review)

- **Approval gate.** This plan does not authorize implementation. Begin Phase 0 only on an explicit "go" from the user. (Momus judged the plan executable as-is; Metis asked for this gate — folded in.)
- **Branch & PR workflow (default).** Keep `fix/security-hardening` as the single working branch; open **one** PR → `origin/staging` after the final re-audit gate. The PR description references this plan and lists all 32 closed highs with their locking-test names. Say so if you'd prefer per-phase PRs.
- **Plan persistence.** `.reviews/` and `.omo/plans/` are both gitignored; this plan is not in git history. If you want it durable, commit it to a tracked path (e.g. `docs/remediation/`) — not done automatically (no commit without an explicit request).
- **Oracle is a Phase-0 gate, not a Phase-2 afterthought.** The WS-3 lifecycle fixes are one interacting state machine (see WS-3 ordering note); its design and the four Phase-0 module APIs are reviewed by Oracle before any WS-3 / migration code is written.
- **Regression discipline.** After every phase, the full pre-existing `bun test` suite must pass, not just the new locking tests (§8).
- **Consultation outcome.** Metis: fit-after-minor-revisions (those revisions are now in this doc); the 32-high dedup + workstream mapping were independently confirmed correct. Momus: ready to execute; independently re-verified `path-containment.ts:3`, `event-sink.ts:77`, `report-generator-tool.ts:1005`, `deep-merge.ts:64`, and the WS-3 lifecycle claims against source at `82d76a2`.

---

## Appendix — how the two reports were merged

- **High-severity dedup** was performed by `file:line`. Result: 27 `[R1]` + 6 `[R2]` = 33 raw, minus the single shared finding (`report-generator-tool.ts:2133`, present in both) = **32 unique**. That shared finding is retained once (WS-4) and flagged cross-validated.
- **`[R2]` is additive, not redundant:** it exercised `reviewer-database` + `reviewer-dependency` (not dispatched in `[R1]`) and reviewed `src/state/`, `src/config/`, `src/cli/`, `src/utils/`, `tests/`, and `.github/` — surfaces largely outside `[R1]`'s core-source scope. Its findings populate WS-5 (finding-store/schema), WS-4 (report filename/counts), WS-7 (startup hermeticity), WS-8 (deep-merge/disabled_hooks), and WS-9 (oversized/dead code, CI pin, test isolation).
- **Medium/low totals were not fully cross-deduplicated** (minimal scope overlap makes precise dedupe low-value at plan stage); the `~219/~144` figures are upper bounds. Exact per-finding detail remains in the two source reports colocated in this worktree's `.reviews/`.
- **Synthesis provenance:** the nine themes, eight cross-batch clusters, and eight top priorities driving this plan's workstream structure come from the `[R1]` adjudicated synthesis (`needs_significant_work`).
