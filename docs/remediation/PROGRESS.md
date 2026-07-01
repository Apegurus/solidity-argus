# Remediation — live progress & handoff

Compaction-safe state for resuming this work. Authoritative plan:
`docs/remediation/REMEDIATION-PLAN-2026-07-01.md`. WS-3 design:
`docs/remediation/WS-3-STATE-MACHINE.md`. Source reviews:
`.reviews/codebase-solidity-argus-2026-07-01.md` + `.reviews/codebase-argus-2026-07-01.md` (gitignored).

## Context
- Worktree `/projects/argus-security-hardening`, branch `fix/security-hardening`, base `origin/staging` @ `82d76a2`.
- **Delivery: single accumulating PR** → `origin/staging` (user pivoted away from per-phase PRs). Opened at Phase 0; updated each phase; merged after the final re-audit gate.
- Locked decisions: behavior-changes-OK (security minor, document breaks); scope = **32 highs + named high-value mediums** (remaining tail → follow-up issue); checkpoint at each phase boundary; Oracle design review is a Phase-0 gate.

## Commits (on `fix/security-hardening`, ahead of `origin/staging`)
- `3f488ca` docs(remediation): plan
- `ece9e46` feat(shared): Phase-0 boundary modules + WS-3 design
- (this commit) docs(remediation): single-PR pivot + progress handoff

## Phase 0 — DONE, verified
Four hardened seams in `src/shared/` (exported from `src/shared/index.ts`), each locked by tests; **no call sites migrated yet**. Full suite **1908 pass / 3 skip / 0 fail**, `tsc` + `biome` clean.
- `path-safety.ts` — `assertContained`/`isContained` (realpath, symlink-safe), `validateRunId`/`validateSessionId`, `safeForgeTarget`, `safeForgeMatchPath`.
- `untrusted-content.ts` — `fenceUntrusted`, `escapeMarkdown` (NFKC, angle + backtick/tilde fences neutralized).
- `process-runner.ts` — `buildSafeEnv`, `runTrusted` (no-shell/timeout/cap), `safeCliValue`, `assertAllowedHost` (private-reject + pinned allowlist).
- `deep-merge.ts` — prototype-pollution hardened + `Object.create(null)` result.

## Oracle re-gate — PENDING (collect BEFORE Phase 1)
Background task **`bg_b7420c71`** — fresh close-out review of the amended modules + WS-3 doc.
**Post-compaction resume: `background_output(task_id="bg_b7420c71")` FIRST, address any residual, THEN begin Phase 1.** (First gate verdict was not-fit-to-close; all 3 module + 3 WS-3 BLOCKING + should-fixes were then addressed with tests — this re-gate confirms.)

## Phase 1 — NEXT (call-site migration + tool contracts; NO lifecycle rewrite)
Route existing call sites through the Phase-0 seams. No WS-3 lifecycle code (Phase 2). After EACH step: full `bun test` + `bun run typecheck` + `bun run check`; a red→green locking test per closed high. Targets (see plan §5):
- **WS-1 paths:** `event-sink.ts:77`, `audit-artifact-resolver.ts:45/57`, `report-generator-tool.ts:612/1005`, `forge-coverage-tool.ts:59`; replace lexical `path-containment.ts` (+ its callers + report-generator `isPathInsideDirectory`) with `path-safety`.
- **WS-2 untrusted:** `recon-context-builder.ts:53`, `argus-skill-load-tool.ts:51`, `scripts/audit-ingest.ts:209`, report-generator excerpt/provenance rendering.
- **WS-7 process:** `solodit-lifecycle.ts:59`, `knowledge-sync-hook.ts:37` (assertAllowedHost pinned to SCVD), `solidity-parser.ts:148` (configured forgePath), `config-handler.ts:249` (lazy/explicit sync), forge tools (`runTrusted` + `safeCliValue` for `--match-*`/`--fork-url`, `safeForgeMatchPath`).
- **WS-8 config:** loader recovery → `Object.hasOwn`; `disabled_hooks` validation + replacement semantics.
- **WS-4 tool contracts:** `report-generator-tool.ts:2374` (error → tool-level failure), `:2133` (one scoped model for counts/gates/render), `:2204` (filename from `output_dir`), `scvd-sync.ts:182` (stale metadata).
- Exit: ~20 highs closed with locking tests; adversarial/boundary tests green; full suite still green.

## Phase 2–4 — LATER
- Phase 2: WS-3 (implement per `WS-3-STATE-MACHINE.md`, schema/event-first ordering) + WS-5 (finding identity + copy-on-read schema migration).
- Phase 3: WS-6 resource caps.
- Phase 4: WS-9 regression coverage + de-dup + CI/test hermeticity — incl. gitignore the `tests/fixtures/vulnerable-vault/foundry.lock` test artifact (non-hermetic side-effect, R2/WS-9).

## Verification protocol (every step)
Baseline at `82d76a2` was green (1863 pass). Never leave a regression. Run the full `bun test` + `bun run typecheck` + `bun run check` after each change; every closed high needs a named locking test that is red on `82d76a2` and green after. No `as any`/`@ts-ignore`; typed errors; parse untrusted input at the boundary.
