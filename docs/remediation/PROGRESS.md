# Remediation — live progress & handoff

Compaction-safe state for resuming this work. Authoritative plan:
`docs/remediation/REMEDIATION-PLAN-2026-07-01.md`. WS-3 design:
`docs/remediation/WS-3-STATE-MACHINE.md`. Source reviews:
`.reviews/codebase-solidity-argus-2026-07-01.md` + `.reviews/codebase-argus-2026-07-01.md` (gitignored).

## Context
- Worktree `/projects/argus-security-hardening`, branch `fix/security-hardening`, base `origin/staging` @ `82d76a2`.
- **Delivery: single accumulating PR** → `origin/staging` (user pivoted away from per-phase PRs). Opened at Phase 0; updated each phase; merged after the final re-audit gate.
- Locked decisions: behavior-changes-OK (security minor, document breaks); scope = **32 highs + named high-value mediums** (remaining tail → follow-up issue); checkpoint at each phase boundary; Oracle design review is a Phase-0 gate.

## Commits (on `fix/security-hardening`; `git log` is authoritative)
- **Phase 0** = plan (`3f488ca`) + boundary modules & WS-3 design (`ece9e46`) + single-PR pivot & handoff + IPv4-mapped-IPv6 SSRF fix (`b6a029f`).
- **Phase 1** (one commit per workstream): WS-1 `2623a10` · WS-2 `2c3929e` · WS-7 `8e61156` · WS-8 `6dedd39` · WS-4 `8701d70`.
- All pushed to origin → **PR #27** (draft, → `staging`).

## Phase 0 — DONE, verified
Four hardened seams in `src/shared/` (exported from `src/shared/index.ts`), each locked by tests; **no call sites migrated yet**. Full suite **1908 pass / 3 skip / 0 fail**, `tsc` + `biome` clean.
- `path-safety.ts` — `assertContained`/`isContained` (realpath, symlink-safe), `validateRunId`/`validateSessionId`, `safeForgeTarget`, `safeForgeMatchPath`.
- `untrusted-content.ts` — `fenceUntrusted`, `escapeMarkdown` (NFKC, angle + backtick/tilde fences neutralized).
- `process-runner.ts` — `buildSafeEnv`, `runTrusted` (no-shell/timeout/cap), `safeCliValue`, `assertAllowedHost` (private-reject + pinned allowlist).
- `deep-merge.ts` — prototype-pollution hardened + `Object.create(null)` result.

## Oracle re-gate — DONE ✅ Phase 0 fit to close
`bg_b7420c71` close-out review: WS-3 design + path-safety + untrusted-content + deep-merge all CLOSED; it caught one residual SSRF bypass — `assertAllowedHost` accepted IPv4-mapped IPv6 loopback/private literals (`::ffff:127.0.0.1`, which `new URL()` normalizes to `::ffff:7f00:1`). **Fixed** (`isPrivateOrLoopbackHost` now decodes the mapped IPv4, both dotted and hex forms, and applies the private check) + tested; full suite green (1910 pass). **Phase 0 is now fit to close; Phase 1 (call-site migration) and Phase 2 (WS-3) fit to begin.**

## Phase 1 — DONE, verified ✅ (19 highs closed with red→green locking tests)
Every existing call site routed through the Phase-0 seams; report-generator contracts fixed. Full suite **1931 pass / 3 skip / 0 fail**, `tsc` + `biome` clean; zero regressions vs the `82d76a2` baseline (1863).
- **WS-1 (7)** `2623a10` — `validateRunId` at event-sink/artifact-resolver/report-gen(612); `sourceExcerpt` containment (1005); `safeForgeTarget`/`safeForgeMatchPath` in forge-coverage(59); lexical `path-containment.ts` **deleted**, forge-fuzz/forge-test + report-gen `isPathInsideDirectory` migrated to `path-safety`; `validateUrlScheme` relocated to `process-runner`.
- **WS-2 (3)** `2c3929e` — `escapeMarkdown`/newline-collapse in recon-context-builder(53); `fenceUntrusted` for non-bundled skill bodies in argus-skill-load-tool(51); `escapeMarkdown` on PDF title/overview in audit-ingest(209).
- **WS-7 (4)** `8e61156` — `assertAllowedHost(apiUrl)` in knowledge-sync-hook(37); pinned MCP `@1.1.1` + `buildSafeEnv` in solodit-lifecycle(59); configured `forgePath` threaded through solidity-parser(148)/contract-analyzer; injectable companion-clone/sync in config-handler(249).
- **WS-8 (1+folds)** `6dedd39` — loader recovery `Object.hasOwn`; `disabled_hooks` project-replace (last-wins) + canonical-name warning (`HOOK_NAMES` runtime const).
- **WS-4 (4)** `8701d70` — execute throws on `result.error`(2374); counts/gates scope-filtered to match render(2133); filename from configured `output_dir`(2204); scvd-sync refresh-on-no-op + force-sync-when-stale(182).

## Phase 1.5 — DONE, verified ✅ (interim review remediation; 1 high + 5 mediums closed with red→green locking tests)
`/reviewer` multi-agent pass on the Phase 0+1 diff (10 blind reviewers across 4 provider families → OpenAI adjudication) returned `request_changes` (1 high, 5 med, 5 low, 2 info; full report: `.reviews/PR-27-2026-07-02.md`, gitignored). Dominant theme: the hardening primitives were only half-wired. Folded the high + all 5 mediums into PR #27, each with a named locking test red pre / green post. Full suite **1938 pass / 3 skip / 0 fail**, `tsc` + `biome` clean; zero regressions.
- **adj_1** `795b25e` — forge `fork_url` routed through `assertAllowedHost` (was scheme-only) in forge-fuzz/forge-test; blocks internal/metadata SSRF (also blocks local-node forking — intentional trade-off).
- **adj_2** `9604dde` — centralized `assertScvdApiUrlAllowed` wired into knowledge-sync-hook + sync-knowledge-tool + doctor (manual sync + doctor were unguarded). Hard DNS-rebinding pin deferred (needs resolve-time IP check; would break custom mirrors).
- **adj_4** `634ac05` — report `output_dir` now realpath `isContained` + write-target re-check (was lexical `startsWith`); closes in-project symlink escape (arbitrary write).
- **adj_3 + adj_5** `4d3362c` — `assertAllowedHost` classifier rewritten as a real IPv6 group parser (IPv4-mapped/translated, 6to4, NAT64 `64:ff9b::/96`, ULA, link-local, site-local `fec0::/10`) — closes empirically-confirmed `::ffff:0:*` / `2002::` / `64:ff9b::` / `fec0::` bypasses; `buildSafeEnv` threaded into forge-runner/solidity-parser/slither-tool/config-handler git-clone (were inheriting full startup env → secret leak), allowlist extended with `FOUNDRY_PROFILE` + proxy vars.
- **Deferred to follow-up** (review lows/infos, non-blocking): adj_6 forge match_test/match_contract flag-guard, adj_7 forgePath honored only by contract-analyzer, adj_8 skill-load header escaping, adj_9 Solodit `HOME` exposure, adj_10 out-of-scope preflight count, adj_11 delete unused `validateSessionId`, adj_12/adj_13 dedup; plus the adj_2 DNS-rebinding pin.

## Phase 2 — DONE, verified ✅ (durability + finding identity; conforms to Phase-0-approved design)
Implement per the Oracle-approved state machine — do NOT re-derive lifecycle ad hoc. Landing as green-committable increments in the §5 order; commit+push each.
- **✅ FOUNDATION (§5 step 1) — DONE, pushed `edd608e`** (1940 pass): `EventSink` gains explicit state (`ACTIVE|DRAINING|SEALED|FAILED_RECOVERABLE`) + `ownerSet` (I1/I11); new `run.finalization_failed` journal event → sink FAILED_RECOVERABLE **without** sealing (unblocks #18/I3); `bounded-sink-registry` maintains `ownerSet`. Additive: `isFinalized` is a derived getter so all 19 consumers + mocks unchanged. **Ordering refinement:** `SCHEMA_VERSION` bump moved to WS-5 #27 (rides its migration) so 2.0.0 journals stay readable.
- **✅ #15 (§5 step 2) — DONE, pushed `67d4377`** (I5): session-activation sets `sessionActivated` only after sink + first append succeed; catch rolls back partial sink refs (setEventSink(null)+deleteSession); dropped the unconditional flag. New `session-activation.test.ts` (red→green via stash).
- **✅ #11 (§5 step 3) — DONE, pushed `3d3e96f`** (I1/I11, 1944 pass): `evictOldest`/`evictStale` skip run sinks with non-empty `ownerSet` (referenced runs are max-size- and TTL-exempt).
- **✅ #12 (§5 step 4) — DONE, pushed `464acac`** (I2, 1945 pass): `deleteSession` is async and `await`s `debouncedSave.flush()` **before** `dispose()` (dispose only clears the timer, so it silently dropped the last buffered save). session.deleted teardown (create-hooks) awaits it; capacity eviction in getManager stays sync via fire-and-forget; process `exit` handler stays best-effort sync (Node can't await it).
- **✅ #16 (§5 step 5) — DONE, pushed `48e559c`** (I6): record_finding validates → canonicalizes → appends `finding.added` to the durable journal (fail-fast) → then mutates; on no durable sink (UNACTIVATED/DEGRADED) it **rejects before mutating**.
- **✅ #19 (§5 step 4) — DONE, pushed `abe0998`** (I9): `argus_generate_report` completed event persists report `qualityGates`/`filePath` so `finalizeRun` never certifies a run whose gate inputs it could not read.
- **✅ #18 (§5 step 5) — DONE, pushed `9af30c9`** (I3): finalization seals only on success; a failed finalization emits `run.finalization_failed` → sink FAILED_RECOVERABLE (stays open for remediation/disposition/regen).
- **✅ #14+#13 (§5 step 6) — DONE, pushed `b422797`** (I4/I10): recovery preserves the original `runId`/`startTime` and resumes a report-generated-but-unsealed run instead of discarding it; discards only on staleness (>24h).
- **✅ #17 (§5 step 7) — DONE, pushed `c744ca7`** (I7): orphan event buffers gain a global session cap + proactive TTL sweep + `clearOrphanEvents`, wired into session.deleted teardown. Test-margin fixup `97e8202`.
- **✅ #20 (§5 step 7) — DONE, pushed `79ca7fc`** (I8): session.deleted archives shared/global state only for activated sessions (a never-activated session no longer wipes a concurrent audit via the global manager).
- **WS-3 COMPLETE** — all 8 highs + foundation landed. Full suite **1953 pass / 3 skip / 0 fail**, `tsc` + `biome` clean.
- **✅ #25+#26 (WS-5) — DONE, pushed `012ab6b`** (R2): finding-store dedups on the canonical content-id (not the persisted id), collapsing legacy-scheme/`projectDir`-shift duplicates on hydration; `hasFinding` routes file args through `normalizeStorePath` so an absolute-path query matches a relatively-stored finding.
- **✅ #27 (WS-5) — DONE, pushed `1ea8aa7`** (R2): `SCHEMA_VERSION` bumped 2.0.0 → **2.1.0** (WS-3 added `run.finalization_failed`); copy-on-read `migrateToCurrentSchema` re-stamps a known prior version on a shallow copy and throws typed `MigrationError` for an unrecognized version (original journal never mutated/partially written); both canonical validators accept + upgrade a migratable prior version so journals replay across the bump.
- **PHASE 2 COMPLETE** — all durability (WS-3 ×8) + finding-identity (WS-5 ×3) highs landed. Full suite **1960 pass / 3 skip / 0 fail**, `tsc` + `biome` clean; zero regressions vs the `82d76a2` baseline (1863).
- **Established increment pattern (working well):** ground the target → red→green locking test (prove red via `git stash push -- <file>` when the fix is already applied) → tsc + full `bun test` + `bun run check` → one commit per high → push. `EventSink` mocks in 6+ test files now carry the full lifecycle surface (state/ownerSet/addOwner/removeOwner/markDraining/markFailedRecoverable). Comment hook is strict: keep only necessary (security/invariant) comments and justify them.
- **WS-5 (3 highs)** — finding-store hydration dedup by normalized content (finding-store:55) + `hasFinding` path normalization (:92); schema-version **copy-on-read** migration with typed `MigrationError` (schemas:458). Fixture journal at prior schema_version (happy + corrupt).
- After EACH step: full `bun test` + `bun run typecheck` + `bun run check`; red→green locking test per closed high; then commit + push (accumulating PR #27).

## Phase 3 — IN PROGRESS (WS-6 global resource limits; broad medium sweep, 0 highs)
High-value concrete caps landed; remaining sweep sites are lower-value/diffuse follow-ups. Full suite **1963 pass / 3 skip / 0 fail**, `tsc` + `biome` clean.
- **✅ pattern-checker dependency/build-dir exclusion — pushed `f7fb456`** (R2): `collectSolidityFiles` skips `node_modules`/`.git`/`lib`/`out`/`cache` (finding pollution + unbounded-work vector on large repos); explicit file targets unaffected.
- **✅ source-excerpt bounded read — pushed `6627a0b`** (R2): new `readTextCapped` (bounded read, never fully buffers an oversized file, `capped` flag) with a 2MB budget on the tool/LLM-controlled project source file.
- **Already covered by earlier phases:** forge/subprocess stdout+stderr caps (`process-runner` `cap`/`runTrusted`, WS-7); orphan-buffer global cap + TTL sweep + clear-on-`session.deleted` (#17/I7, WS-3).
- **Acceptance status:** pattern-dir exclusion ✅ · oversized project file → capped ✅ · forge stdout → capped ✅ · orphan buffers ✅ · **oversized remote response → capped: DEFERRED** (SCVD/PDF/Solodit; JSON needs a stream-bounded reject, not truncate; host already allowlisted via adj_2).
- **Remaining WS-6 sweep (follow-up):** remote-response stream-bounded reject-cap (scvd-client, audit-ingest PDF, solodit); project-config read-size cap; global run-index compaction; background-task retention bound; pattern/skill corpus scan count+time budget.

## Phase 4 — LATER
- WS-9 regression coverage + de-dup + CI/test hermeticity — incl. gitignore the still-untracked `tests/fixtures/vulnerable-vault/foundry.lock` test artifact (R2/WS-9).

## Verification protocol (every step)
Baseline at `82d76a2` was green (1863 pass). Never leave a regression. Run the full `bun test` + `bun run typecheck` + `bun run check` after each change; every closed high needs a named locking test that is red on `82d76a2` and green after. No `as any`/`@ts-ignore`; typed errors; parse untrusted input at the boundary.
