# Argus Plugin: Full Architectural Overhaul

## TL;DR

> **Quick Summary**: Restructure opencode-argus from a monolithic plugin into a modular factory-based architecture modeled after oh-my-opencode (OMO), adding background agent management, error recovery, persistent audit state, context window management, audit continuation enforcement, and a full CLI — while preserving all existing domain-specific functionality (8 tools, 4 agents, 55 SKILL.md files, SCVD integration).
> 
> **Deliverables**:
> - Modular factory architecture: `create-tools.ts`, `create-hooks.ts`, `create-managers.ts`, `plugin-interface.ts`
> - 10+ shared utility modules (logger, deep merge, JSONC parser, file utils, etc.)
> - New multi-level config system (user + project with deep merge)
> - Manager layer: BackgroundManager, AuditStateManager
> - 7+ new hooks: error recovery, context window monitor, tool output truncator, audit continuation enforcer, hook message injector
> - Persistent audit state (survives session restarts)
> - Hook enable/disable via `disabled_hooks` config
> - Full CLI: `argus doctor`, `argus init`, `argus install` with TUI prompts
> - All 23 existing tests pass + new TDD tests for every new module
> 
> **Estimated Effort**: XL (~3-4 weeks equivalent)
> **Parallel Execution**: YES - 5 waves
> **Critical Path**: Task 1-3 (types/utils) → Task 8-11 (factories) → Task 14 (plugin-interface) → Task 27 (new index.ts) → Task 30 (test migration)

---

## Context

### Original Request
Compare opencode-argus with oh-my-opencode to identify missing features, architectural enhancements, and structural improvements. User decided on full overhaul adopting OMO patterns.

### Interview Summary
**Key Discussions**:
- OMO uses factory decomposition (create-hooks/tools/managers + plugin-interface) vs Argus monolithic index.ts
- OMO has 40+ hooks vs Argus 6; 19 feature modules vs Argus 0; 60+ shared utils vs Argus 2
- OMO has BackgroundManager, TmuxSessionManager, persistent boulder state — all missing from Argus
- OMO supports multi-level config (user + project) with deep merge — Argus has single file only
- Argus has STRONG domain-specific capabilities OMO lacks: 55 SKILL.md files, SCVD, Solodit MCP, structured finding aggregation

**Research Findings**:
- Argus `index.ts` returns: `tool`, `config`, `experimental.chat.system.transform`, `experimental.session.compacting`, `tool.execute.after`, `event`
- OMO hooks use `isHookEnabled(hookName)` guard with `disabled_hooks` Set
- OMO config uses `detectConfigFile`, `parseJsonc` (shared), `deepMerge` (shared), `migrateConfigFile`
- Argus audit state uses closure-based sharing via `getAuditState`/`setAuditState`
- Argus has 23 existing test files using `bun:test` — all must continue passing

### Plugin Ecosystem Best Practices (Multi-Plugin Safety)
**Argus is designed standalone-first. These patterns ensure it works correctly as the ONLY plugin, AND plays well when any other plugin (like oh-my-opencode) is co-installed.**

**Core rule**: OpenCode chains plugin hooks via output mutation. Multiple plugins share the same `output` object. Argus must NEVER assume it's the only writer.

| Issue | Severity | Standalone Impact | Multi-Plugin Impact | Fix Applied In |
|-------|----------|------------------|---------------------|----------------|
| System prompt array collapse | CRITICAL | Collapses OpenCode's own system entries | Destroys other plugins' entries | Task 14, 26 |
| Compaction context collapse | CRITICAL | Loses OpenCode's compaction context | Destroys other plugins' preserved state | Task 14, 26 |
| Tool output processing order | HIGH | N/A standalone | Other plugins may truncate before Argus reads | Task 14, 26 (`tool.execute.before`) |
| Idle event continuation | MODERATE | Works fine standalone | May conflict with other continuation enforcers | Task 19 (uses system prompt injection) |
| Solodit MCP port hardcoded | MODERATE | Port 3000 may conflict with user's dev server | Same | Task 25, Task 2 (configurable port) |
| Context pressure | LOW | Minimal standalone | Combined injections eat context faster | Task 17 (adaptive injection size) |

**Key Pattern Rule**: All hooks MUST use `output.system.push()` / `output.context.push()`, NEVER `output.system = [...]` / `output.context = [...]`. This is correct plugin behavior regardless of whether other plugins exist.

### Recent Code Changes (last 3 commits since session start)
**Must be reflected in plan references:**
- `config-handler.ts` now imports from `@opencode-ai/sdk/v2`, adds Trail of Bits skill cloning, agent `permission`/`tools` fields
- `slither-tool.ts` expanded to 523 lines with `flattenFallback()`, `FlattenFallbackDeps` DI pattern, `hasBinary()`, `parseSolcVersion()`, `extractContractNames()`
- Scribe default model: `claude-sonnet-4-6` (was `claude-sonnet-4-5`)
- `knowledge-sync-hook` import removed from `index.ts` (moved into config-handler)

### Metis Review
**Identified Gaps** (addressed):
- Config backward compatibility: User chose clean break — no migration needed
- CLI scope: User chose full CLI — installer, doctor, TUI
- Test strategy: TDD confirmed — tests first for all new code
- Plugin API contract: Must return same hook signature types as current index.ts to remain compatible with OpenCode
- OMO co-existence: 7 conflict vectors identified and resolved in plan (see above)

---

## Work Objectives

### Core Objective
Restructure opencode-argus into a modular, factory-based architecture while adding infrastructure features from OMO's patterns, preserving 100% of existing domain functionality.

### Concrete Deliverables
- `src/shared/` — 10+ utility modules (logger, deep-merge, jsonc-parser, file-utils, etc.)
- `src/config/` — New config schema + multi-level loader
- `src/managers/` — BackgroundManager, AuditStateManager
- `src/features/` — Feature modules (background-agent, persistent-state, context-monitor, etc.)
- `src/create-tools.ts`, `src/create-hooks.ts`, `src/create-managers.ts`, `src/plugin-interface.ts` — Factory composition
- `src/cli/` — CLI entry point + doctor, init, install commands + TUI prompts
- New `src/index.ts` — Slim compositor calling factories
- Updated `package.json` with `bin` entry for CLI

### Definition of Done
- [x] `bun test` passes (all 23 existing + all new tests)
- [x] `bun run typecheck` passes (zero type errors)
- [x] Plugin loads in OpenCode and registers 4 agents + 8 tools
- [x] `argus doctor` CLI command executes and reports Slither/Foundry status
- [x] Config reads from both user-level and project-level locations
- [x] Audit state persists across session restarts (verified by file existence)
- [x] Hooks can be individually disabled via `disabled_hooks` config array

### Must Have
- All 8 existing tools work identically (slither, forge test, forge fuzz, analyze contract, check patterns, solodit search, generate report, sync knowledge)
- All 4 agents register with correct prompts, models, and tool restrictions
- All 55 SKILL.md files remain accessible to agents
- SCVD integration and Solodit MCP continue working
- System prompt injection for Solidity projects works
- Compaction hook preserves audit context
- Tool tracking aggregates findings

### Must NOT Have (Guardrails)
- NO changes to agent prompt content (argus-prompt.ts, sentinel-prompt.ts, etc.) — only structural refactoring
- NO changes to tool behavior — only how tools are registered/composed
- NO new npm dependencies beyond what exists (use Bun APIs where possible)
- NO removal of existing test files — only additions and migrations
- NO multi-platform binary distribution (out of scope; OMO has this, we don't need it)
- NO Claude Code compatibility layer (Argus is domain-specific, not general-purpose)
- NO changes to skills/ directory structure or content
- NO "AI slop" — no excessive comments, no over-abstraction, no generic variable names
- **NO `output.system = [...]` or `output.context = [...]` patterns** — ALWAYS push to arrays, never replace (OMO co-existence critical rule)
- NO hardcoded ports — all network ports must be configurable
- NO idle-event-based continuation prompts — use system prompt injection to avoid conflicting with OMO's todo-continuation-enforcer
- **NO circular imports** — if TypeScript reports circular dependency, refactor via interface extraction. The module graph (config → hooks → config-handler → knowledge-sync → config) must be acyclic.
- **NO `config.agent = { ... }` without spread** — always `config.agent = { ...config.agent, ... }` (same for config.mcp, config.skills). This is the config-handler equivalent of "never replace arrays."
- **NO agent registration outside config-handler** — agent registration (`config.agent = ...`) MUST only happen in config-handler. No other hook or factory may modify `config.agent`.
- **NO writing to project directory during tests** — all file-system tests MUST use temp directories (`mkdtempSync`). Never write to actual project directory.
- **NO tokenizer libraries for context estimation** — chars/4 heuristic ONLY. If estimation is off by 30%, acceptable. No tiktoken or similar.
- **NO event bus, pub/sub, or event replay in Event v2 (Task 20)** — only typed event names and delegation to existing sub-handlers.
- **NO spinners, progress bars, or ASCII art in CLI** — plain ANSI colors only (green ✓, red ✗, yellow ⚠).
- **NO full task queue in Background Manager (Task 12)** — `BackgroundManager` is an abstraction with injectable dispatcher function. Actual OpenCode task API integration deferred until that API is documented.

### Architectural Decisions (Unanswered Questions Resolved)
- **`plugin-config.ts` after migration**: DELETE it in Task 25 (new index.ts) after confirming all imports moved to `src/config/`. It cannot coexist with the new system — single source of truth only.
- **`finding-store.ts`**: UNCHANGED in this overhaul. Used by `tool-tracking-hook.ts` and `audit-state.ts`. No task modifies it. Noted here explicitly so executor doesn't accidentally touch it.
- **`createAuditState` vs `AuditStateManager`**: The manager (Task 13) WRAPS the existing factory. `createAuditState()` still creates the initial in-memory state. `AuditStateManager` adds persistence (load/save to disk) and update semantics on top. The existing `createAuditState` function in `audit-state.ts` is NOT replaced.
- **`startSoloditMcp()` ownership**: Stays in the new `index.ts` compositor (Task 25). It's a startup side-effect that doesn't belong in any factory — it's plugin lifecycle, not composition. The compositor calls it before returning the plugin interface.
- **`dist/` build output**: Task 28 updates package.json but does NOT change the build command. The current `bun build src/index.ts --outdir dist` works because `index.ts` is still the entry point. CLI has its own entry via `bin` field. If build changes are needed, they'll surface during Task 28 and the executor should update the build command.

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (bun:test, 23 existing test files)
- **Automated tests**: TDD (RED → GREEN → REFACTOR for all new code)
- **Framework**: bun:test
- **Pattern**: Each task writes failing tests first, then implements to pass them

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

| Deliverable Type | Verification Tool | Method |
|------------------|-------------------|--------|
| Shared utilities | Bash (bun test) | Run unit tests, verify exports |
| Config system | Bash (bun test) | Test config loading, merging, validation |
| Hooks/Features | Bash (bun test) | Unit tests + integration with mock plugin context |
| Factory composition | Bash (bun test) | Integration test verifying plugin returns correct shape |
| CLI | interactive_bash (tmux) | Run CLI commands, verify output |
| Full plugin | Bash (bun test + bun run typecheck) | All tests pass + zero type errors |

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — types, utilities, scaffolding):
├── Task 1: Shared utility modules (logger, deep-merge, jsonc-parser, file-utils) [quick]
├── Task 2: New config schema + types (Zod, clean break) [quick]
├── Task 3: Hook system types + isHookEnabled infrastructure [quick]
├── Task 4: Manager interfaces and types [quick]
├── Task 5: Plugin state types (persistent audit state, plugin state) [quick]
├── Task 6: CLI scaffold (entry point, argument parser, command framework) [quick]
└── Task 7: Feature module scaffolding (directory structure + barrel exports) [quick]

Wave 2 (Core Architecture — factories + infrastructure, has sub-waves):
│ Wave 2a (parallel — start immediately after Wave 1):
├── Task 8: Multi-level config loader (user + project, deep merge) [unspecified-high]
├── Task 9: create-tools.ts factory [unspecified-high]
├── Task 10: create-hooks.ts factory with isHookEnabled guards [deep]
├── Task 12: Background agent manager [deep]
├── Task 13: Persistent audit state manager (file-based) [deep]
│ Wave 2b (after T12 + T13 complete):
├── Task 11: create-managers.ts factory (depends on 12, 13) [unspecified-high]
│ Wave 2c (after T8-T11 complete):
└── Task 14: plugin-interface.ts compositor (depends on 8-11) [unspecified-high]

Wave 3 (Features + CLI — all parallel, hooks independent of CLI):
├── Task 15: Session recovery hook [unspecified-high]
├── Task 16: Tool error recovery hook [unspecified-high]
├── Task 17: Context window monitor + proactive compaction [deep]
├── Task 18: Tool output truncator hook [unspecified-high]
├── Task 19: Audit continuation enforcer (7-step methodology) [deep]
├── Task 20: Event system improvements (richer types, lifecycle) [unspecified-high]
├── Task 21: CLI doctor command (Slither/Foundry/config diagnostics) [unspecified-high]
├── Task 22: CLI init command (create config, detect project) [unspecified-high]
├── Task 23: CLI install command (configure plugin in opencode config) [unspecified-high]
└── Task 24: CLI TUI prompts module (interactive setup) [visual-engineering]

Wave 4 (Integration — sequential, depends on everything above):
├── Task 25: New index.ts compositor (replace monolithic entry point) [deep]
├── Task 26: Migrate existing 6 hooks to factory pattern [deep]
├── Task 27: Migrate existing 8 tools to factory pattern [deep]
├── Task 28: Update package.json (bin entry, exports, new scripts) [quick]
├── Task 29: Update AGENTS.md for new architecture [quick]
└── Task 30: Migrate + update all existing tests [deep]

Wave FINAL (Verification — 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: T1-T3 → T8,T10 → T14 → T25 → T30 → F1-F4
Parallel Speedup: ~65% faster than sequential
Max Concurrent: 10 (Wave 3)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|------------|--------|------|
| 1 | — | 8, 9, 10, 11, 12, 13, 14, 15-20 | 1 |
| 2 | — | 8, 10, 11, 14, 25 | 1 |
| 3 | — | 10, 15-20, 25, 26 | 1 |
| 4 | — | 11, 12, 13 | 1 |
| 5 | — | 12, 13, 25 | 1 |
| 6 | — | 21, 22, 23, 24 | 1 |
| 7 | — | 15-20 | 1 |
| 8 | 1, 2 | 14, 21, 22, 25 | 2 |
| 9 | 1 | 14, 25, 27 | 2 |
| 10 | 1, 2, 3 | 14, 25, 26 | 2 |
| 11 | 1, 4, **12, 13** | 14, 25 | 2b |
| 12 | 1, 4 | 11, 25 | 2a |
| 13 | 1, 4, 5 | 11, 25 | 2a |
| 14 | 8, 9, 10, 11 | 25 | 2c |
| 15 | 3, 7, 10 | 25, 26 | 3 |
| 16 | 3, 7, 10 | 25, 26 | 3 |
| 17 | 3, 7, 10 | 25, 26 | 3 |
| 18 | 3, 7, 10 | 25, 26 | 3 |
| 19 | 3, 7, 10 | 25, 26 | 3 |
| 20 | 3, 7 | 25, 26 | 3 |
| 21 | 1, 6, 8 | 28 | 3 |
| 22 | 1, 6, 8 | 28 | 3 |
| 23 | 1, 6, 8 | 28 | 3 |
| 24 | 6 | 21, 22, 23 (SOFT — CLI commands fall back to defaults without TUI) | 3 |
| 25 | 14, all Wave 3 hooks | 30 | 4 |
| 26 | 10, 3 | 30 | 4 |
| 27 | 9 | 30 | 4 |
| 28 | 6, 21-23, 25 | — | 4 |
| 29 | 25 | — | 4 |
| 30 | 25, 26, 27 | F1-F4 | 4 |

### Agent Dispatch Summary

| Wave | # Parallel | Tasks → Agent Category |
|------|------------|----------------------|
| 1 | **7** | T1-T7 → `quick` |
| 2 | **7** | T8,T9,T11,T14 → `unspecified-high`, T10,T12,T13 → `deep` |
| 3 | **10** | T15,T16,T18,T20-T23 → `unspecified-high`, T17,T19 → `deep`, T24 → `visual-engineering` |
| 4 | **6** | T25-T27,T30 → `deep`, T28-T29 → `quick` |
| FINAL | **4** | F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep` |

---

## TODOs

### Wave 1 — Foundation (7 parallel, quick)

- [x] 1. Shared Utility Modules: Logger, Deep Merge, JSONC Parser, File Utils

  **What to do**:
  - TDD: Write failing tests in `src/shared/*.test.ts` for each utility
  - Create `src/shared/logger.ts` — structured stderr logger with `[argus]` prefix and optional debug flag
  - Create `src/shared/deep-merge.ts` — recursive object merge for config overlay (arrays concat + dedup, objects recurse)
  - Create `src/shared/jsonc-parser.ts` — replaces hand-rolled `stripJsoncComments` from current `plugin-config.ts`. Handles `//`, `/* */`, and trailing commas
  - Create `src/shared/file-utils.ts` — `detectConfigFile(basePath)` returns `{path, format: 'json'|'jsonc'|'none'}`, `readJsoncFile(path)` returns parsed object or null
  - Create `src/shared/binary-utils.ts` — Extract `hasBinary(name: string): boolean` from `src/tools/slither-tool.ts:197-212`. Also extract `parseSolcVersion(output: string): string | null` and `extractContractNames(stdout: string): string[]` as they are general-purpose utilities used by multiple tools. Original slither-tool.ts should import from shared after Task 27 migration.
  - Create `src/shared/index.ts` — barrel export for all shared utilities
  - Each module must be independently importable and have zero side effects

  **Must NOT do**:
  - Do NOT add new npm dependencies — use Bun APIs
  - Do NOT use `console.log` — only `console.error` (via logger)
  - Do NOT create utilities not listed here — no speculative abstractions
  - Do NOT modify `slither-tool.ts` here — just create the shared module. Tool migration to import from shared happens in Task 27

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small, self-contained utility modules with clear interfaces
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `git-master`: No git operations in this task

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2-7)
  - **Blocks**: Tasks 8-14 (all Wave 2 tasks use shared utils)
  - **Blocked By**: None

  **References**:

  **Pattern References** (existing code to follow):
  - `src/plugin-config.ts:86-119` — Current `stripJsoncComments` implementation to REPLACE (move logic to shared/jsonc-parser.ts)
  - `src/hooks/event-hook.ts:41-43` — Current `console.error` logging pattern to STANDARDIZE via logger
  - `src/tools/slither-tool.ts:144-204` — All 3 functions to EXTRACT into shared/binary-utils.ts: `parseSolcVersion` (144-184), `extractContractNames` (186-195), `hasBinary` (197-204)

  **API/Type References**:
  - `@opencode-ai/plugin` — No direct dependency; shared utils are standalone

  **External References** (OMO patterns to follow):
  - OMO `src/shared/deep-merge.ts` — Deep merge with array dedup pattern
  - OMO `src/shared/jsonc-parser.ts` — JSONC parsing with proper validation
  - OMO `src/shared/logger.ts` — Structured stderr logging
  - OMO `src/shared/file-utils.ts` — Config file detection pattern

  **WHY Each Reference Matters**:
  - Current `stripJsoncComments` is 30+ lines of fragile string parsing — extract to testable utility
  - Logger standardizes all debug output under `[argus]` namespace instead of scattered `console.error`
  - Deep merge is critical for multi-level config (Task 8) — must handle nested objects + array dedup

  **Acceptance Criteria**:

  - [ ] Test file created: `src/shared/logger.test.ts` — tests log output format, debug flag, prefix
  - [ ] Test file created: `src/shared/deep-merge.test.ts` — tests nested objects, array dedup, undefined handling
  - [ ] Test file created: `src/shared/jsonc-parser.test.ts` — tests `//` comments, `/* */` blocks, trailing commas, strings with `//` inside
  - [ ] Test file created: `src/shared/file-utils.test.ts` — tests JSON/JSONC detection, missing file handling
  - [ ] Test file created: `src/shared/binary-utils.test.ts` — tests `hasBinary` with existing/missing binaries, `parseSolcVersion` with valid/invalid output, `extractContractNames` with various stdout formats
  - [ ] `bun test src/shared/` → PASS (all tests green)

  **QA Scenarios**:

  ```
  Scenario: Logger outputs to stderr with correct prefix
    Tool: Bash (bun test)
    Preconditions: Logger module exists at src/shared/logger.ts
    Steps:
      1. Run `bun test src/shared/logger.test.ts`
      2. Verify test asserts output contains `[argus]` prefix
      3. Verify debug messages suppressed when debug=false
    Expected Result: All logger tests pass
    Evidence: .sisyphus/evidence/task-1-logger-tests.txt

  Scenario: Deep merge handles nested config correctly
    Tool: Bash (bun test)
    Preconditions: Deep merge module exists at src/shared/deep-merge.ts
    Steps:
      1. Run `bun test src/shared/deep-merge.test.ts`
      2. Verify test covers: nested objects, array concat+dedup, undefined skip
    Expected Result: All deep-merge tests pass
    Evidence: .sisyphus/evidence/task-1-deep-merge-tests.txt

  Scenario: JSONC parser handles edge cases
    Tool: Bash (bun test)
    Preconditions: JSONC parser exists at src/shared/jsonc-parser.ts
    Steps:
      1. Run `bun test src/shared/jsonc-parser.test.ts`
      2. Verify handles: `// line comment`, `/* block */`, trailing comma, `"url": "http://foo"` (// inside string)
    Expected Result: All jsonc-parser tests pass, including string-with-slash edge case
    Evidence: .sisyphus/evidence/task-1-jsonc-parser-tests.txt
  ```

  **Commit**: YES
  - Message: `feat(shared): add logger, deep-merge, jsonc-parser, file-utils`
  - Files: `src/shared/*.ts`
  - Pre-commit: `bun test src/shared/`

- [x] 2. New Config Schema + Types (Clean Break)

  **What to do**:
  - TDD: Write failing tests in `src/config/schema.test.ts`
  - Create `src/config/schema.ts` — New Zod schema for Argus config replacing current `ArgusConfigSchema`
  - New schema must support: `agents` (model overrides + `permission` object for task delegation + `tools` map for tool access control — see `src/hooks/config-handler.ts:43-86` for the pattern), `tools` (paths), `knowledge` (SCVD config), `reporting`, `solodit` (with `port` field, default 3000), `disabled_hooks` (string array), `hooks` (hook-specific config), `cli` (CLI preferences), `background` (concurrency limits with `max_concurrent` default 3)
  - Agent config schema must include: `model: z.string().optional()`, `permission: z.record(z.record(z.string())).optional()` (for task delegation), `tools: z.record(z.boolean()).optional()` (for tool access control). **Intent: Document and codify current defaults in the schema, NOT change behavior.** Task 26 preserves the current hardcoded values as defaults. Schema values, if provided by user config, deep merge on top of defaults — enabling power users to adjust tool access without code changes, but out-of-the-box behavior is identical to today. This is NOT a behavior change — it's making implicit behavior explicit and configurable.
  - Note: config-handler currently imports from `@opencode-ai/sdk/v2` (not `@opencode-ai/plugin`). The new config system must use the same SDK v2 `Config` type for the config hook parameter. Verify `@opencode-ai/sdk/v2` is importable — if it's a subpath export of `@opencode-ai/plugin`, document this. If separate package, add to `peerDependencies`.
  - Create `src/config/types.ts` — Export inferred types from schema
  - Create `src/config/index.ts` — Barrel export
  - The schema must validate with `safeParse` (not `parse`) — collect errors, don't throw

  **Must NOT do**:
  - Do NOT create the config LOADER here (that's Task 8)
  - Do NOT implement backward compatibility — clean break as decided
  - Do NOT add config options not listed — defer to actual need

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Schema definition is a focused, single-module task
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3-7)
  - **Blocks**: Task 8 (config loader), Task 10 (hooks factory), Task 14 (plugin-interface)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/plugin-config.ts:5-82` — Current Zod schema to REPLACE (copy valid parts, extend with new fields)
  - `src/plugin-config.ts:84` — Current `ArgusConfig` type export pattern
  - `src/hooks/config-handler.ts:36-87` — Current config handler showing `permission` and `tools` fields on agent registration. The new schema must capture these as configurable options (currently hardcoded in config-handler, should be schema-driven)
  - `src/hooks/config-handler.ts:5` — `import type { Config } from "@opencode-ai/sdk/v2"` — the SDK v2 Config type used for config hook parameter

  **External References**:
  - OMO `src/config/schema.ts` — Config schema with `disabled_hooks`, `disabled_agents`, categories pattern
  - Zod docs: `z.safeParse()` for non-throwing validation

  **WHY Each Reference Matters**:
  - Current schema is the baseline — must preserve `agents`, `tools`, `knowledge`, `reporting`, `solodit` fields
  - config-handler.ts shows `permission` (task delegation) and `tools` (tool access control) are critical agent config fields currently hardcoded — new schema should make them configurable while preserving defaults
  - OMO schema shows how `disabled_hooks` array integrates with hook enable/disable system

  **Acceptance Criteria**:

  - [ ] Test file: `src/config/schema.test.ts` with tests for: valid config, invalid config, missing fields (defaults), disabled_hooks array
  - [ ] `bun test src/config/` → PASS
  - [ ] Schema preserves all existing config fields from current `ArgusConfigSchema`
  - [ ] Schema adds: `disabled_hooks: z.array(z.string()).default([])`

  **QA Scenarios**:

  ```
  Scenario: Schema validates current valid config
    Tool: Bash (bun test)
    Preconditions: Schema exists at src/config/schema.ts
    Steps:
      1. Run `bun test src/config/schema.test.ts`
      2. Verify test parses config with agents, tools, knowledge, reporting, solodit
      3. Verify safeParse returns success=true with data
    Expected Result: All schema tests pass
    Evidence: .sisyphus/evidence/task-2-schema-tests.txt

  Scenario: Schema provides defaults for missing fields
    Tool: Bash (bun test)
    Preconditions: Schema exists
    Steps:
      1. Test: parse empty object `{}`
      2. Assert disabled_hooks defaults to []
      3. Assert agents defaults match DEFAULT_MODELS
    Expected Result: All default value tests pass
    Evidence: .sisyphus/evidence/task-2-defaults-tests.txt
  ```

  **Commit**: YES
  - Message: `feat(config): new config schema with Zod types`
  - Files: `src/config/*.ts`
  - Pre-commit: `bun test src/config/`

- [x] 3. Hook System Types + isHookEnabled Infrastructure

  **What to do**:
  - TDD: Write failing tests in `src/hooks/hook-system.test.ts`
  - Create `src/hooks/types.ts` — Define `HookName` union type (all current hook names + new ones: `"system-prompt"`, `"compaction"`, `"tool-tracking"`, `"event"`, `"knowledge-sync"`, `"session-recovery"`, `"tool-error-recovery"`, `"context-window-monitor"`, `"tool-output-truncator"`, `"audit-continuation"`)
  - Create `src/hooks/hook-system.ts` — `createHookGuard(disabledHooks: string[])` returns `isHookEnabled(name: HookName) => boolean`
  - Create `src/hooks/safe-create-hook.ts` — Wrapper that catches hook errors and logs them instead of crashing the plugin (modeled after OMO's `safe-create-hook.ts`)
  - Update `src/hooks/index.ts` barrel export

  **Must NOT do**:
  - Do NOT modify existing hook implementations — only add infrastructure
  - Do NOT import from config module (avoid circular deps — accept `string[]` parameter)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Type definitions and a guard function — small, focused
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4-7)
  - **Blocks**: Task 10 (create-hooks factory), Tasks 15-20 (all new hooks)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/hooks/event-hook.ts:28-71` — Current hook pattern (factory function returning hook fn)
  - `src/hooks/system-prompt-hook.ts:111-126` — Current hook factory signature

  **External References**:
  - OMO `src/shared/safe-create-hook.ts` — Error-catching hook wrapper pattern
  - OMO `src/config/schema.ts` — `HookName` type definition pattern

  **WHY Each Reference Matters**:
  - Existing hooks show the factory pattern we need `isHookEnabled` to guard
  - OMO's safe-create-hook prevents one broken hook from crashing the entire plugin

  **Acceptance Criteria**:

  - [ ] `src/hooks/types.ts` defines `HookName` union type with all 10+ hook names
  - [ ] `src/hooks/hook-system.ts` exports `createHookGuard`
  - [ ] `src/hooks/safe-create-hook.ts` exports error-catching wrapper
  - [ ] `bun test src/hooks/hook-system.test.ts` → PASS

  **QA Scenarios**:

  ```
  Scenario: Hook guard correctly enables/disables hooks
    Tool: Bash (bun test)
    Steps:
      1. Run `bun test src/hooks/hook-system.test.ts`
      2. Verify: guard with empty disabled list → all enabled
      3. Verify: guard with ["system-prompt"] → system-prompt disabled, others enabled
    Expected Result: All hook guard tests pass
    Evidence: .sisyphus/evidence/task-3-hook-guard-tests.txt

  Scenario: Safe create hook catches errors
    Tool: Bash (bun test)
    Steps:
      1. Test: wrap a throwing function in safeCreateHook
      2. Assert: wrapper does NOT throw, logs error via logger
    Expected Result: Error caught, logged, not propagated
    Evidence: .sisyphus/evidence/task-3-safe-hook-tests.txt
  ```

  **Commit**: YES (groups with Tasks 4-5)
  - Message: `feat(hooks): add hook system types and isHookEnabled infrastructure`
  - Files: `src/hooks/types.ts`, `src/hooks/hook-system.ts`, `src/hooks/safe-create-hook.ts`
  - Pre-commit: `bun test src/hooks/`

- [x] 4. Manager Interfaces and Types

  **What to do**:
  - Create `src/managers/types.ts` — Define interfaces: `BackgroundManager` (dispatch, cancel, getResult, onComplete), `AuditStateManager` (load, save, get, update, reset)
  - Create `src/managers/index.ts` — Barrel export
  - Interfaces only — NO implementations (those are Tasks 12-13)

  **Must NOT do**:
  - Do NOT implement managers — only define contracts
  - Do NOT import from other modules — interfaces should be standalone

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure type definitions, no logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-3, 5-7)
  - **Blocks**: Tasks 11-13 (manager implementations)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/state/types.ts` — Current AuditState type to reference for AuditStateManager interface

  **External References**:
  - OMO `src/features/background-agent/` — BackgroundManager interface pattern
  - OMO `src/create-managers.ts` — Manager type exports

  **Acceptance Criteria**:

  - [ ] `src/managers/types.ts` defines `BackgroundManager` and `AuditStateManager` interfaces
  - [ ] `bun run typecheck` passes with new types

  **QA Scenarios**:

  ```
  Scenario: Types are valid and export correctly
    Tool: Bash (bun run typecheck)
    Steps:
      1. Run `bun run typecheck`
      2. Verify zero new type errors introduced
    Expected Result: Typecheck passes
    Evidence: .sisyphus/evidence/task-4-typecheck.txt
  ```

  **Commit**: YES (groups with Task 3 and 5)
  - Message: `feat(types): add manager interfaces and plugin state types`
  - Files: `src/managers/*.ts`
  - Pre-commit: `bun run typecheck`

- [x] 5. Plugin State Types (Persistent Audit State, Plugin State)

  **What to do**:
  - TDD: Write tests in `src/state/plugin-state.test.ts`
  - Create `src/state/plugin-state.ts` — Define `PluginState` type (holds config, audit state ref, hook guard, managers). This is the "closure replacement" — structured state instead of ad-hoc closure variables
  - Extend `src/state/types.ts` — Add `PersistentAuditState` type that includes serialization fields: `savedAt: number`, `version: string`, `filePath: string`
  - **KEEP existing `AuditPhase` values**: `"reconnaissance" | "scanning" | "manual-review" | "attack-surface" | "research" | "testing" | "reporting" | "complete"` — these are already used in production tests (`audit-state.test.ts:368,432`). Do NOT rename `"scanning"` to `"automated-scanning"` or `"research"` to `"vulnerability-research"` — that's a breaking change to a public type. If you want longer names, add them as ALIASES in a separate `AuditPhaseLabel` map, but the enum values stay unchanged.

  **Must NOT do**:
  - Do NOT implement persistence logic — only types (implementation is Task 13)
  - Do NOT modify existing `AuditState` type or `AuditPhase` values — extend only. Existing values `"scanning"` and `"research"` are used in tests and must be preserved

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 12-13 (manager implementations)
  - **Blocked By**: None

  **References**:
  - `src/state/types.ts` — Current `AuditState` type (EXTEND, don't replace)
  - `src/state/audit-state.ts` — Current factory pattern to preserve
  - OMO `src/plugin-state.ts` — Plugin state structure pattern

  **Acceptance Criteria**:
  - [ ] `src/state/types.ts` extended with `PersistentAuditState` and `AuditPhase`
  - [ ] `src/state/plugin-state.ts` defines `PluginState` type
  - [ ] `bun run typecheck` passes

  **QA Scenarios**:
  ```
  Scenario: Extended types compile and are compatible
    Tool: Bash (bun run typecheck)
    Steps:
      1. Run `bun run typecheck`
      2. Verify existing code using AuditState still compiles
    Expected Result: Zero new type errors
    Evidence: .sisyphus/evidence/task-5-typecheck.txt
  ```

  **Commit**: YES (groups with Tasks 3-4)
  - Message: `feat(types): add manager interfaces and plugin state types`
  - Files: `src/state/plugin-state.ts`, `src/state/types.ts`
  - Pre-commit: `bun run typecheck`

- [x] 6. CLI Scaffold (Entry Point, Argument Parser, Command Framework)

  **What to do**:
  - TDD: Write tests in `src/cli/cli-program.test.ts`
  - Create `src/cli/cli-program.ts` — Main CLI entry using Bun's built-in arg parsing (`Bun.argv`). Registers subcommands: `doctor`, `init`, `install`
  - Create `src/cli/types.ts` — CLI command interface: `{ name: string, description: string, execute: (args: string[]) => Promise<number> }`
  - Create `src/cli/index.ts` — Entry point that parses args and dispatches to subcommand
  - Create stub commands that print "not implemented" (actual implementations in Tasks 21-23)
  - Add `"bin": { "argus": "./src/cli/index.ts" }` pattern (will be finalized in Task 28)

  **Must NOT do**:
  - Do NOT implement actual CLI commands — stubs only
  - Do NOT add CLI framework dependencies (commander, yargs) — use Bun.argv

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 21-24 (CLI command implementations)
  - **Blocked By**: None

  **References**:
  - OMO `src/cli/cli-program.ts` — CLI program structure
  - OMO `src/cli/types.ts` — Command type pattern
  - Bun docs: `Bun.argv` for argument parsing

  **Acceptance Criteria**:
  - [ ] `src/cli/cli-program.ts` exists with subcommand registration
  - [ ] `src/cli/index.ts` parses `doctor`, `init`, `install` subcommands
  - [ ] Running with unknown command shows help text
  - [ ] `bun test src/cli/cli-program.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: CLI shows help with no arguments
    Tool: Bash
    Steps:
      1. Run `bun src/cli/index.ts`
      2. Assert output contains "argus" and lists available commands
    Expected Result: Help text displayed, exit code 0
    Evidence: .sisyphus/evidence/task-6-cli-help.txt

  Scenario: CLI handles unknown subcommand
    Tool: Bash
    Steps:
      1. Run `bun src/cli/index.ts unknown-cmd`
      2. Assert output contains "Unknown command"
    Expected Result: Error message displayed, exit code 1
    Evidence: .sisyphus/evidence/task-6-cli-unknown.txt
  ```

  **Commit**: YES (groups with Task 7)
  - Message: `feat(scaffold): CLI framework and feature module structure`
  - Files: `src/cli/*.ts`
  - Pre-commit: `bun test src/cli/`

- [x] 7. Feature Module Scaffolding (Directory Structure + Barrel Exports)

  **What to do**:
  - Create directory structure for feature modules:
    - `src/features/background-agent/index.ts` (empty barrel)
    - `src/features/persistent-state/index.ts` (empty barrel)
    - `src/features/context-monitor/index.ts` (empty barrel)
    - `src/features/audit-enforcer/index.ts` (empty barrel)
    - `src/features/error-recovery/index.ts` (empty barrel)
  - Create `src/features/index.ts` — top-level barrel re-exporting all features
  - Each barrel should export `{}` for now — actual implementations in Wave 3

  **Must NOT do**:
  - Do NOT implement any feature logic — scaffolding only
  - Do NOT create feature directories not listed above

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 15-20 (feature implementations)
  - **Blocked By**: None

  **References**:
  - OMO `src/features/` — Feature module directory pattern (each feature is self-contained)

  **Acceptance Criteria**:
  - [ ] 5 feature directories exist under `src/features/`
  - [ ] Each has `index.ts` barrel
  - [ ] `bun run typecheck` passes

  **QA Scenarios**:
  ```
  Scenario: Feature barrels import cleanly
    Tool: Bash (bun run typecheck)
    Steps:
      1. Run `bun run typecheck`
      2. Verify no import errors from feature directories
    Expected Result: Typecheck passes
    Evidence: .sisyphus/evidence/task-7-typecheck.txt
  ```

  **Commit**: YES (groups with Task 6)
  - Message: `feat(scaffold): CLI framework and feature module structure`
  - Files: `src/features/**/*.ts`
  - Pre-commit: `bun run typecheck`

### Wave 2 — Core Architecture (7 parallel, medium-deep)

- [x] 8. Multi-Level Config Loader (User + Project, Deep Merge)

  **What to do**:
  - TDD: Write tests in `src/config/loader.test.ts`
  - Create `src/config/loader.ts` — `loadArgusConfig(projectDir: string): ArgusConfig`
    - Reads user-level config: `~/.config/opencode/opencode-argus.json` (or `.jsonc`)
    - Reads project-level config: `{projectDir}/.opencode/opencode-argus.json` (or `.jsonc`)
    - Uses `detectConfigFile` from shared/file-utils to find `.json` vs `.jsonc`
    - Uses `parseJsonc` from shared/jsonc-parser
    - Deep merges: project config overrides user config
    - Validates with `safeParse` — collects errors via logger, returns defaults on failure
  - Update `src/config/index.ts` barrel to export loader

  **Must NOT do**:
  - Do NOT support the OLD config format — clean break
  - Do NOT throw on invalid config — return defaults and log warning

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Config loading with multiple paths, merge logic, error handling
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 9-14)
  - **Blocks**: Task 14 (plugin-interface), Task 21 (CLI doctor), Task 25 (new index.ts)
  - **Blocked By**: Task 1 (shared utils), Task 2 (config schema)

  **References**:
  - `src/plugin-config.ts:121-139` — Current `loadArgusConfig` to REPLACE
  - `src/shared/jsonc-parser.ts` — From Task 1 (JSONC parsing)
  - `src/shared/deep-merge.ts` — From Task 1 (deep merge)
  - `src/shared/file-utils.ts` — From Task 1 (detectConfigFile)
  - OMO `src/plugin-config.ts:66-110` — Multi-level config loading pattern with user + project merge

  **Acceptance Criteria**:
  - [ ] `src/config/loader.ts` reads from user and project paths
  - [ ] Deep merge: project overrides user, arrays concat+dedup
  - [ ] Invalid config → log warning, return defaults (no throw)
  - [ ] `bun test src/config/loader.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Config loads from project path
    Tool: Bash (bun test)
    Steps:
      1. Run test that creates temp .opencode/opencode-argus.json
      2. Call loadArgusConfig with temp dir
      3. Assert returned config matches file content
    Expected Result: Config loaded and validated correctly
    Evidence: .sisyphus/evidence/task-8-project-config.txt

  Scenario: Config falls back to defaults on missing files
    Tool: Bash (bun test)
    Steps:
      1. Call loadArgusConfig with empty temp dir (no config files)
      2. Assert returns valid config with all defaults
    Expected Result: Default config returned, no errors
    Evidence: .sisyphus/evidence/task-8-default-config.txt

  Scenario: Project config overrides user config via deep merge
    Tool: Bash (bun test)
    Steps:
      1. Create user config with `agents.argus.model = "model-a"`
      2. Create project config with `agents.argus.model = "model-b"`
      3. Assert merged result has "model-b"
    Expected Result: Project config wins on conflict
    Evidence: .sisyphus/evidence/task-8-merge-config.txt
  ```

  **Commit**: YES
  - Message: `feat(config): multi-level config loader with deep merge`
  - Files: `src/config/loader.ts`, `src/config/loader.test.ts`
  - Pre-commit: `bun test src/config/`

- [x] 9. create-tools.ts Factory

  **What to do**:
  - TDD: Write tests in `src/create-tools.test.ts`
  - Create `src/create-tools.ts` — Factory function that returns the tool record
  - Extract all tool imports/registration from current `index.ts:49-57` into this factory
  - Signature: `createTools(config: ArgusConfig): Record<string, Tool>`
  - Accept config to potentially gate tools (e.g., disable solodit tools if `solodit.enabled === false`)
  - Return the same tool map shape as current index.ts

  **Must NOT do**:
  - Do NOT change tool implementations — only extraction
  - Do NOT rename tool keys (must remain `argus_slither_analyze`, etc.)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 14 (plugin-interface), Task 25 (new index.ts), Task 27 (tool migration)
  - **Blocked By**: Task 1 (shared utils)

  **References**:
  - `src/index.ts:11-18` — Current tool imports (8 tools)
  - `src/index.ts:48-57` — Current tool registration map (EXTRACT this into create-tools factory)
  - OMO `src/create-tools.ts` — Tool factory pattern

  **Acceptance Criteria**:
  - [ ] `src/create-tools.ts` exports `createTools` function
  - [ ] Returns same 8-tool record as current index.ts
  - [ ] `bun test src/create-tools.test.ts` → PASS
  - [ ] Tools conditionally excluded when config disables them

  **QA Scenarios**:
  ```
  Scenario: All 8 tools registered by default
    Tool: Bash (bun test)
    Steps:
      1. Call createTools with default config
      2. Assert result has exactly 8 keys: argus_slither_analyze, argus_forge_test, argus_forge_fuzz, argus_analyze_contract, argus_check_patterns, argus_solodit_search, argus_generate_report, argus_sync_knowledge
    Expected Result: 8 tools present
    Evidence: .sisyphus/evidence/task-9-tools-default.txt

  Scenario: Solodit tools excluded when disabled
    Tool: Bash (bun test)
    Steps:
      1. Call createTools with config `{ solodit: { enabled: false } }`
      2. Assert argus_solodit_search is NOT in result
    Expected Result: Solodit tool conditionally excluded
    Evidence: .sisyphus/evidence/task-9-tools-disabled.txt
  ```

  **Commit**: YES (groups with Tasks 10-11)
  - Message: `feat(arch): create-tools, create-hooks, create-managers factories`
  - Files: `src/create-tools.ts`
  - Pre-commit: `bun test src/create-tools.test.ts`

- [x] 10. create-hooks.ts Factory with isHookEnabled Guards

  **What to do**:
  - TDD: Write tests in `src/create-hooks.test.ts`
  - Create `src/create-hooks.ts` — Factory function assembling all hooks
  - Extract hook creation logic from current `index.ts:38-46` into this factory
  - Each **feature** hook creation wrapped with `isHookEnabled(hookName)` check
  - **EXCEPTION**: The `config` hook (config-handler) MUST be exempt from `isHookEnabled` — it registers agents and is always required. Disabling it would make the plugin non-functional. Only feature hooks (system-prompt, compaction, tool-tracking, event, knowledge-sync, and all new hooks) should be disableable.
  - If feature hook is disabled, return undefined (the plugin-interface compositor skips undefined hooks)
  - Wrap each hook in `safeCreateHook` for error safety
  - Signature: `createHooks(args: { config: ArgusConfig, managers: Managers, isHookEnabled: (name: HookName) => boolean }): Hooks`
  - Return type `Hooks` — object with optional hook functions for each hook point

  **Must NOT do**:
  - Do NOT implement new hooks here — only compose existing ones
  - Do NOT remove or modify existing hook behavior

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex composition logic with guards, error handling, and dependency injection
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 14 (plugin-interface), Task 25 (new index.ts)
  - **Blocked By**: Task 1 (shared utils), Task 2 (config schema), Task 3 (hook types)

  **References**:
  - `src/index.ts:39-46` — Current hook creation (EXTRACT this). NOTE: `createKnowledgeSyncHook` is NOT imported here — it's been moved into `config-handler.ts:8,33` where it's instantiated and triggered. The create-hooks factory must handle this correctly.
  - `src/hooks/system-prompt-hook.ts` — Factory pattern to compose
  - `src/hooks/compaction-hook.ts` — Factory pattern to compose
  - `src/hooks/hook-system.ts` — From Task 3 (isHookEnabled)
  - `src/hooks/safe-create-hook.ts` — From Task 3 (error safety wrapper)
  - OMO `src/create-hooks.ts` — Hook factory pattern with isHookEnabled guards

  **Acceptance Criteria**:
  - [ ] `src/create-hooks.ts` exports `createHooks` function
  - [ ] All 6 existing hooks composed: system-prompt, compaction, tool-tracking, event, knowledge-sync, config
  - [ ] Each hook guarded by `isHookEnabled`
  - [ ] Disabled hooks return undefined, not null
  - [ ] `bun test src/create-hooks.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: All hooks enabled by default
    Tool: Bash (bun test)
    Steps:
      1. Call createHooks with empty disabled_hooks
      2. Assert all hook functions are defined (not undefined)
    Expected Result: All hooks present
    Evidence: .sisyphus/evidence/task-10-hooks-enabled.txt

  Scenario: Specific hook disabled via config
    Tool: Bash (bun test)
    Steps:
      1. Call createHooks with disabled_hooks: ["system-prompt"]
      2. Assert system prompt hook is undefined
      3. Assert all other hooks still defined
    Expected Result: Only specified hook disabled
    Evidence: .sisyphus/evidence/task-10-hooks-disabled.txt
  ```

  **Commit**: YES (groups with Tasks 9, 11)
  - Message: `feat(arch): create-tools, create-hooks, create-managers factories`
  - Files: `src/create-hooks.ts`
  - Pre-commit: `bun test src/create-hooks.test.ts`

- [x] 11. create-managers.ts Factory

  **What to do**:
  - TDD: Write tests in `src/create-managers.test.ts`
  - Create `src/create-managers.ts` — Factory function creating all managers
  - Signature: `createManagers(args: { ctx: PluginContext, config: ArgusConfig }): Managers`
  - Creates: BackgroundManager instance (from Task 12), AuditStateManager instance (from Task 13)
  - Returns typed `Managers` object for consumption by create-hooks and create-tools

  **Must NOT do**:
  - Do NOT implement manager logic — use interfaces from Task 4, implementations from Tasks 12-13

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 14 (plugin-interface)
  - **Blocked By**: Task 1 (shared utils), Task 4 (manager types), Task 12 (BackgroundManager), Task 13 (AuditStateManager)

  **References**:
  - `src/managers/types.ts` — From Task 4 (interfaces)
  - OMO `src/create-managers.ts` — Manager factory composition pattern

  **Acceptance Criteria**:
  - [ ] `src/create-managers.ts` exports `createManagers` function
  - [ ] Returns `Managers` with backgroundManager and auditStateManager
  - [ ] `bun test src/create-managers.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Managers created with valid config
    Tool: Bash (bun test)
    Steps:
      1. Call createManagers with mock ctx and valid config
      2. Assert result has backgroundManager and auditStateManager
      3. Assert both conform to their interface types
    Expected Result: Both managers created successfully
    Evidence: .sisyphus/evidence/task-11-managers-created.txt
  ```

  **Commit**: YES (groups with Tasks 9-10)
  - Message: `feat(arch): create-tools, create-hooks, create-managers factories`
  - Files: `src/create-managers.ts`
  - Pre-commit: `bun test src/create-managers.test.ts`

- [x] 12. Background Agent Manager

  **What to do**:
  - TDD: Write tests in `src/features/background-agent/background-manager.test.ts`
  - Create `src/features/background-agent/background-manager.ts` implementing `BackgroundManager` interface
  - Core capabilities:
    - `dispatch(agentName, prompt, options?)` — submit a task to run in background via OpenCode's task system
    - `cancel(taskId)` — cancel a running background task
    - `getResult(taskId)` — get result of completed task
    - `onComplete(callback)` — register completion callback
    - Track active tasks with Map<taskId, TaskInfo>
    - Concurrency limit from config (default: 3 simultaneous tasks)
  - **Standalone design**: Simply respect its own concurrency limit (`config.background.max_concurrent`, default 3). Do NOT accept `externalActiveCount` or try to track other plugins' background tasks — that's over-engineering. Each plugin manages its own concurrency. OpenCode handles overall system limits at the runtime level.
  - Update `src/features/background-agent/index.ts` barrel

  **Must NOT do**:
  - Do NOT implement actual task dispatch (that requires OpenCode runtime) — use injectable dispatcher function for testability
  - Do NOT handle tmux sessions — out of scope for audit plugin

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Async coordination, concurrency control, callback management
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 11 (create-managers)
  - **Blocked By**: Task 1 (shared utils), Task 4 (manager types)

  **References**:
  - `src/managers/types.ts` — BackgroundManager interface (from Task 4)
  - OMO `src/features/background-agent/` — Background manager implementation pattern

  **Acceptance Criteria**:
  - [ ] `BackgroundManager` implements interface from Task 4
  - [ ] Tracks active tasks, enforces concurrency limit
  - [ ] `bun test src/features/background-agent/` → PASS

  **QA Scenarios**:
  ```
  Scenario: Dispatch and track task
    Tool: Bash (bun test)
    Steps:
      1. Create BackgroundManager with mock dispatcher
      2. Dispatch task, assert taskId returned
      3. Assert task tracked in active map
    Expected Result: Task dispatched and tracked
    Evidence: .sisyphus/evidence/task-12-dispatch.txt

  Scenario: Concurrency limit enforced
    Tool: Bash (bun test)
    Steps:
      1. Set concurrency limit to 2
      2. Dispatch 3 tasks
      3. Assert 3rd task queued (not dispatched)
      4. Complete 1st task, assert 3rd now dispatched
    Expected Result: Concurrency limit respected
    Evidence: .sisyphus/evidence/task-12-concurrency.txt
  ```

  **Commit**: YES (groups with Task 13)
  - Message: `feat(managers): background agent manager and persistent audit state`
  - Files: `src/features/background-agent/*.ts`
  - Pre-commit: `bun test src/features/background-agent/`

- [x] 13. Persistent Audit State Manager (File-Based)

  **What to do**:
  - TDD: Write tests in `src/features/persistent-state/audit-state-manager.test.ts`
  - Create `src/features/persistent-state/audit-state-manager.ts` implementing `AuditStateManager` interface
  - Persistence location: `{projectDir}/.opencode/argus-state.json`
  - Core capabilities:
    - `load()` — read state from disk, return null if not found
    - `save(state)` — serialize and write to disk atomically (write to .tmp, rename)
    - `get()` — return current in-memory state
    - `update(patch)` — shallow merge patch into current state, auto-save
    - `reset()` — delete state file, clear in-memory state
  - Serialize: `JSON.stringify` with `savedAt` timestamp and `version` field
  - On load failure (corrupted file): log warning, return null (don't crash)
  - Update `src/features/persistent-state/index.ts` barrel

  **Must NOT do**:
  - Do NOT change existing `createAuditState` factory — extend, don't replace
  - Do NOT use external storage (SQLite, etc.) — plain JSON file

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: File I/O with atomic writes, error recovery, state management
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 11 (create-managers)
  - **Blocked By**: Task 1 (shared utils), Task 4 (manager types), Task 5 (state types)

  **References**:
  - `src/state/audit-state.ts` — Current `createAuditState` factory (PRESERVE)
  - `src/state/types.ts` — `AuditState` and `PersistentAuditState` types
  - `src/managers/types.ts` — `AuditStateManager` interface (from Task 4)
  - OMO `src/features/boulder-state/` — Persistent state management pattern

  **Acceptance Criteria**:
  - [ ] State persists to `{projectDir}/.opencode/argus-state.json`
  - [ ] Atomic write via temp file + rename
  - [ ] Corrupted file → log warning, return null
  - [ ] `bun test src/features/persistent-state/` → PASS

  **QA Scenarios**:
  ```
  Scenario: State saved and loaded across sessions
    Tool: Bash (bun test)
    Steps:
      1. Create manager with temp dir
      2. Update state with findings
      3. Save to disk
      4. Create NEW manager with same dir
      5. Load state, assert matches saved state
    Expected Result: State round-trips correctly
    Evidence: .sisyphus/evidence/task-13-persistence.txt

  Scenario: Corrupted state file handled gracefully
    Tool: Bash (bun test)
    Steps:
      1. Write corrupted JSON to state file
      2. Create manager, call load()
      3. Assert returns null (not throws)
      4. Assert warning logged
    Expected Result: Graceful degradation, no crash
    Evidence: .sisyphus/evidence/task-13-corrupted.txt
  ```

  **Commit**: YES (groups with Task 12)
  - Message: `feat(managers): background agent manager and persistent audit state`
  - Files: `src/features/persistent-state/*.ts`
  - Pre-commit: `bun test src/features/persistent-state/`

- [x] 14. plugin-interface.ts Compositor

  **What to do**:
  - TDD: Write tests in `src/plugin-interface.test.ts`
  - Create `src/plugin-interface.ts` — Composes the final plugin return object from factories
  - Signature: `createPluginInterface(args: { config, managers, hooks, tools }): PluginReturn`
  - Assembles: `tool` (from create-tools), `config` (config handler), `experimental.chat.system.transform` (from hooks), `experimental.session.compacting` (from hooks), `tool.execute.after` (from hooks), `event` (from hooks)
  - Skip undefined hooks (disabled via config)
  - Must produce the EXACT same shape as current `index.ts` return for OpenCode compatibility
  - **OMO CO-EXISTENCE — CRITICAL HOOK PATTERNS**:
    - `experimental.chat.system.transform`: Must **PUSH** to `output.system` array, NOT replace it. Current code does `output.system = [transformedSystem]` which DESTROYS other plugins' entries. Fix: `output.system.push(auditContextBlock)` — only append audit context as a new array entry, never join+replace.
    - `experimental.session.compacting`: Must **PUSH** to `output.context` array, NOT replace it. Current code does `output.context = [compactedSummary]` which overwrites OMO's compaction-context-injector and compaction-todo-preserver entries. Fix: `output.context.push(auditStateXml)` — append audit state as a new context entry.
    - `tool.execute.after`: Current code reads `output.output` for finding tracking — this is READ-ONLY and safe. However, if OMO's tool-output-truncator runs first, Argus may read truncated data. Add a `tool.execute.before` hook to capture raw args for audit tools (slither, forge) before any truncation occurs.

  **Must NOT do**:
  - Do NOT replace `output.system` array — only push to it
  - Do NOT replace `output.context` array — only push to it
  - Do NOT add new hook points not already in current index.ts (except `tool.execute.before` for finding pre-capture)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (starts after Wave 1, can overlap with late Wave 2)
  - **Parallel Group**: Wave 2 (last to start, needs 8-11)
  - **Blocks**: Task 25 (new index.ts)
  - **Blocked By**: Tasks 8-11 (all factory outputs)

  **References**:
  - `src/index.ts:47-81` — Current plugin return object (MUST MATCH this shape). Returns: `tool` (8 tools), `config`, `experimental.chat.system.transform`, `experimental.session.compacting`, `tool.execute.after`, `event`
  - OMO `src/plugin-interface.ts` — Plugin interface composition pattern

  **WHY Each Reference Matters**:
  - Current index.ts return shape is the API contract with OpenCode — must be identical

  **Acceptance Criteria**:
  - [ ] `src/plugin-interface.ts` exports `createPluginInterface`
  - [ ] Returns object with: tool, config, experimental.chat.system.transform, experimental.session.compacting, tool.execute.after, event
  - [ ] Disabled hooks → corresponding plugin hooks omitted
  - [ ] `bun test src/plugin-interface.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Plugin interface matches current shape
    Tool: Bash (bun test)
    Steps:
      1. Create interface with mock tools, hooks, managers, config
      2. Assert result has all 6 required keys
      3. Assert tool map has 8 entries
    Expected Result: Shape matches OpenCode expectations
    Evidence: .sisyphus/evidence/task-14-interface-shape.txt

  Scenario: Disabled hooks excluded from interface
    Tool: Bash (bun test)
    Steps:
      1. Create interface with compaction hook = undefined
      2. Assert experimental.session.compacting still exists but is no-op
    Expected Result: Interface gracefully handles missing hooks
    Evidence: .sisyphus/evidence/task-14-disabled-hooks.txt
  ```

  **Commit**: YES
  - Message: `feat(arch): plugin-interface compositor`
  - Files: `src/plugin-interface.ts`
  - Pre-commit: `bun test src/plugin-interface.test.ts`

### Wave 3 — Feature Hooks + CLI (10 parallel, medium-deep)

- [x] 15. Session Recovery Hook

  **What to do**:
  - TDD: Write tests in `src/features/error-recovery/session-recovery.test.ts`
  - Create `src/features/error-recovery/session-recovery.ts` — Hook that detects session errors and attempts recovery
  - Listens to `event` hook for `session.error` events
  - On error: log state snapshot, attempt to reload audit state from persistent storage (Task 13), re-inject system prompt context
  - If recovery fails: log detailed diagnostic, allow session to proceed in degraded mode
  - Update `src/features/error-recovery/index.ts` barrel

  **Must NOT do**:
  - Do NOT restart sessions — only recover state
  - Do NOT swallow errors silently — always log

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 16-24)
  - **Blocks**: Task 25 (new index.ts integration)
  - **Blocked By**: Tasks 3 (hook types), 7 (feature scaffolding), 10 (create-hooks pattern)

  **References**:
  - `src/hooks/event-hook.ts:49-59` — Current session.error handler (EXTEND this)
  - `src/features/persistent-state/` — From Task 13 (state recovery source)
  - OMO `src/hooks/session-recovery/` — Session recovery hook pattern

  **Acceptance Criteria**:
  - [ ] Hook detects session.error event and triggers recovery
  - [ ] Recovery loads state from persistent storage
  - [ ] Failed recovery logs diagnostic, doesn't crash
  - [ ] `bun test src/features/error-recovery/session-recovery.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Recovery loads persisted state after error
    Tool: Bash (bun test)
    Steps:
      1. Save audit state to disk (mock persistent manager)
      2. Trigger session.error event
      3. Assert state restored from disk
    Expected Result: State recovered from persistent storage
    Evidence: .sisyphus/evidence/task-15-recovery.txt

  Scenario: Recovery fails gracefully with no persisted state
    Tool: Bash (bun test)
    Steps:
      1. Trigger session.error with no persisted state
      2. Assert warning logged
      3. Assert hook returns without throwing
    Expected Result: Graceful degradation
    Evidence: .sisyphus/evidence/task-15-no-state.txt
  ```

  **Commit**: YES (groups with Tasks 16-20)
  - Message: `feat(hooks): error recovery, context monitor, audit enforcer, event system`
  - Files: `src/features/error-recovery/*.ts`
  - Pre-commit: `bun test src/features/error-recovery/`

- [x] 16. Tool Error Recovery Hook

  **What to do**:
  - TDD: Write tests in `src/features/error-recovery/tool-error-recovery.test.ts`
  - Create `src/features/error-recovery/tool-error-recovery.ts` — Hook on `tool.execute.after` that detects tool failures and enriches error context
  - On Slither failure: suggest installation command or version fix
  - On Forge failure: suggest forge install or compilation fix
  - On SCVD/Solodit failure: suggest network check or API status
  - Enriches error output with actionable guidance without changing tool behavior
  - Update barrel export

  **Must NOT do**:
  - Do NOT retry tools automatically — only enrich errors
  - Do NOT modify tool return values — append guidance as separate context

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 25
  - **Blocked By**: Tasks 3, 7, 10

  **References**:
  - `src/hooks/tool-tracking-hook.ts` — Current tool.execute.after pattern (follows same hook point)
  - `src/tools/slither-tool.ts:476` — Slither ENOENT handling pattern to extend (also see `hasBinary()` at line 197, `FlattenFallbackDeps` DI pattern at line 242 — the tool now uses dependency injection for testability)
  - OMO `src/hooks/edit-error-recovery/` — Tool error recovery pattern

  **Acceptance Criteria**:
  - [ ] Slither ENOENT → output includes "pip install slither-analyzer" guidance
  - [ ] Forge failure → output includes forge installation guidance
  - [ ] `bun test src/features/error-recovery/tool-error-recovery.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Slither not found error enriched
    Tool: Bash (bun test)
    Steps:
      1. Mock tool.execute.after with slither ENOENT error
      2. Assert output enriched with installation guidance
    Expected Result: Error includes actionable fix
    Evidence: .sisyphus/evidence/task-16-slither-error.txt
  ```

  **Commit**: YES (groups with Tasks 15, 17-20)
  - Files: `src/features/error-recovery/tool-error-recovery.ts`

- [x] 17. Context Window Monitor + Proactive Compaction

  **What to do**:
  - TDD: Write tests in `src/features/context-monitor/context-monitor.test.ts`
  - Create `src/features/context-monitor/context-monitor.ts`
  - Monitors context usage via token estimation heuristic (chars / 4 as rough token count)
  - At 70% capacity: inject reminder "Context headroom available — maintain audit thoroughness"
  - At 85% capacity: trigger proactive compaction via `experimental.session.compacting`
  - Integrate with system prompt transform to inject context usage status
  - Update barrel export

  **Must NOT do**:
  - Do NOT implement actual token counting — use heuristic estimation
  - Do NOT force compaction — request it via existing compaction hook

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Heuristic design + integration with multiple hook points
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 25
  - **Blocked By**: Tasks 3, 7, 10

  **References**:
  - `src/hooks/compaction-hook.ts` — Current compaction integration point
  - `src/hooks/system-prompt-hook.ts` — System prompt injection point
  - OMO `src/hooks/context-window-monitor.ts` — Context window monitoring pattern
  - OMO `src/hooks/preemptive-compaction.ts` — Proactive compaction pattern

  **Acceptance Criteria**:
  - [ ] 70% threshold: injects reminder into system prompt
  - [ ] 85% threshold: triggers compaction
  - [ ] `bun test src/features/context-monitor/` → PASS

  **QA Scenarios**:
  ```
  Scenario: Context reminder at 70%
    Tool: Bash (bun test)
    Steps:
      1. Mock system with 70% context usage
      2. Assert context reminder injected
    Expected Result: Reminder present in system prompt addition
    Evidence: .sisyphus/evidence/task-17-70pct.txt

  Scenario: Compaction triggered at 85%
    Tool: Bash (bun test)
    Steps:
      1. Mock system with 85% context usage
      2. Assert compaction callback invoked
    Expected Result: Compaction triggered
    Evidence: .sisyphus/evidence/task-17-85pct.txt
  ```

  **Commit**: YES (groups with Tasks 15-16, 18-20)
  - Files: `src/features/context-monitor/*.ts`

- [x] 18. Tool Output Truncator Hook

  **What to do**:
  - TDD: Write tests in `src/features/context-monitor/tool-output-truncator.test.ts`
  - Create `src/features/context-monitor/tool-output-truncator.ts`
  - Hook on `tool.execute.after` — truncates tool output that exceeds configurable max (default: 50,000 chars)
  - Prioritize truncation for: Slither JSON (can be massive), Forge test output, pattern checker results
  - Truncation strategy: keep first N chars + summary footer "[Truncated: {original_size} → {truncated_size} chars]"
  - Leave small outputs untouched

  **Must NOT do**:
  - Do NOT lose finding data during truncation — keep structured fields
  - Do NOT truncate below 1000 chars — always keep meaningful content

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 25
  - **Blocked By**: Tasks 3, 7, 10

  **References**:
  - `src/hooks/tool-tracking-hook.ts` — Current tool.execute.after pattern
  - OMO `src/hooks/tool-output-truncator.ts` — Dynamic output truncation pattern

  **Acceptance Criteria**:
  - [ ] Output > 50k chars truncated with footer
  - [ ] Output < 50k chars passed through unchanged
  - [ ] `bun test src/features/context-monitor/tool-output-truncator.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Large output truncated
    Tool: Bash (bun test)
    Steps:
      1. Pass 100k char output through truncator
      2. Assert result is ~50k chars + truncation footer
    Expected Result: Output truncated with disclosure
    Evidence: .sisyphus/evidence/task-18-truncation.txt

  Scenario: Small output unchanged
    Tool: Bash (bun test)
    Steps:
      1. Pass 1k char output through truncator
      2. Assert output identical to input
    Expected Result: No truncation for small outputs
    Evidence: .sisyphus/evidence/task-18-passthrough.txt
  ```

  **Commit**: YES (groups with Tasks 15-17, 19-20)
  - Files: `src/features/context-monitor/tool-output-truncator.ts`

- [x] 19. Audit Continuation Enforcer (7-Step Methodology)

  **What to do**:
  - TDD: Write tests in `src/features/audit-enforcer/audit-enforcer.test.ts`
  - Create `src/features/audit-enforcer/audit-enforcer.ts`
  - **OMO CO-EXISTENCE**: Use `experimental.chat.system.transform` (push to system prompt) instead of `event` (session.idle) to inject continuation context. This avoids conflicting with OMO's `todo-continuation-enforcer` which also fires on idle — double-nag confuses agents.
  - Implementation: On each system prompt transform, check audit state. If phase != "complete", push continuation context to `output.system`: "Audit in progress — current phase: {phase}. Next phase: {nextPhase}. Do not stop until audit is complete."
  - Phase progression: reconnaissance → scanning → manual-review → attack-surface → research → testing → reporting → complete (uses existing AuditPhase values from types.ts, NOT renamed values)
  - Only injects when audit state exists (not for non-audit sessions)
  - Update barrel export

  **Must NOT do**:
  - Do NOT use `event` (session.idle) for continuation — that conflicts with OMO's todo-continuation-enforcer
  - Do NOT force agent actions — only inject context
  - Do NOT fire for non-audit sessions
  - Do NOT skip phases — enforce sequential progression

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Methodology enforcement with state machine logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 25
  - **Blocked By**: Tasks 3, 7, 10

  **References**:
  - `src/hooks/system-prompt-hook.ts` — System prompt transform pattern (this hook EXTENDS it, pushing continuation context to `output.system`)
  - `src/state/types.ts:2` — AuditPhase type (existing values: `"scanning"`, `"research"`, NOT renamed)
  - OMO `src/hooks/todo-continuation-enforcer/` — Continuation enforcement pattern (but uses system.transform, not session.idle like OMO)

  **Acceptance Criteria**:
  - [ ] Incomplete audit at system.transform → continuation prompt pushed to `output.system`
  - [ ] Complete audit at system.transform → no continuation prompt pushed
  - [ ] Phase progression follows 7-step order using existing AuditPhase values
  - [ ] `bun test src/features/audit-enforcer/` → PASS

  **QA Scenarios**:
  ```
  Scenario: Continuation prompt for incomplete audit
    Tool: Bash (bun test)
    Steps:
      1. Set audit phase to "scanning" (existing AuditPhase value)
      2. Call audit enforcer's system prompt transform with mock output object
      3. Assert output.system was pushed to with text mentioning "manual-review" as next phase
    Expected Result: output.system includes continuation context with correct next phase
    Evidence: .sisyphus/evidence/task-19-continuation.txt

  Scenario: No prompt for complete audit
    Tool: Bash (bun test)
    Steps:
      1. Set audit phase to "complete"
      2. Call audit enforcer's system prompt transform with mock output object
      3. Assert output.system was NOT pushed to with continuation text (length unchanged)
    Expected Result: No continuation prompt when audit is complete
    Evidence: .sisyphus/evidence/task-19-complete.txt
  ```

  **Commit**: YES (groups with Tasks 15-18, 20)
  - Files: `src/features/audit-enforcer/*.ts`

- [x] 20. Event System Improvements (Richer Types, Lifecycle)

  **What to do**:
  - TDD: Write tests in `src/hooks/event-hook-v2.test.ts`
  - Create `src/hooks/event-hook-v2.ts` — Enhanced event hook that replaces current event-hook.ts
  - Richer event types: `session.created`, `session.idle`, `session.error`, `session.deleted`, `audit.phase-changed`, `audit.finding-added`, `audit.complete`
  - Delegate to sub-handlers: session recovery (Task 15), audit continuation (Task 19)
  - Typed audit events (not an event bus) — just a typed dispatcher that calls sub-handlers
  - Keep backward compatibility with current event shape

  **Must NOT do**:
  - Do NOT break existing event types — add new ones, don't remove
  - Do NOT implement event bus, pub/sub, or event replay — only typed event names and delegation to existing sub-handlers. This is a scope boundary: keep it simple
  - Do NOT add event persistence or event log

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 25
  - **Blocked By**: Tasks 3, 7

  **References**:
  - `src/hooks/event-hook.ts` — Current event hook (REPLACE with enhanced version)
  - OMO `src/plugin/event.ts` — Event system with typed events

  **Acceptance Criteria**:
  - [ ] All current event types still handled (session.created/idle/error/deleted)
  - [ ] New audit.* events defined and dispatchable
  - [ ] `bun test src/hooks/event-hook-v2.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Existing events still work
    Tool: Bash (bun test)
    Steps:
      1. Fire session.created, session.idle, session.error, session.deleted
      2. Assert each handled without error
    Expected Result: Backward compatible
    Evidence: .sisyphus/evidence/task-20-existing-events.txt
  ```

  **Commit**: YES (groups with Tasks 15-19)
  - Files: `src/hooks/event-hook-v2.ts`

- [x] 21. CLI Doctor Command (Slither/Foundry/Config Diagnostics)

  **What to do**:
  - TDD: Write tests in `src/cli/commands/doctor.test.ts`
  - Create `src/cli/commands/doctor.ts`
  - Checks and reports:
    - Slither: `which slither` → installed/not installed, version
    - Forge: `which forge` → installed/not installed, version
    - Config: exists at user/project paths, validates with schema
    - Solidity project: detects foundry.toml or hardhat.config.{js,ts}
    - SCVD: tests API connectivity (`fetch https://api.scvd.dev/health` or similar)
  - Output: Colored terminal report with pass/fail for each check
  - Exit code: 0 if all critical checks pass, 1 if any fail

  **Must NOT do**:
  - Do NOT install tools — only diagnose
  - Do NOT use external color libraries — use ANSI codes directly

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (independent of hooks)
  - **Blocks**: Task 28 (package.json update)
  - **Blocked By**: Task 1 (shared utils), Task 6 (CLI scaffold), Task 8 (config loader)

  **References**:
  - `src/utils/project-detector.ts` — Existing Solidity project detection (reuse)
  - `src/cli/cli-program.ts` — CLI command framework (from Task 6)
  - OMO `src/cli/doctor/` — Doctor command pattern

  **Acceptance Criteria**:
  - [ ] `bun src/cli/index.ts doctor` outputs diagnostic report
  - [ ] Checks Slither, Forge, config, project type, SCVD
  - [ ] Exit code 0 for all pass, 1 for any fail
  - [ ] `bun test src/cli/commands/doctor.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Doctor reports Slither status
    Tool: interactive_bash (tmux)
    Steps:
      1. Run `bun src/cli/index.ts doctor`
      2. Assert output contains "Slither:" with "installed" or "not found"
      3. Assert output contains "Forge:" check
    Expected Result: Diagnostic report printed
    Evidence: .sisyphus/evidence/task-21-doctor.txt

  Scenario: Doctor exits 1 when critical tool missing
    Tool: Bash
    Steps:
      1. Mock Slither as not found
      2. Run doctor command
      3. Assert exit code is 1
    Expected Result: Non-zero exit on missing critical tool
    Evidence: .sisyphus/evidence/task-21-doctor-fail.txt
  ```

  **Commit**: YES (groups with Tasks 22-24)
  - Message: `feat(cli): doctor, init, install commands with TUI`
  - Files: `src/cli/commands/doctor.ts`

- [x] 22. CLI Init Command (Create Config, Detect Project)

  **What to do**:
  - TDD: Write tests in `src/cli/commands/init.test.ts`
  - Create `src/cli/commands/init.ts`
  - Detects if current directory is a Solidity project
  - Creates `.opencode/opencode-argus.json` with sensible defaults
  - Asks user preferences via TUI prompts (Task 24) if available, otherwise uses defaults
  - Does NOT overwrite existing config — warns and exits

  **Must NOT do**:
  - Do NOT overwrite existing config files
  - Do NOT modify `opencode.json` (that's the install command)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 28
  - **Blocked By**: Tasks 1, 6, 8

  **References**:
  - `src/config/schema.ts` — Default config shape (from Task 2)
  - `src/utils/project-detector.ts` — Project type detection
  - OMO `src/cli/install.ts` — Init/install pattern

  **Acceptance Criteria**:
  - [ ] Creates `.opencode/opencode-argus.json` with valid defaults
  - [ ] Detects Solidity project type
  - [ ] Refuses to overwrite existing config
  - [ ] `bun test src/cli/commands/init.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Init creates default config
    Tool: Bash
    Steps:
      1. Run `bun src/cli/index.ts init` in temp dir with foundry.toml
      2. Assert `.opencode/opencode-argus.json` created
      3. Assert config validates against schema
    Expected Result: Valid config created
    Evidence: .sisyphus/evidence/task-22-init.txt

  Scenario: Init refuses to overwrite
    Tool: Bash
    Steps:
      1. Create existing `.opencode/opencode-argus.json`
      2. Run `bun src/cli/index.ts init`
      3. Assert warning message and exit code 1
    Expected Result: Existing config preserved
    Evidence: .sisyphus/evidence/task-22-no-overwrite.txt
  ```

  **Commit**: YES (groups with Tasks 21, 23-24)
  - Files: `src/cli/commands/init.ts`

- [x] 23. CLI Install Command (Configure Plugin in OpenCode Config)

  **What to do**:
  - TDD: Write tests in `src/cli/commands/install.test.ts`
  - Create `src/cli/commands/install.ts`
  - Finds `opencode.json` in current dir or `~/.config/opencode/`
  - Adds `"opencode-argus"` to the `plugin` array if not already present
  - Warns if opencode.json not found (OpenCode not configured)
  - Idempotent: running twice doesn't duplicate the entry

  **Must NOT do**:
  - Do NOT install npm packages — only modify opencode config
  - Do NOT create opencode.json if it doesn't exist

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 28
  - **Blocked By**: Tasks 1, 6, 8

  **References**:
  - OMO installation guide — Plugin registration in opencode.json pattern

  **Acceptance Criteria**:
  - [ ] Adds "opencode-argus" to plugin array
  - [ ] Idempotent — no duplicates
  - [ ] Missing opencode.json → warning
  - [ ] `bun test src/cli/commands/install.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Install adds plugin to config
    Tool: Bash
    Steps:
      1. Create opencode.json with empty plugin array
      2. Run `bun src/cli/index.ts install`
      3. Assert "opencode-argus" in plugin array
    Expected Result: Plugin registered
    Evidence: .sisyphus/evidence/task-23-install.txt
  ```

  **Commit**: YES (groups with Tasks 21-22, 24)
  - Files: `src/cli/commands/install.ts`

- [x] 24. CLI TUI Prompts Module (Interactive Setup)

  **What to do**:
  - TDD: Write tests in `src/cli/tui-prompts.test.ts`
  - Create `src/cli/tui-prompts.ts` — Interactive terminal prompts for CLI commands
  - Implements: `confirm(message)`, `select(message, options)`, `text(message, default?)`
  - Uses raw stdin/stdout for TUI (no external dependency)
  - Provides fallback for non-interactive environments (uses defaults)
  - Used by init command (Task 22) for interactive config setup

  **Must NOT do**:
  - Do NOT add inquirer, prompts, or similar dependencies
  - Do NOT block indefinitely — timeout after 30s with default

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Terminal UI interaction design requires UX awareness
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 21-23 (CLI commands use prompts)
  - **Blocked By**: Task 6 (CLI scaffold)

  **References**:
  - OMO `src/cli/tui-install-prompts.ts` — TUI prompt implementation
  - OMO `src/cli/tui-installer.ts` — Interactive installer pattern

  **Acceptance Criteria**:
  - [ ] `confirm`, `select`, `text` functions exported
  - [ ] Non-interactive fallback uses defaults
  - [ ] `bun test src/cli/tui-prompts.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Non-interactive mode uses defaults
    Tool: Bash (bun test)
    Steps:
      1. Set non-interactive flag
      2. Call select() with default option
      3. Assert returns default without waiting for input
    Expected Result: Default returned immediately
    Evidence: .sisyphus/evidence/task-24-non-interactive.txt
  ```

  **Commit**: YES (groups with Tasks 21-23)
  - Message: `feat(cli): doctor, init, install commands with TUI`
  - Files: `src/cli/tui-prompts.ts`

### Wave 4 — Integration + Migration (6 tasks, partially sequential)

- [x] 25. New index.ts Compositor (Replace Monolithic Entry Point)

  **What to do**:
  - TDD: Update `src/index.test.ts` with integration tests
  - Rewrite `src/index.ts` — Slim entry point that:
    1. Calls `loadArgusConfig` (from Task 8)
    2. Creates hook guard via `createHookGuard(config.disabled_hooks)`
    3. Calls `createManagers` (from Task 11)
    4. Calls `createTools` (from Task 9)
    5. Calls `createHooks` (from Task 10)
    6. Calls `createPluginInterface` (from Task 14)
    7. Returns plugin interface
  - The new index.ts should be ~30-40 lines (down from 85)
  - Must still start Solodit MCP if enabled
  - Must trigger knowledge sync if enabled
  - Preserve `export default ArgusPlugin` signature
  - **DELETE `src/plugin-config.ts`** after confirming all imports have been moved to `src/config/` (schema from Task 2, loader from Task 8). The old file cannot coexist with the new config system — single source of truth only. Verify no remaining imports reference it.
  - **`startSoloditMcp()` stays here** — it's a startup side-effect (plugin lifecycle), not composition. Call it in the compositor before returning the plugin interface.
  - **OMO CO-EXISTENCE — Solodit MCP port**: Make Solodit MCP port configurable via config (`solodit.port`, default 3000). Port 3000 is a common dev port — when running alongside other tools, conflicts occur. Update MCP registration URL to use configured port.

  **Must NOT do**:
  - Do NOT change the exported plugin type signature
  - Do NOT remove Solodit MCP startup logic — keep it in the compositor (not a factory)
  - Do NOT break the `@opencode-ai/plugin` Plugin type contract
  - Do NOT hardcode port 3000 — use config value

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex integration of all factory outputs, must maintain backward compatibility
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on all prior waves)
  - **Parallel Group**: Wave 4 (can parallel with 26-29 once started)
  - **Blocks**: Task 30 (test migration)
  - **Blocked By**: Tasks 8-14 (all factories), Tasks 15-20 (all new hooks)

  **References**:
  - `src/index.ts` (84 lines) — Current monolithic entry (REPLACE entirely). NOTE: `knowledge-sync-hook` is NOT imported here — it's been moved into `config-handler.ts` (line 8, 33, 112-114). The new compositor must ensure this relationship is preserved (knowledge sync is triggered from config handler, not from index.ts).
  - `src/create-tools.ts` — From Task 9
  - `src/create-hooks.ts` — From Task 10
  - `src/create-managers.ts` — From Task 11
  - `src/plugin-interface.ts` — From Task 14
  - OMO `src/index.ts` — Slim factory-based entry point pattern

  **WHY Each Reference Matters**:
  - Current index.ts is the BEFORE — new one must produce identical runtime behavior
  - OMO index.ts shows the minimal compositor pattern to follow
  - The `config-handler.ts` → `knowledge-sync-hook` relationship is an internal detail the new factory system must preserve (see Task 26 config-handler migration notes)

  **Acceptance Criteria**:
  - [ ] `src/index.ts` is ≤40 lines
  - [ ] Plugin loads and returns valid interface
  - [ ] Solodit MCP starts when enabled
  - [ ] Knowledge sync triggers when enabled
  - [ ] `src/plugin-config.ts` DELETED — `grep -r "plugin-config" src/` returns zero hits
  - [ ] `bun test src/index.test.ts` → PASS
  - [ ] `bun run typecheck` → zero errors

  **QA Scenarios**:
  ```
  Scenario: Plugin loads with correct shape
    Tool: Bash (bun test)
    Steps:
      1. Import ArgusPlugin from src/index.ts
      2. Call with mock ctx
      3. Assert returns: tool (8 keys), config, experimental hooks, event
    Expected Result: Plugin shape matches OpenCode contract
    Evidence: .sisyphus/evidence/task-25-plugin-load.txt

  Scenario: Plugin works with hooks disabled
    Tool: Bash (bun test)
    Steps:
      1. Set config disabled_hooks: ["system-prompt", "compaction"]
      2. Load plugin
      3. Assert plugin still loads, disabled hooks are no-ops
    Expected Result: Graceful handling of disabled hooks
    Evidence: .sisyphus/evidence/task-25-disabled-hooks.txt
  ```

  **Commit**: YES
  - Message: `refactor(core): new modular index.ts replacing monolithic entry`
  - Files: `src/index.ts`
  - Pre-commit: `bun test`

- [x] 26. Migrate Existing 6 Hooks to Factory Pattern

  **What to do**:
  - Update each existing hook to work with the new factory pattern:
    - `src/hooks/system-prompt-hook.ts` — Accept dependencies via params, not closure. **BEHAVIOR CHANGE (required for multi-plugin safety)**: `createSystemPromptHook` currently receives `{ system: currentSystem, cwd }` and returns the **full concatenated system string** (`return \`${input.system}\n\n${contextBlock}\``). Change to return ONLY the audit context block (not the full joined system prompt). The compositor in Task 14 handles pushing this to `output.system`. **Existing tests must be updated** to expect the new return value (just the context block, not the full system string). This change is REQUIRED because the old pattern (`output.system = [fullString]`) destroys other plugins' system entries.
    - `src/hooks/compaction-hook.ts` — Same pattern change. **BEHAVIOR CHANGE**: Currently returns `${xml}\n${input.summary}`. Change to return ONLY the audit state XML block. Compositor (Task 14) pushes it to `output.context`. Old pattern (`output.context = [compacted]`) destroys other plugins' context entries. **Existing tests must be updated** to expect just the XML block.
    - `src/hooks/tool-tracking-hook.ts` — Same. Add parallel `tool.execute.before` handler that captures raw tool args for audit tools BEFORE OMO's truncator runs.
    - `src/hooks/event-hook.ts` — Replace with event-hook-v2.ts (Task 20)
    - `src/hooks/knowledge-sync-hook.ts` — Same. **Architectural decision**: Knowledge-sync stays owned by config-handler in this refactor (preservation over purity). It's instantiated inside config-handler and triggered after config setup. Future refactor could extract it into create-hooks as an independent hook, but that's out of scope for this overhaul.
    - `src/hooks/config-handler.ts` — Accept config via factory, not direct import. **CRITICAL — Full Preservation Checklist**:
      1. `ensureTrailOfBitsSkills()` (lines 17-28) — Trail of Bits skill repo cloning to `~/.cache/opencode-argus/trailofbits-skills`
      2. `createKnowledgeSyncHook` import and trigger (line 8, 33, 112-114)
      3. `@opencode-ai/sdk/v2` Config type usage (line 5)
      4. **4 agent prompt imports** (lines 9-12): `ARGUS_PROMPT`, `SENTINEL_PROMPT`, `PYTHIA_PROMPT`, `SCRIBE_PROMPT` from `../agents/*-prompt.ts` — required for agent `prompt` field in registration
      5. Agent `permission` and `tools` field registration (lines 43-86) — now schema-driven with same defaults
      6. Solodit MCP registration (lines 89-99)
      7. Skills path setup including ToB (lines 101-110)
      8. **Config spread patterns for multi-plugin safety** (CRITICAL): `config.agent = { ...config.agent, ... }` (line 36-37), `config.mcp = { ...(config.mcp ?? {}), ... }` (line 91-92), `config.skills = { ...(config.skills ?? {}), paths: [...existing, ...new] }` (line 101, 107-110). These preserve entries from other plugins/OpenCode itself. NEVER replace — always spread.
  - Each hook must be creatable via `createHooks` factory (Task 10)
  - Each hook must be guardable via `isHookEnabled`
  - Preserve ALL existing behavior — only change how hooks are created

  **Must NOT do**:
  - Do NOT replace `output.system` or `output.context` arrays — only push
  - Do NOT rename hook files (yet — that's cleanup)
  - Do NOT break any existing tests

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 6 hooks with intertwined state dependencies need careful rewiring
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (can run alongside Task 27)
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 30 (test migration)
  - **Blocked By**: Task 10 (create-hooks factory), Task 3 (hook types)

  **References**:
  - `src/hooks/system-prompt-hook.ts` — Current factory pattern
  - `src/hooks/compaction-hook.ts` — Current factory pattern
  - `src/hooks/tool-tracking-hook.ts` — Current factory pattern
  - `src/hooks/event-hook.ts` — Current factory pattern (replaced by v2)
  - `src/hooks/knowledge-sync-hook.ts` — Current factory pattern
  - `src/hooks/config-handler.ts` (117 lines) — Current config handler. **Key areas to preserve during migration**: `ensureTrailOfBitsSkills()` (lines 17-28), `createKnowledgeSyncHook` import/trigger (line 8, 33, 112-114), agent `permission`/`tools` fields (lines 43-86), Solodit MCP registration (lines 89-99), skills path assembly including ToB (lines 101-110), `@opencode-ai/sdk/v2` Config type (line 5)
  - `src/create-hooks.ts` — Target factory (from Task 10)

  **Acceptance Criteria**:
  - [ ] All 6 hooks work via createHooks factory
  - [ ] isHookEnabled guards applied
  - [ ] All existing hook tests still pass
  - [ ] `bun test src/hooks/` → PASS (all existing tests green)

  **QA Scenarios**:
  ```
  Scenario: All existing hook tests pass
    Tool: Bash (bun test)
    Steps:
      1. Run `bun test src/hooks/`
      2. Assert zero failures
    Expected Result: All 6 hook test files pass
    Evidence: .sisyphus/evidence/task-26-hook-tests.txt
  ```

  **Commit**: YES (groups with Task 27)
  - Message: `refactor(migrate): existing hooks and tools to factory pattern`
  - Files: `src/hooks/*.ts`
  - Pre-commit: `bun test src/hooks/`

- [x] 27. Migrate Existing 8 Tools to Factory Pattern

  **What to do**:
  - Update each tool to work with `createTools` factory (Task 9):
    - Ensure all 8 tools are importable by the factory
    - Add conditional registration based on config (e.g., solodit disabled → skip solodit tool)
    - Ensure tool `context.metadata()` calls still work
    - Verify `context.abort` signal propagation
  - No changes to tool logic — only how they're registered
  - **Exception — slither-tool.ts import refactoring**: Remove local definitions of `hasBinary()` (line 197-204), `parseSolcVersion()` (line 144-184), `extractContractNames()` (line 186-195) and replace with `import { hasBinary, parseSolcVersion, extractContractNames } from "../shared/binary-utils"`. Update `FlattenFallbackDeps` type (line 242) and default object (line 249-256) to reference imported `hasBinary`. Update `ensureSolc()` (line 206-218) which calls `hasBinary` locally. This is a **structural refactor only** — zero behavioral change to these functions.

  **Must NOT do**:
  - Do NOT change tool behavioral logic (execution, parsing, output formatting)
  - Do NOT rename tool keys
  - Do NOT break existing tool tests

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with Task 26)
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 30
  - **Blocked By**: Task 9 (create-tools factory)

  **References**:
  - `src/tools/*.ts` — All 8 tool files (verify imports work via factory)
  - `src/create-tools.ts` — Target factory (from Task 9)

  **Acceptance Criteria**:
  - [ ] All 8 tools register via createTools
  - [ ] Conditional exclusion works
  - [ ] All existing tool tests still pass
  - [ ] `bun test src/tools/` → PASS

  **QA Scenarios**:
  ```
  Scenario: All existing tool tests pass
    Tool: Bash (bun test)
    Steps:
      1. Run `bun test src/tools/`
      2. Assert zero failures
    Expected Result: All 8 tool test files pass
    Evidence: .sisyphus/evidence/task-27-tool-tests.txt
  ```

  **Commit**: YES (groups with Task 26)
  - Message: `refactor(migrate): existing hooks and tools to factory pattern`
  - Files: `src/tools/*.ts` (minimal changes), `src/create-tools.ts` (imports)
  - Pre-commit: `bun test src/tools/`

- [x] 28. Update package.json (bin Entry, Exports, New Scripts)

  **What to do**:
  - Add `"bin": { "argus": "./src/cli/index.ts" }` to package.json
  - Add CLI script: `"cli": "bun src/cli/index.ts"`
  - Update `"files"` array to include new directories: `src/cli/`, `src/config/`, `src/features/`, `src/managers/`, `src/shared/`
  - Verify `"main"`, `"module"`, `"types"` still point to correct entry
  - Add scripts: `"doctor": "bun src/cli/index.ts doctor"`, `"init": "bun src/cli/index.ts init"`

  **Must NOT do**:
  - Do NOT change the name, version, or license
  - Do NOT add new dependencies

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with Tasks 25-27, 29)
  - **Parallel Group**: Wave 4
  - **Blocks**: None
  - **Blocked By**: Tasks 6, 21-23, 25

  **References**:
  - `package.json` — Current file to update
  - OMO `package.json` — Bin entry pattern

  **Acceptance Criteria**:
  - [ ] `"bin"` entry added
  - [ ] `"files"` includes all new directories
  - [ ] `bun src/cli/index.ts --help` works

  **QA Scenarios**:
  ```
  Scenario: CLI binary entry works
    Tool: Bash
    Steps:
      1. Run `bun src/cli/index.ts --help`
      2. Assert output contains "argus" and command list
    Expected Result: CLI accessible via bin entry
    Evidence: .sisyphus/evidence/task-28-bin.txt
  ```

  **Commit**: YES (groups with Task 29)
  - Message: `chore: update package.json and AGENTS.md`
  - Files: `package.json`

- [x] 29. Update AGENTS.md for New Architecture

  **What to do**:
  - Update `AGENTS.md` to reflect new module structure
  - **Also update `README.md`**: Fix Scribe model in agent table (`claude-sonnet-4-5` → `claude-sonnet-4-6`), update config example (`"scribe": { "model": "anthropic/claude-sonnet-4-6" }`), and add mention of new features (CLI, hook enable/disable, multi-level config)
  - Add mention of CLI capabilities
  - Add mention of hook enable/disable
  - Keep existing agent descriptions intact
  - Add configuration section pointing to new config schema

  **Must NOT do**:
  - Do NOT change agent names, roles, or tool assignments
  - Do NOT add agents that don't exist

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: None
  - **Blocked By**: Task 25 (new index.ts)

  **References**:
  - `AGENTS.md` — Current file to update
  - `README.md` — Fix Scribe model reference and add new feature documentation

  **Acceptance Criteria**:
  - [ ] AGENTS.md reflects new architecture
  - [ ] README.md Scribe model updated to `claude-sonnet-4-6` in agent table and config example
  - [ ] README.md mentions CLI, hook enable/disable, multi-level config
  - [ ] CLI mentioned
  - [ ] All 4 agents still documented correctly

  **QA Scenarios**:
  ```
  Scenario: AGENTS.md is valid
    Tool: Bash
    Steps:
      1. Read AGENTS.md
      2. Assert contains: argus, sentinel, pythia, scribe sections
      3. Assert mentions CLI and hook configuration
    Expected Result: Documentation updated
    Evidence: .sisyphus/evidence/task-29-agents-md.txt
  ```

  **Commit**: YES (groups with Task 28)
  - Message: `chore: update package.json and AGENTS.md`
  - Files: `AGENTS.md`

- [x] 30. Migrate + Update All Existing Tests

  **What to do**:
  - Update all 23 existing test files to work with new architecture:
    - Tests importing from old `plugin-config.ts` → import from new `config/` module
    - Tests using old hook creation → use new factory pattern
    - Tests verifying index.ts shape → update for new compositor
    - **Reconcile SDK import paths**: `tests/integration/full-audit.test.ts:3` imports `Config` from `@opencode-ai/sdk` while `config-handler.ts:5` uses `@opencode-ai/sdk/v2`. Standardize all imports to the correct path.
    - **Update system-prompt-hook and compaction-hook tests**: These hooks now return ONLY their context blocks (not full concatenated strings) — see Task 26 behavior changes. Update assertions accordingly.
  - Add integration test: `tests/integration/factory-composition.test.ts` — verifies full plugin loads via factory composition
  - Add integration test: `tests/integration/hook-disable.test.ts` — verifies hooks can be disabled
  - Add integration test: `tests/integration/persistent-state.test.ts` — verifies state persistence
  - Run full `bun test` — ZERO failures

  **Must NOT do**:
  - Do NOT delete any existing test — update or extend
  - Do NOT reduce test coverage

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 23+ test files need careful migration while maintaining coverage
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (must be last, after all other Wave 4)
  - **Parallel Group**: Wave 4 (sequential after 25-29)
  - **Blocks**: Final Verification Wave
  - **Blocked By**: Tasks 25-29

  **References**:
  - All 23 test files in `src/**/*.test.ts` and `tests/`
  - New modules from all prior tasks

  **Acceptance Criteria**:
  - [ ] All 23 existing tests pass (updated for new architecture)
  - [ ] 3 new integration tests added and passing
  - [ ] `bun test` → PASS (26+ tests, zero failures)
  - [ ] `bun run typecheck` → zero errors

  **QA Scenarios**:
  ```
  Scenario: Full test suite passes
    Tool: Bash
    Steps:
      1. Run `bun test`
      2. Assert zero failures
      3. Assert ≥26 test files executed
    Expected Result: All tests green
    Evidence: .sisyphus/evidence/task-30-full-tests.txt

  Scenario: Typecheck passes
    Tool: Bash
    Steps:
      1. Run `bun run typecheck`
      2. Assert zero errors
    Expected Result: No type errors
    Evidence: .sisyphus/evidence/task-30-typecheck.txt
  ```

  **Commit**: YES
  - Message: `test: migrate and update all tests for new architecture`
  - Files: `src/**/*.test.ts`, `tests/**/*.test.ts`
  - Pre-commit: `bun test`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `bun run typecheck` + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod (except logger), commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Run `bun test` — all 23+ existing tests pass. Run `bun run typecheck` — zero errors. Test `argus doctor` CLI command in tmux. Verify config reads from both user and project locations. Verify plugin exports correct shape. Test hook disable by setting `disabled_hooks` in config.
  Output: `Tests [N/N pass] | Typecheck [PASS/FAIL] | CLI [N/N commands] | Config [PASS/FAIL] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance: no prompt changes, no tool behavior changes, no new deps. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Must NOT [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| After Task(s) | Message | Verification |
|------------|---------|--------------|
| 1 | `feat(shared): add logger, deep-merge, jsonc-parser, file-utils` | bun test |
| 2 | `feat(config): new config schema with Zod types` | bun test |
| 3 | `feat(hooks): add hook system types and isHookEnabled infrastructure` | bun test |
| 4-5 | `feat(types): add manager interfaces and plugin state types` | bun test |
| 6-7 | `feat(scaffold): CLI framework and feature module structure` | bun test |
| 8 | `feat(config): multi-level config loader with deep merge` | bun test |
| 9-11 | `feat(arch): create-tools, create-hooks, create-managers factories` | bun test |
| 12-13 | `feat(managers): background agent manager and persistent audit state` | bun test |
| 14 | `feat(arch): plugin-interface compositor` | bun test |
| 15-20 | `feat(hooks): error recovery, context monitor, audit enforcer, event system` | bun test |
| 21-24 | `feat(cli): doctor, init, install commands with TUI` | bun test |
| 25 | `refactor(core): new modular index.ts replacing monolithic entry` | bun test |
| 26-27 | `refactor(migrate): existing hooks and tools to factory pattern` | bun test |
| 28-29 | `chore: update package.json and AGENTS.md` | bun test |
| 30 | `test: migrate and update all tests for new architecture` | bun test |

---

## Success Criteria

### Verification Commands
```bash
bun test                          # Expected: all tests pass (23 existing + new)
bun run typecheck                 # Expected: zero errors
bun run build                     # Expected: builds successfully
node dist/index.js --help 2>&1    # Expected: CLI help output (after build)
```

### Final Checklist
- [x] All 8 existing tools work identically
- [x] All 4 agents register correctly
- [x] All 55 SKILL.md files accessible
- [x] SCVD integration works
- [x] Solodit MCP starts correctly
- [x] Config loads from user + project locations
- [x] Hook disable works via disabled_hooks
- [x] Audit state persists to disk
- [x] CLI doctor reports Slither/Foundry status
- [x] All tests pass
- [x] Zero type errors
