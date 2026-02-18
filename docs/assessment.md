# Solidity Argus — Codebase Assessment (v2)

> **Date**: 2026-02-18
> **Branch**: `staging` (PR #1 → `main`)
> **Version**: 0.1.5
> **Previous Assessment**: v1 (pre-overhaul integration)
> **Scope**: Full codebase re-evaluation after architectural overhaul implementation

---

## 1. Executive Summary

The architectural overhaul from `argus-overhaul.md` (30 tasks across 5 waves) has been substantially implemented. The codebase has been restructured from a monolithic plugin into a factory-based composition pattern, with new config system, CLI, feature modules, shared utilities, and comprehensive testing. Test count grew from 23 (pre-overhaul original) to 389 (current) across 50 files with 1,194 expect() calls. TypeScript compiles cleanly.

However, three critical architectural issues from the v1 assessment remain unresolved, and the overhaul introduced one new breaking change concern. Five feature modules (background-agent, persistent-state, error-recovery, context-monitor, audit-enforcer) remain built but disconnected from the runtime hook pipeline.

### Status Change Summary (v1 → v2)

| Issue | v1 Status | v2 Status |
|-------|-----------|-----------|
| Split-brain audit state | CRITICAL | **STILL CRITICAL** — unchanged |
| Managers created but unused | HIGH | **STILL HIGH** — unchanged |
| Dual Solodit MCP launch | MEDIUM | **BY DESIGN** — reclassified (see §3.3) |
| CLI commands wired to stubs | HIGH | **FIXED** — real commands wired |
| Event hook noisy debug output | LOW | **FIXED** — v2 uses logger with debug gate |
| 5 disconnected feature modules | HIGH | **STILL HIGH** — unchanged |
| Package rename breaking changes | N/A | **NEW — MEDIUM** |

---

## 2. Plan Compliance

### 2.1 Overhaul Plan (`argus-overhaul.md`) — 30 Tasks

All 30 tasks are marked `[x]` in the plan. The "Definition of Done" criteria are met:

- [x] `bun test` passes (389 tests, 0 failures)
- [x] `bun run typecheck` passes (zero errors)
- [x] Plugin loads and registers 4 agents + 8 tools (verified by E2E tests)
- [x] `argus doctor` CLI executes and reports status
- [x] Config reads from user-level and project-level locations
- [x] Hooks individually disableable via `disabled_hooks`
- [x] Audit state persists across manager instances (E2E test verifies file roundtrip)

### 2.2 Original Plan (`argus-plugin.md`) — 35 Tasks

All 35 tasks marked complete. Deliverables match: 8 tools, 4 agents, 55 SKILL.md files, SCVD integration, Solodit MCP, finding aggregation.

### 2.3 Compliance Gaps

| Gap | Plan Reference | Actual |
|-----|---------------|--------|
| Feature modules not wired | Overhaul Tasks 15-19 | Modules exist with tests but are not imported by `create-hooks.ts` |
| AuditStateManager not wired | Overhaul Task 13 | Manager exists, has tests, but `createManagers()` output is discarded by `createHooks()` |
| BackgroundManager noop | Overhaul Task 12 | Manager exists with full queue logic, but dispatcher logs a warning and returns noop |
| Event hook sub-handlers | Overhaul Task 20 | `createEventHookV2` accepts `subHandlers[]` but none are passed |

---

## 3. Critical Issues

### 3.1 Split-Brain Audit State — CRITICAL (unchanged from v1)

**Location**: `src/create-hooks.ts:30-47`, `src/hooks/event-hook-v2.ts:44-48`

**Problem**: Two separate `AuditState` instances coexist after `session.created` fires.

```
Initialization (create-hooks.ts:30-32):
  state A = createAuditState(projectDir)         // ← original state
  eventHookV2.setAuditState(state A)             // ← event hook holds reference to A

session.created fires (event-hook-v2.ts:44-48):
  state B = createAuditState(dir)                // ← NEW state created
  currentAuditState = state B                    // ← event hook now holds B

After session.created:
  getAuditState() → state B                     // ← system-prompt, compaction see B
  toolTrackingHook → still closes over state A   // ← tool-tracking mutates A
```

**Impact**: Findings from tool executions (Slither, pattern checker, contract analyzer) are written to state A. But system prompt injection and compaction read from state B. The agent sees a summary with zero findings regardless of what tools have discovered.

**Fix**: `createToolTrackingHook` should accept `getAuditState` accessor instead of a direct `AuditState` reference. Alternatively, the event hook should mutate the existing state object in-place rather than replacing it.

### 3.2 Managers Created But Never Used — HIGH (unchanged from v1)

**Location**: `src/index.ts:29`, `src/create-hooks.ts:28`

**Problem**: `createManagers()` returns `{ backgroundManager, auditStateManager }`. This is passed to `createHooks()`, but `createHooks()` destructures it away:

```typescript
// create-hooks.ts:28 — managers is accepted but never referenced
const { config, projectDir, isHookEnabled } = args  // ← managers not destructured
```

**Impact**:
- `AuditStateManager` (persistent state across sessions) — never called. Audit state is not persisted to disk during normal operation.
- `BackgroundManager` (background agent dispatch) — never called. No background agent dispatch occurs.

Both modules have thorough tests and correct implementations. They just need to be wired.

### 3.3 Dual Solodit MCP — Reclassified to BY DESIGN

**Location**: `src/index.ts:24-26` (process spawn), `src/hooks/config-handler.ts:89-98` (MCP registration)

**v1 Assessment**: Flagged as potential double-launch issue.

**v2 Assessment**: This is the correct pattern. `startSoloditMcp()` spawns the MCP server process. `config-handler.ts` registers it as a remote MCP endpoint so OpenCode knows how to connect. These are two halves of the same integration — spawn + register. Not a bug.

**Remaining concern**: `startSoloditMcp()` uses `node:child_process.spawn()` + `npx` instead of `Bun.spawn()`. This violates the CLAUDE.md Bun-first directive and introduces a Node.js runtime dependency for process spawning.

### 3.4 Five Disconnected Feature Modules — HIGH (unchanged from v1)

**Location**: `src/features/`

| Module | File | Lines | Tests | Wired? |
|--------|------|-------|-------|--------|
| Background Manager | `background-agent/background-manager.ts` | 200 | Yes | No — noop dispatcher |
| Audit State Manager | `persistent-state/audit-state-manager.ts` | 122 | Yes | No — never called |
| Session Recovery | `error-recovery/session-recovery.ts` | 27 | Yes | No — not imported |
| Tool Error Recovery | `error-recovery/tool-error-recovery.ts` | ~82 | Yes | No — not imported |
| Context Monitor | `context-monitor/context-monitor.ts` | 48 | Yes | No — not imported |
| Tool Output Truncator | `context-monitor/tool-output-truncator.ts` | ~87 | Yes | No — not imported |
| Audit Enforcer | `audit-enforcer/audit-enforcer.ts` | 34 | Yes | No — not imported |

All modules are well-implemented, tested, and follow the project's DI patterns. They need to be integrated into the `createHooks()` pipeline (specifically, as event sub-handlers or system prompt extensions).

---

## 4. Copilot PR Review Comments — Assessment

PR #1 received 4 review comments from GitHub Copilot. Here is my evaluation:

### 4.1 Cache Directory Rename — VALID

**Copilot's concern**: Cache directory renamed from `~/.cache/opencode-argus/` to `~/.cache/solidity-argus/`. Breaking change for existing users.

**Assessment**: Valid concern. Files affected:
- `src/hooks/config-handler.ts:14` — Trail of Bits skills cache
- `src/hooks/knowledge-sync-hook.ts:39` — SCVD index cache
- `src/tools/sync-knowledge-tool.ts:87` — SCVD index path

**Recommendation**: Since the overhaul plan explicitly chose "clean break — no migration needed" (§Metis Review), this is intentional. However, users upgrading from pre-rename versions will lose their cached SCVD index and need to re-clone Trail of Bits skills. Consider documenting this in release notes or a migration guide.

### 4.2 Config File Name Change — VALID

**Copilot's concern**: Config detection now looks for `solidity-argus.{jsonc,json}` instead of `opencode-argus.jsonc`.

**Assessment**: Valid. `src/shared/file-utils.ts:14-19` searches for `solidity-argus.jsonc`, `solidity-argus.json`, and generic `config.{jsonc,json}`. Old `opencode-argus.jsonc` files will be silently ignored.

**Recommendation**: Same as above — clean break is intentional per plan. Document in release notes.

### 4.3 Test File Exclusion in package.json — NOT AN ISSUE

**Copilot's concern**: Questioned whether `!src/**/*.test.ts` exclusion in the `files` field is appropriate.

**Assessment**: This is standard practice. The `files` field controls what's published to npm. Test files should not be in the published package. This is correct.

### 4.4 Conditional Solodit Tool Registration — NOT AN ISSUE

**Copilot's concern**: E2E test assumes 8 tools for non-Solidity projects, but solodit is conditionally registered.

**Assessment**: The default config has `solodit.enabled = true` (from `src/config/schema.ts`). A non-Solidity project with no custom config gets the default config, which includes solodit. The test at `tests/e2e/plugin-e2e.test.ts:115` correctly expects 8 tools. Copilot's concern is unfounded — the condition only triggers when a user explicitly sets `solodit.enabled = false`.

---

## 5. Code Quality Analysis

### 5.1 Type Safety — Excellent

- Zero `as any` in production code (all 15 instances are in test files for mocking)
- Zod validation at config boundary (`safeParse` + fallback to defaults)
- Proper type guards throughout (e.g., `toRecord()`, `toSeverity()`, `isAuditState()`)
- `satisfies Record<string, boolean>` on agent tool maps

### 5.2 Error Handling — Good

- `safeCreateHook()` wraps every hook factory in try/catch
- `createHookGuard()` provides clean disable mechanism
- Knowledge sync is fire-and-forget with caught errors
- CLI commands catch and report errors with exit codes
- Atomic file writes in `AuditStateManager` (temp + rename)

### 5.3 Testing — Strong

| Metric | Value |
|--------|-------|
| Total tests | 389 |
| Total assertions | 1,194 |
| Test files | 50 |
| Failures | 0 |
| E2E tests | 30 (in dedicated suite) |
| Duration | ~5s |

Test quality notes:
- Proper use of temp directories (`mkdtempSync`) — no writes to project dir
- Console capture/restore pattern for CLI tests
- DI pattern enables clean unit testing without process spawning
- E2E tests cover full plugin lifecycle, config merge, hook behavior, persistent state

### 5.4 Logging — Improved (v1 → v2)

- v1: Scattered `console.error` calls
- v2: `createLogger()` module with `[argus]` prefix, debug gate, stderr-only output
- Event hook v2 uses `logger.debug()` for idle events (was `console.error` in v1)
- **Remaining issue**: `knowledge-sync-hook.ts:21` still uses raw `console.error` instead of logger

### 5.5 Architecture — Clean with Known Gaps

**Strengths**:
- Factory composition pattern (`index.ts` → factories → `createPluginInterface`)
- Multi-level config (user + project + defaults) with deep merge
- Hook guard system with `disabled_hooks`
- DI pattern across all tools for testability
- Push-only mutation for multi-plugin safety (verified by E2E test)
- Proper barrel exports (`features/*/index.ts`)

**Weaknesses**:
- Split-brain state (§3.1)
- Managers created but unused (§3.2)
- Feature modules disconnected (§3.4)
- `node:child_process.spawn` in `index.ts` instead of `Bun.spawn`

### 5.6 Console.log Usage — Appropriate

All 15+ `console.log` calls are in CLI files (`cli-program.ts`, `commands/doctor.ts`, `commands/init.ts`, `commands/install.ts`, `tui-prompts.ts`) where stdout output is correct. No `console.log` in core business logic. This is clean.

---

## 6. Pattern Checker Coverage

The pattern checker (`src/tools/pattern-checker-tool.ts`) includes 5 builtin regex patterns plus SCVD-sourced patterns.

### 6.1 Builtin Patterns

| Pattern | Category | Present |
|---------|----------|---------|
| Reentrancy | reentrancy | Yes |
| Access Control | access-control | Yes |
| Delegatecall | delegatecall | Yes |
| tx.origin | access-control | Yes |
| Unchecked return | unchecked-return | Yes |

### 6.2 Missing Builtin Patterns (enhancement opportunity)

- Oracle manipulation / price feed staleness
- Flash loan attack vectors
- ERC4626 inflation attack
- Signature replay / malleability
- Front-running / MEV
- Donation attack (direct ETH send to skew balances)
- Integer overflow in unchecked blocks (Solidity >= 0.8)
- Storage collision in proxy patterns

SCVD integration partially addresses this gap, but builtin patterns provide offline baseline capability.

---

## 7. Knowledge Base Assessment

### 7.1 Skills Directory — 55 SKILL.md Files

Comprehensive coverage across:
- **Vulnerability patterns** (38): reentrancy, access-control, flash-loan, oracle, integer-overflow, etc.
- **Methodology** (3): audit-methodology, code-review-checklist, threat-modeling
- **Protocol patterns** (5): DeFi-specific patterns (AMM, lending, staking, bridges, governance)
- **Checklists** (6): deployment, upgrade, token-launch, etc.
- **References** (2): ERC standards, common libraries

### 7.2 SCVD Integration

- `ScvdClient` — REST API with pagination, proper error handling, type-safe parsing
- `ScvdIndex` — Local JSON index with keyword/SWC/CWE search
- Incremental sync — only fetches new entries since last sync
- Auto-sync on plugin init (non-blocking, fire-and-forget)
- Doctor command checks `/stats` endpoint availability

### 7.3 Trail of Bits Skills

- Cloned via `git clone --depth 1` on first load (blocking, 30s timeout)
- Cached at `~/.cache/solidity-argus/trailofbits-skills/`
- Failure is non-critical (swallowed error, plugin continues)
- **Concern**: Blocking `execSync` during plugin initialization could delay OpenCode startup by up to 30 seconds on first use

---

## 8. Agent Architecture

### 8.1 Agent Configuration

| Agent | Mode | Model | Tools |
|-------|------|-------|-------|
| Argus | primary | claude-opus-4-6 | All argus_* and solodit-mcp_* **disabled** (forces delegation) |
| Sentinel | subagent | claude-sonnet-4-6 | slither, forge_test, forge_fuzz, analyze_contract, check_patterns |
| Pythia | subagent | claude-sonnet-4-6 | solodit_search, check_patterns |
| Scribe | subagent | claude-sonnet-4-6 | generate_report |

### 8.2 Agent Prompt Quality

- **Argus prompt** (`argus-prompt.ts`): 407 lines, comprehensive 7-step methodology, delegation examples with Task tool syntax, severity classification, fallback procedures
- **Sentinel prompt** (`sentinel-prompt.ts`): Static analysis specialist
- **Pythia prompt** (`pythia-prompt.ts`): Vulnerability research specialist
- **Scribe prompt** (`scribe-prompt.ts`): Report generation specialist

### 8.3 Missing Agent Config

- No `temperature` set on any agent — relies on OpenCode/model defaults
- Agent `permission.task` grants cross-delegation but no `read`/`write` file permissions specified

---

## 9. CLI Assessment

### 9.1 Commands — All Working

| Command | Status | Notes |
|---------|--------|-------|
| `argus doctor` | Working | Checks Slither, Forge, project type, config, SCVD API |
| `argus init` | Working | Creates `.opencode/solidity-argus.json`, detects project type |
| `argus install` | Working | Adds plugin to `opencode.json` |
| `argus --help` | Working | Displays command list |

### 9.2 CLI Quality

- Proper exit codes (0 success, 1 failure)
- Uses `process.exitCode` instead of `process.exit()` to allow stdout flush
- Has shebang (`#!/usr/bin/env bun`) for direct execution
- Color output with ANSI codes (green ✓, red ✗)
- TUI prompts module exists but not used by any command yet

---

## 10. New Issues Introduced by Overhaul

### 10.1 Breaking Changes from Package Rename

The package was renamed from `opencode-argus` to `solidity-argus`. This affects:

1. **npm package name**: `solidity-argus` (was `opencode-argus`)
2. **Config file names**: `solidity-argus.{jsonc,json}` (was `opencode-argus.jsonc`)
3. **Cache directory**: `~/.cache/solidity-argus/` (was `~/.cache/opencode-argus/`)
4. **Binary names**: `solidity-argus` and `argus` (new)

**Mitigation**: The overhaul plan explicitly chose "clean break — no migration needed". This is acceptable for a pre-1.0 package but should be documented in release notes.

### 10.2 Blocking Git Clone at Init Time

`src/hooks/config-handler.ts:20` uses `execSync` for git clone with a 30-second timeout. This runs during the `config` hook, which executes during OpenCode initialization.

**Impact**: First-time users or users with cleared cache will experience a blocking delay of up to 30 seconds during OpenCode startup while Trail of Bits skills are cloned.

**Recommendation**: Move to async clone with `Bun.spawn()` or defer to first skill access.

### 10.3 node:child_process Instead of Bun.spawn

`src/index.ts:11` uses `spawn` from `node:child_process` to start the Solodit MCP server. Per `CLAUDE.md`, Bun.spawn should be preferred.

---

## 11. Priority Action Items

### P0 — Must Fix Before Merge

1. **Fix split-brain audit state** (§3.1)
   - Change `createToolTrackingHook` to accept `getAuditState` accessor instead of direct state reference
   - Update `createHooks()` accordingly
   - Estimated: ~20 lines changed across 2 files

### P1 — Should Fix Before Release

2. **Wire `AuditStateManager` into event hook pipeline** (§3.2)
   - Use `managers.auditStateManager` in event hook to persist state on `session.idle` and load on `session.created`
   - Estimated: ~30 lines

3. **Wire feature modules as event sub-handlers** (§3.4)
   - Pass `sessionRecovery`, `contextMonitor`, `auditEnforcer` as sub-handlers to `createEventHookV2()`
   - Estimated: ~40 lines

4. **Replace `node:child_process` with `Bun.spawn`** in `index.ts` (§10.3)
   - Estimated: ~5 lines

5. **Replace blocking `execSync` git clone** with async alternative (§10.2)
   - Estimated: ~15 lines

### P2 — Should Fix Before 1.0

6. **Add migration guide / release notes** for package rename (§10.1)
7. **Expand builtin patterns** in pattern checker (§6.2)
8. **Use logger consistently** — replace remaining `console.error` in knowledge-sync-hook.ts
9. **Add agent `temperature` configuration**

---

## 12. Metrics Summary

| Metric | v1 (pre-overhaul) | v2 (current) | Delta |
|--------|-------------------|--------------|-------|
| Tests | 359 | 389 | +30 |
| Test files | ~45 | 50 | +5 |
| Assertions | ~900 | 1,194 | +294 |
| Source files | ~35 | ~60 | +25 |
| TypeScript errors | 0 | 0 | — |
| `as any` (production) | 0 | 0 | — |
| Tools | 8 | 8 | — |
| Agents | 4 | 4 | — |
| Skills | 55 | 55 | — |
| CLI commands | 0 (stubs) | 3 (working) | +3 |
| Feature modules | 5 (disconnected) | 5 (disconnected) | — |
| Critical issues | 3 | 1 | -2 |
| High issues | 3 | 2 | -1 |

---

## 13. Conclusion

The overhaul successfully transformed the codebase from a monolithic plugin into a modular, factory-based architecture. The infrastructure is solid: comprehensive testing, clean types, proper DI, multi-level config, working CLI, and multi-plugin safety patterns.

The single most important remaining issue is the **split-brain audit state** (§3.1) — a ~20-line fix that should be the top priority before merging PR #1 to main. The second priority is wiring the existing feature modules (§3.4), which are fully built and tested but not connected to the runtime.

The codebase is well-positioned for production use once these wiring issues are resolved.
