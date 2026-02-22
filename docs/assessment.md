# Solidity Argus — Codebase Assessment (v3)

> **Date**: 2026-02-18
> **Branch**: `staging` (PR #1 → `main`)
> **Version**: 0.1.6
> **Scope**: Full codebase re-evaluation after architectural overhaul + skill system integration + permission migration

---

## 1. Executive Summary

The codebase has been restructured from a monolithic plugin into a factory-based composition pattern modeled after oh-my-opencode. Since the last assessment, three additional improvements shipped: via_ir auto-detection for Slither fallback, skill index injection into system prompts, and migration of subagent configs from deprecated `tools` to the `permission` system.

The codebase is in strong shape overall: 409 tests pass across 50 files (1,232 assertions), TypeScript compiles cleanly, zero `as any` in production code, no TODO/FIXME/HACK comments. The architecture is modular, well-tested, and follows multi-plugin safety patterns.

**One critical bug and two high-priority wiring gaps remain from the original assessment and have not been addressed.**

### Status Summary

| Category | Count/Status |
|----------|-------------|
| Tests | 409 pass, 0 fail |
| Assertions | 1,232 |
| Test files | 50 |
| Source files (non-test) | ~68 |
| TypeScript errors | 0 |
| `as any` in production | 0 |
| Tools | 8 |
| Agents | 4 |
| Skills (bundled) | 55 |
| CLI commands | 3 (working) |
| Feature modules | 7 (all disconnected) |

---

## 2. Critical Issues

### 2.1 Split-Brain Audit State — CRITICAL

**Location**: `src/create-hooks.ts:30-51`, `src/hooks/event-hook.ts:44-48`

**Problem**: Two separate `AuditState` object instances coexist after `session.created` fires. The tool tracking hook and the system prompt / compaction hooks read from different instances.

**Flow**:
```
create-hooks.ts:30  → state A = createAuditState(projectDir)
create-hooks.ts:31  → eventHookV2 created, internal state = null
create-hooks.ts:32  → setAuditState(state A) → eventHookV2 holds reference to A
create-hooks.ts:51  → createToolTrackingHook(auditState, findingStore)
                       ↑ closes over state A directly

When session.created fires:
  event-hook.ts:46 → state B = createAuditState(dir)
  event-hook.ts:47 → currentAuditState = state B
                         ↑ replaces A with B in event hook closure

After session.created:
  getAuditState()        → returns state B (system-prompt, compaction use this)
  toolTrackingHook       → still mutates state A (closed over at creation time)
  findingStore           → still pushes to state A's findings array
```

**Impact**: Every finding discovered by Slither, pattern checker, or contract analyzer is written to state A. But the system prompt injection (which tells the agent about current findings) and the compaction hook (which preserves findings across context compression) both read from state B — which has zero findings. The agent operates blind to its own discoveries.

**Fix options**:
1. **(Recommended)** Change `createToolTrackingHook` signature to accept `getAuditState: () => AuditState | null` instead of a direct `AuditState` reference, and `getStore: () => FindingStore` instead of a direct store. Read the state lazily on each invocation.
2. Make `createEventHookV2`'s `session.created` handler mutate the existing state object in-place (reset fields) rather than replacing it with a new object.

**Estimated effort**: ~30 lines across `tool-tracking-hook.ts` + `create-hooks.ts`. Option 1 also requires updating `finding-store.ts` since the store's `addFinding` pushes to `state.findings` (the store itself is tightly coupled to a specific state instance).

### 2.2 Managers Created But Never Used — HIGH

**Location**: `src/index.ts:29`, `src/create-hooks.ts:28`

**Problem**: `createManagers()` returns `{ backgroundManager, auditStateManager }`. This object is passed to `createHooks()`, but `createHooks()` destructures it away on line 28:

```typescript
const { config, projectDir, isHookEnabled } = args  // managers silently dropped
```

**Impact**:
- **AuditStateManager**: Built with atomic file writes (temp + rename), proper JSON validation, and load/save/update/reset API. Never called. Audit state dies when the process exits — no persistence across sessions.
- **BackgroundManager**: Full concurrent task queue with priority, cancellation, and completion callbacks. Wired to a noop dispatcher that logs a warning. Never invoked by any hook or tool.

Both have thorough test coverage and correct implementations.

### 2.3 Seven Disconnected Feature Modules — HIGH

**Location**: `src/features/`

All feature modules are built, tested, exported via barrel files, but never imported by `create-hooks.ts` or any other runtime code path.

| Module | Purpose | Lines | Tests | Why it matters |
|--------|---------|-------|-------|----------------|
| `persistent-state/audit-state-manager.ts` | Save/load audit state to disk | 122 | 5 tests | Session crash = total state loss without this |
| `background-agent/background-manager.ts` | Concurrent background task dispatch | 200 | 5 tests | Parallel sub-agent execution blocked |
| `error-recovery/session-recovery.ts` | Reload state on session.error | 27 | 4 tests | No crash recovery |
| `error-recovery/tool-error-recovery.ts` | Contextual error hints (via_ir, missing tools) | 48 | 7 tests | Raw errors surfaced to user |
| `context-monitor/context-monitor.ts` | Token usage tracking, compaction triggers | 48 | 3 tests | No context window awareness |
| `context-monitor/tool-output-truncator.ts` | Truncate oversized tool output (50K default) | 17 | 3 tests | Slither output can blow context |
| `audit-enforcer/audit-enforcer.ts` | Phase progression reminders | 34 | 3 tests | No audit methodology enforcement |

**Wiring path**: Most of these should be passed as `subHandlers` to `createEventHookV2()`, or integrated as middleware in the tool tracking / system prompt pipelines.

---

## 3. Architecture Analysis

### 3.1 Plugin Composition Pipeline

```
index.ts (entry)
  ├─ loadArgusConfig(projectDir)         → multi-level config (user + project)
  ├─ startSoloditMcp(port)              → spawn MCP server process
  ├─ createHookGuard(disabled_hooks)    → hook enable/disable filter
  ├─ createManagers(projectDir, config) → BackgroundManager + AuditStateManager
  ├─ createTools(config)                → 8 tool definitions (conditional solodit)
  ├─ createHooks(config, managers, ...)  → config, system-prompt, compaction, tool-tracking, event
  └─ createPluginInterface(tools, hooks) → final plugin return shape
```

**Strengths**:
- Clean factory decomposition — each concern isolated
- `createPluginInterface` filters undefined hooks (disabled hooks don't appear in return)
- Push-only mutation for arrays (multi-plugin safe, verified by E2E test)
- Config spreads preserved (`config.agent = { ...config.agent, ... }`)

**Weaknesses**:
- Managers disconnected (§2.2)
- No middleware pipeline for tool output processing (truncation, error hints)
- Event sub-handlers parameter exists but nothing passed to it

### 3.2 Config System

```
~/.config/opencode/solidity-argus.{jsonc,json}  →  user-level
.argus/solidity-argus.{jsonc,json}               →  project-level (canonical write root)
.opencode/solidity-argus.{jsonc,json}            →  project-level (legacy read-only fallback)
                                                 ↓ deepMerge
                                           ArgusConfigSchema.safeParse()
                                                 ↓ fallback to defaults
                                           ArgusConfig
```

- Zod v4 validation with `safeParse` — collects errors, falls back to defaults
- Deep merge with proper object recursion
- JSONC support (line comments, block comments, trailing commas)
- Configurable: agents, tools, knowledge, reporting, solodit, disabled_hooks, background

**Note**: Config file detection searches for `solidity-argus.{jsonc,json}` (not the old `opencode-argus` name). This is a clean break — intentional per overhaul plan. Old configs are silently ignored.

### 3.3 Agent Permission System (NEW since v2)

Commit `55b24e7` migrated subagent configs from deprecated `tools` to `permission`:

| Agent | Permission Model | Notes |
|-------|-----------------|-------|
| Argus | `tools` (wildcard deny) + `permission` (task delegation, skill) | Keeps `tools: { "argus_*": false, "solodit-mcp_*": false }` — `permission` doesn't support globs |
| Sentinel | `permission` only | `argus_slither_analyze`, `argus_forge_test`, `argus_forge_fuzz`, `argus_analyze_contract`, `argus_check_patterns`, `skill` |
| Pythia | `permission` only | `argus_solodit_search`, `argus_check_patterns`, `skill` |
| Scribe | `permission` only | `argus_generate_report`, `skill` |

All agents have `skill: "allow"` — enabling access to the 55 bundled SKILL.md files and Trail of Bits skills.

**Concern**: Argus agent retains the deprecated `tools` block because `permission` doesn't support glob patterns. If/when OpenCode adds glob support to `permission`, this should be migrated.

### 3.4 Skill System Integration (NEW since v2)

Three components work together:
1. **Config handler** (`config-handler.ts:124-143`): Pushes bundled skills, custom skills dir, and Trail of Bits skills into `config.skills.paths`
2. **System prompt hook** (`system-prompt-hook.ts:85-171`): Builds a live skill index snapshot at hook creation time — counts bundled, ToB, and custom skills, samples 3 names from each
3. **Agent prompts** (all 4): Include curated skill maps with deterministic trigger rules (e.g., load `vulnerability-patterns/oracle-manipulation` when price feeds detected)

**Skill index injection example** (in system prompt):
```
### Skill Index Snapshot
- Bundled skills: 55 (examples: vulnerability-patterns/reentrancy, ...)
- Trail of Bits skills: 12 (examples: audit-context-building, ...)
- Custom project skills: 0
```

### 3.5 Solodit MCP Integration

- `index.ts:10-18`: Spawns MCP server via `node:child_process.spawn` + `npx`
- `config-handler.ts:112-122`: Registers as `type: "remote"` MCP at `localhost:{port}/mcp`
- This is the correct two-step pattern: spawn process, then register endpoint

**Issue**: Uses `node:child_process.spawn` instead of `Bun.spawn`. Violates CLAUDE.md Bun-first directive.

### 3.6 Slither via_ir Detection (NEW since v2)

Commit `1492bc8` added automatic detection of `via_ir = true` in `foundry.toml`:

- `slither-tool.ts:476-486`: `detectViaIr()` reads foundry.toml, regex matches `via_ir = true` or `via-ir = true`
- When detected, skips direct Slither analysis (which fails with via_ir) and goes straight to flatten fallback
- Flatten fallback: `forge flatten` each .sol file → run Slither on flattened output → remap findings back to original files
- FALLBACK_TRIGGERS expanded with via_ir-related strings

---

## 4. Code Quality

### 4.1 Type Safety — Excellent

- Zero `as any` in production code (all instances in test files for mocking)
- Zod validation at config boundary
- Proper type guards: `toRecord()`, `toSeverity()`, `isAuditState()`, `isPersistentAuditState()`
- `satisfies` used for type-level validation without runtime overhead (removed from deprecated `tools` blocks, retained where appropriate)

### 4.2 Error Handling — Good

- `safeCreateHook()` wraps every hook factory in try/catch → returns `undefined` on failure
- `createHookGuard()` provides clean disable mechanism
- Knowledge sync is fire-and-forget with caught errors
- CLI commands use proper exit codes
- Atomic file writes in AuditStateManager (temp file + rename)
- Slither tool has ENOENT detection, AbortSignal support, flatten fallback chain

### 4.3 Logging — Good (with minor gaps)

- `createLogger()` in `src/shared/logger.ts`: `[argus]` prefix, stderr-only, debug gate
- Event hook v2 uses `logger.debug()` for idle events (was raw `console.error` in v1)
- **Gap**: `safe-create-hook.ts:8` uses raw `console.error` instead of logger
- **Gap**: `knowledge-sync-hook.ts:21` uses raw `console.error` instead of logger
- **Gap**: Old `event-hook.ts` (v1) still uses `console.error` — this file is unused at runtime (v2 is imported instead) but still exists and has tests

### 4.4 Dead Code

| File | Status | Notes |
|------|--------|-------|
| `src/hooks/event-hook.ts` | Dead — v2 imported instead | Still has tests in `event-hook.test.ts` |
| `src/plugin-config.ts` | Deleted | Test file migrated to import from new config module |
| `src/state/plugin-state.ts` | Unused at runtime | Has tests, but never imported by any runtime code |

### 4.5 `node:child_process` Usage

Four files import from `node:child_process`:

| File | Usage | Should use Bun? |
|------|-------|-----------------|
| `src/index.ts:2` | `spawn` for Solodit MCP | Yes — `Bun.spawn` |
| `src/hooks/config-handler.ts:4` | `execSync` for git clone | Yes — `Bun.spawnSync` or async |
| `src/cli/commands/doctor.ts:1` | `execSync` for version checks | Acceptable — CLI context |
| `src/tools/slither-tool.ts:5` | `execSync` for solc-select, find | Partial — main `runSlitherCommand` uses `Bun.spawn`, but helper functions use `execSync` |

---

## 5. Testing Assessment

### 5.1 Metrics

| Metric | Value |
|--------|-------|
| Total tests | 409 |
| Total assertions | 1,232 |
| Test files | 50 |
| Failures | 0 |
| E2E tests | 30 (in dedicated suite) |
| Duration | ~5.5s |

### 5.2 Coverage Highlights

- E2E tests cover full plugin lifecycle: load, config hook, system prompt, compaction, tool-after, event lifecycle, disabled hooks, persistent state
- Every feature module has its own test file
- DI pattern enables clean unit testing without process spawning
- Proper temp directory usage (`mkdtempSync`) — no writes to project dir
- Console capture/restore pattern for CLI tests

### 5.3 Testing Gaps

- **No test for split-brain state scenario**: No test verifies that findings added via tool tracking are visible to `getAuditState()` after `session.created` fires
- **No integration test for full audit flow**: `tests/integration/full-audit.test.ts` exists but is lightweight — doesn't test the tool tracking → system prompt → compaction pipeline end-to-end
- **No test for skill index accuracy**: System prompt hook tests verify the `<argus-context>` block exists but don't verify skill counts are correct

---

## 6. Knowledge Base

### 6.1 Bundled Skills — 55 SKILL.md Files

Organized in `skills/` directory across 5 categories:
- **Vulnerability patterns** (38): reentrancy, access-control, flash-loan, oracle-manipulation, integer-overflow, etc.
- **Methodology** (3): audit-methodology, severity-classification, report-template
- **Protocol patterns** (5): AMM/DEX, lending, bridges, governance, staking
- **Checklists** (6): deployment, upgrade, token-launch, DeFi-core
- **References** (2): exploit references, vulnerable examples

### 6.2 SCVD Integration

- REST client with pagination (`ScvdClient`, 243 lines)
- Local JSON index with keyword/SWC/CWE search (`ScvdIndex`, 184 lines)
- Incremental sync (only fetch new since last sync)
- Auto-sync on plugin init (non-blocking via `Promise.resolve().then()`)
- Doctor command validates `/stats` endpoint availability

### 6.3 Trail of Bits Skills

- Git clone on first load: `git clone --depth 1` with 30s timeout
- **Blocking `execSync`** during config hook execution
- Iterates `plugins/*/skills/` subdirectories for skill paths
- Cached at `~/.cache/solidity-argus/trailofbits-skills/`
- **Impact**: First-time users or cleared cache → up to 30s blocking delay during OpenCode startup

### 6.4 Pattern Checker Builtins

5 regex patterns:
1. Reentrancy (external call before state update)
2. Access control (missing modifier)
3. Delegatecall (proxy risk)
4. tx.origin (phishing vector)
5. Unchecked return (silent failure)

**Missing patterns worth adding**: oracle staleness, flash loan vectors, ERC4626 inflation, signature replay, front-running/MEV, donation attack, storage collision in proxies.

---

## 7. CLI Assessment

| Command | Status | Implementation |
|---------|--------|----------------|
| `argus doctor` | Working | Checks Slither, Forge, project type, config, SCVD API |
| `argus init` | Working | Creates `.argus/solidity-argus.json` |
| `argus install` | Working | Adds plugin to `opencode.json` |
| `argus --help` | Working | Displays help text |

- Proper exit codes, `process.exitCode` (not `process.exit()`)
- Shebang for direct execution (`#!/usr/bin/env bun`)
- ANSI color output
- TUI prompts module exists (`tui-prompts.ts`) but unused by any command

---

## 8. Priority Action Items

### P0 — Must Fix Before Merge

1. **Fix split-brain audit state** (§2.1)
   - Change `createToolTrackingHook` to accept state accessor (`getAuditState`) instead of direct reference
   - Also need to address `FindingStore` coupling — it pushes to `state.findings` directly
   - ~40 lines across `tool-tracking-hook.ts`, `finding-store.ts`, `create-hooks.ts`

### P1 — Should Fix Before Release

2. **Wire AuditStateManager** (§2.2)
   - Persist state on `session.idle` via event sub-handler
   - Load on `session.created`
   - ~30 lines in `create-hooks.ts`

3. **Wire feature modules as event sub-handlers** (§2.3)
   - Pass `sessionRecovery`, `toolErrorRecovery` as sub-handlers to `createEventHookV2()`
   - Wire `contextMonitor` and `auditEnforcer` into system prompt pipeline
   - Wire `toolOutputTruncator` into tool.execute.after pipeline
   - ~50 lines

4. **Replace `node:child_process.spawn` in index.ts** with `Bun.spawn` (§4.5)
   - ~5 lines

5. **Replace blocking `execSync` git clone** in config-handler with async `Bun.spawn`
   - Or defer clone to first skill access
   - ~15 lines

### P2 — Should Fix Before 1.0

6. **Delete dead event-hook.ts (v1)** — v2 is used everywhere, v1 is unused dead code
7. **Expand builtin patterns** in pattern checker (§6.4)
8. **Use logger consistently** — replace raw `console.error` in `safe-create-hook.ts` and `knowledge-sync-hook.ts`
9. **Add test for split-brain scenario** (even after fixing — regression prevention)
10. **Document breaking changes** from package rename (`opencode-argus` → `solidity-argus`) in release notes
11. **Wire TUI prompts** into CLI init command for interactive setup

### P3 — Nice to Have

12. Add `temperature` config to agent definitions
13. Add `via_ir` field to project detector output (currently only in slither tool)
14. Consolidate `project-detector.ts` and `system-prompt-hook.ts:isSolidityProject()` — both detect project type independently

---

## 9. New Changes Since Previous Assessment

### 9.1 Subagent Permission Migration (commit `55b24e7`)

Sentinel, Pythia, and Scribe migrated from deprecated `tools: { argus_x: true } satisfies Record<string, boolean>` to `permission: { argus_x: "allow", skill: "allow" }`. Argus retains `tools` for wildcard denials (glob patterns not supported by `permission`).

**Assessment**: Clean migration. Tests updated. No behavioral change — just API modernization.

### 9.2 Skill Index in System Prompt (commit `3e254d7` + related)

System prompt hook now builds a live snapshot of available skills (count + sample names) and injects it into the audit context block. Supports bundled, Trail of Bits, and custom skill sources.

**Assessment**: Good feature. Makes skills discoverable to the agent at runtime. One concern: the snapshot is built once at hook creation time — if skills are added/removed during a session, the counts will be stale. This is acceptable since skills rarely change mid-session.

### 9.3 via_ir Auto-Detection (commit `1492bc8`)

Slither tool now reads `foundry.toml` and auto-detects `via_ir = true`. When detected, bypasses direct Slither (which fails on via_ir projects) and goes straight to flatten fallback.

**Assessment**: Good defensive improvement. Prevents confusing Slither failures for users with via_ir projects. The regex-based TOML parsing (`/^\s*via[_-]ir\s*=\s*true/m`) is simple but sufficient — a full TOML parser would be overkill.

### 9.4 Agent Prompt Skill Sections

All 4 agent prompts now include curated skill maps with deterministic trigger rules:
- Argus: 9 named skills + 4 Trail of Bits skills with trigger conditions
- Sentinel: Testing and analysis skills
- Pythia: Research and vulnerability pattern skills
- Scribe: Report template and severity classification skills

**Assessment**: Good addition. Makes the multi-agent system skill-aware. The deterministic triggers (e.g., "load oracle-manipulation if price feeds detected") help agents self-select relevant skills.

---

## 10. Architectural Observations

### 10.1 Duplicate Project Detection Logic

Two separate implementations detect whether the current directory is a Solidity project:
- `src/hooks/system-prompt-hook.ts:29-37`: `isSolidityProject()` — async, uses `Bun.file().exists()`
- `src/utils/project-detector.ts:19-73`: `detectProject()` — async, uses `Bun.file().exists()`, returns full `ProjectConfig`

The system prompt hook only needs a boolean check, but the project detector provides richer information (src dir, test dir, solc version, remappings, via_ir). Consider having the system prompt hook use `detectProject()` instead.

### 10.2 Config Handler Size and Responsibility

`config-handler.ts` (150 lines) handles:
- Agent registration (4 agents with prompts, models, permissions)
- MCP registration (Solodit)
- Skills path registration (bundled + custom + Trail of Bits)
- Trail of Bits git clone
- Knowledge auto-sync trigger

This is the "god function" of the plugin. Consider extracting Trail of Bits cloning and skills registration into a separate module.

### 10.3 FindingStore Tight Coupling

`FindingStore` (created by `createFindingStore(state)`) holds a reference to the `AuditState` object and pushes directly to `state.findings`. This makes it impossible to swap the underlying state without creating a new store — which is why the split-brain bug exists and is non-trivial to fix.

Consider making FindingStore state-independent: have it maintain its own findings array and provide a `getFindings()` method that external code can use to sync to whatever state is current.

---

## 11. Conclusion

The codebase is architecturally sound with strong testing, clean types, and good separation of concerns. The overhaul successfully achieved its goals: factory decomposition, multi-level config, CLI, hook guards, and multi-plugin safety.

**The single blocking issue is the split-brain audit state (§2.1)** — without this fix, the tool tracking → system prompt → compaction pipeline is broken, and the agent cannot see its own findings during an audit session. This should be the #1 priority before merging to main.

**The second priority is wiring the 7 disconnected feature modules (§2.2, §2.3)** — the code is written, tested, and ready to plug in. It's a wiring exercise, not a development exercise.

Everything else (permission migration, skill system, via_ir detection, CLI) is in good shape and production-ready.
