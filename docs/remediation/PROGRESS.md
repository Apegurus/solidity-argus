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

## Phase 2 — NEXT (durability + finding identity; conforms to Phase-0-approved design)
Implement per the Oracle-approved state machine — do NOT re-derive lifecycle ad hoc.
- **WS-3 (10 highs)** — implement `docs/remediation/WS-3-STATE-MACHINE.md` (schema/event-first ordering): reference-count sinks (bounded-sink-registry:45) before flush-on-delete (session-state-registry:26) & safe eviction; graceful sink-init-failure (session-activation:196) before sink-existence-before-mutate (tool-tracking-hook:449); recovered-id preservation (session-activation:167) reconciled with the reportGenerated guard (:153); seal only successful finalizations (run-finalizer:469); persist normalized report metadata in the completed event (run-finalizer:101); orphan-buffer clear+TTL (tool-tracking-hook:658); activatedSessions guard before archive (create-hooks:415).
- **WS-5 (3 highs)** — finding-store hydration dedup by normalized content (finding-store:55) + `hasFinding` path normalization (:92); schema-version **copy-on-read** migration with typed `MigrationError` (schemas:458). Fixture journal at prior schema_version (happy + corrupt).
- After EACH step: full `bun test` + `bun run typecheck` + `bun run check`; red→green locking test per closed high; then commit + push (accumulating PR #27).

## Phase 3–4 — LATER
- Phase 3: WS-6 resource caps (byte/count/time budgets on migrated paths).
- Phase 4: WS-9 regression coverage + de-dup + CI/test hermeticity — incl. gitignore the still-untracked `tests/fixtures/vulnerable-vault/foundry.lock` test artifact (R2/WS-9).

## Verification protocol (every step)
Baseline at `82d76a2` was green (1863 pass). Never leave a regression. Run the full `bun test` + `bun run typecheck` + `bun run check` after each change; every closed high needs a named locking test that is red on `82d76a2` and green after. No `as any`/`@ts-ignore`; typed errors; parse untrusted input at the boundary.
