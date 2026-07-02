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

## Phase 2 — IN PROGRESS (durability + finding identity; conforms to Phase-0-approved design)
Implement per the Oracle-approved state machine — do NOT re-derive lifecycle ad hoc. Landing as green-committable increments in the §5 order; commit+push each.
- **✅ FOUNDATION (§5 step 1) — DONE, pushed `edd608e`** (1940 pass): `EventSink` gains explicit state (`ACTIVE|DRAINING|SEALED|FAILED_RECOVERABLE`) + `ownerSet` (I1/I11); new `run.finalization_failed` journal event → sink FAILED_RECOVERABLE **without** sealing (unblocks #18/I3); `bounded-sink-registry` maintains `ownerSet`. Additive: `isFinalized` is a derived getter so all 19 consumers + mocks unchanged. **Ordering refinement:** `SCHEMA_VERSION` bump moved to WS-5 #27 (rides its migration) so 2.0.0 journals stay readable.
- **✅ #15 (§5 step 2) — DONE, pushed `67d4377`** (I5): session-activation sets `sessionActivated` only after sink + first append succeed; catch rolls back partial sink refs (setEventSink(null)+deleteSession); dropped the unconditional flag. New `session-activation.test.ts` (red→green via stash).
- **✅ #11 (§5 step 3) — DONE, pushed `3d3e96f`** (I1/I11, 1944 pass): `evictOldest`/`evictStale` skip run sinks with non-empty `ownerSet` (referenced runs are max-size- and TTL-exempt).
- **NEXT = #12 (§5 step 4) async flushAndDispose (session-state-registry:26).** *Fix designed:* make `deleteSession` async = `await debouncedSave.flush()` **before** `dispose()` (I2, no lost saves). Ripple: `evictOldestSessionIfNeeded` awaits it; the capacity-eviction path in `getManager` (stays sync) fires it as `void deleteSession(...).catch(...)`; teardown callers of `registry.deleteSession` must `await` (grep `.deleteSession(` on SessionStateRegistry); `disposeDebouncedSaves` should also flush. `createDebouncedSave.flush()` + manager `dispose()` are already async.
- **THEN, in §5 order:** #16 record_finding reject-before-mutate (tool-tracking-hook:449) → #19 persist report metadata (run-finalizer:101) → #18 seal-only-on-success/emit `run.finalization_failed` (run-finalizer:469) → #14+#13 recovered-identity + reportGenerated-non-terminal (session-activation:167/:153) → #17 orphan-buffer caps+clear (tool-tracking-hook:658) → #20 activatedSessions guard before archive (create-hooks:415). Then WS-5 #25/#26/#27.
- **WS-5 (3 highs)** — finding-store hydration dedup by normalized content (finding-store:55) + `hasFinding` path normalization (:92); schema-version **copy-on-read** migration with typed `MigrationError` (schemas:458). Fixture journal at prior schema_version (happy + corrupt).
- After EACH step: full `bun test` + `bun run typecheck` + `bun run check`; red→green locking test per closed high; then commit + push (accumulating PR #27).

## Phase 3–4 — LATER
- Phase 3: WS-6 resource caps (byte/count/time budgets on migrated paths).
- Phase 4: WS-9 regression coverage + de-dup + CI/test hermeticity — incl. gitignore the still-untracked `tests/fixtures/vulnerable-vault/foundry.lock` test artifact (R2/WS-9).

## Verification protocol (every step)
Baseline at `82d76a2` was green (1863 pass). Never leave a regression. Run the full `bun test` + `bun run typecheck` + `bun run check` after each change; every closed high needs a named locking test that is red on `82d76a2` and green after. No `as any`/`@ts-ignore`; typed errors; parse untrusted input at the boundary.
