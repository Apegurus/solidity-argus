# Argus Overhaul — Learnings

## Session: ses_38efe785fffePog0Ux62Dfy1ye (2026-02-18)

### Key Codebase Facts
- `src/index.ts` — 84 lines, monolithic entry point
- `src/hooks/config-handler.ts` — 117 lines, imports `@opencode-ai/sdk/v2`
- `src/tools/slither-tool.ts` — 523 lines, has DI pattern via `FlattenFallbackDeps`
- `src/plugin-config.ts` — 140 lines, current Zod schema + JSONC loader (to be DELETED in Task 25)
- `src/state/types.ts` — 56 lines, has `AuditPhase` with values: `"reconnaissance" | "scanning" | "manual-review" | "attack-surface" | "research" | "testing" | "reporting" | "complete"`
- `src/constants/defaults.ts` — scribe model is `claude-sonnet-4-6` (NOT 4-5)

### Critical Patterns
- ALL hook output mutations MUST use `.push()`, NEVER array replacement
- `config.agent = { ...config.agent, ... }` — always spread, never replace
- `config` hook is EXEMPT from isHookEnabled (always required)
- `knowledge-sync-hook` lives inside config-handler, NOT index.ts
- `startSoloditMcp()` stays in compositor (index.ts), not a factory
- `src/plugin-config.ts` gets DELETED in Task 25

### Architecture Decisions
- `finding-store.ts` — UNCHANGED in this overhaul
- `createAuditState` factory is preserved; AuditStateManager wraps it for persistence
- Wave 2 has sub-waves: 2a (T8,9,10,12,13 parallel) → 2b (T11) → 2c (T14)

## Task 4: Manager Interfaces (T4)

### What Was Done
- Created `src/managers/types.ts` with two interface definitions:
  - `BackgroundManager`: Handles agent task dispatch, cancellation, result retrieval, completion callbacks, and active task counting
  - `AuditStateManager`: Handles audit state persistence (load, save, get, update, reset)
  - `Managers` type: Container for both manager instances
- Created `src/managers/index.ts` barrel export
- Imported `AuditState` from `../state/types` for type reference
- All interfaces use JSDoc comments for public API documentation (necessary for implementers)

### Key Patterns
- Interface contracts are self-documenting with JSDoc
- Managers are dependency-injected containers (will be passed to plugins)
- BackgroundManager returns taskId (string) for tracking async operations
- AuditStateManager uses Partial<AuditState> for flexible updates
- No implementations — pure type definitions

### Typecheck Status
- ✅ Zero errors on new files
- Existing errors in other files (config-handler.test.ts, plugin-config.test.ts, schema.ts, deep-merge.test.ts) are pre-existing and unrelated

### Commit
- `feat(types): add manager interfaces and plugin state types` (eff42ad)
- Grouped with T5 as planned (both type definitions)


## Task 3: Hook System Types & Infrastructure (T3)

### What Was Done
- Created `src/hooks/types.ts` with `HookName` union type containing all 10 hook names:
  - `"system-prompt" | "compaction" | "tool-tracking" | "event" | "knowledge-sync" | "session-recovery" | "tool-error-recovery" | "context-window-monitor" | "tool-output-truncator" | "audit-continuation"`
- Created `src/hooks/hook-system.ts` with `createHookGuard(disabledHooks: string[])` function:
  - Returns `isHookEnabled(name: HookName) => boolean`
  - Uses Set for O(1) lookup performance
  - No circular dependencies (accepts string[], not config)
- Created `src/hooks/safe-create-hook.ts` with `safeCreateHook<T>(factory: () => T, hookName: string): T | undefined`:
  - Catches all errors, logs via console.error with hook name
  - Returns undefined on error (safe fallback)
  - Generic type parameter for flexibility
- Created `src/hooks/hook-system.test.ts` with 4 comprehensive tests:
  - Empty disabled list → all hooks enabled
  - Selective disable → correct enable/disable logic
  - All disabled → all hooks disabled
  - Single hook disable → correct behavior
- Created `src/hooks/index.ts` barrel export for new modules

### Key Patterns
- `HookName` is a strict union type (not string) — enforces type safety at call sites
- `createHookGuard` is a factory returning a closure — enables per-instance hook configuration
- `safeCreateHook` wraps factory functions — prevents hook creation errors from crashing the system
- Error logging includes hook name for debugging
- No config imports in hook-system.ts — avoids circular dependencies

### Typecheck Status
- ✅ Zero errors on all 5 new files
- Existing errors in other files are pre-existing and unrelated

### Test Results
- ✅ 4 tests pass, 32 expect() calls
- All edge cases covered: empty list, selective disable, all disabled, single disable

### Commit
- `feat(hooks): add hook system types and isHookEnabled infrastructure` (5d9314e)
- 5 files changed, 123 insertions
- Ready for Task 10 (create-hooks.ts) which will use these types


## Task 7: Feature Module Scaffolding

**Completed:** Created `src/features/` directory structure with 5 feature subdirectories and barrel exports.

### Structure Created
- `src/features/background-agent/index.ts` — empty barrel `export {}`
- `src/features/persistent-state/index.ts` — empty barrel `export {}`
- `src/features/context-monitor/index.ts` — empty barrel `export {}`
- `src/features/audit-enforcer/index.ts` — empty barrel `export {}`
- `src/features/error-recovery/index.ts` — empty barrel `export {}`
- `src/features/index.ts` — top-level barrel re-exporting all 5 features

### Commit
- `feat(scaffold): CLI framework and feature module structure` (cd82862)
- 6 files created, 10 insertions

### Typecheck Status
- Pre-existing errors in `src/state/plugin-state.test.ts` (unrelated to scaffolding)
- New feature files have zero errors
- Barrel exports are syntactically valid

### Notes
- All feature subdirectories are placeholders for Wave 3 implementations
- Implementations scheduled for: T12 (background-agent), T13 (persistent-state), T17 (context-monitor), T19 (audit-enforcer), T15+T16 (error-recovery)
- Empty barrels allow for clean module structure without circular dependencies

## Task 6: CLI Framework (T6)

**Completed:** Created `src/cli/` directory with CLI framework, entry point, and comprehensive test suite.

### Structure Created
- `src/cli/types.ts` — `CliCommand` interface: `{ name: string, description: string, execute: (args: string[]) => Promise<number> }`
- `src/cli/cli-program.ts` — `CliProgram` class with command registration and dispatch; `createCliProgram()` factory with 3 stub commands (doctor, init, install)
- `src/cli/index.ts` — entry point: parses `Bun.argv.slice(2)`, calls cli-program, exits with code
- `src/cli/cli-program.test.ts` — 10 comprehensive tests covering help output, command dispatch, unknown commands, and stub commands

### Key Implementation Details
- **Help text format:** Matches spec exactly with command descriptions
- **Bun.argv parsing:** `Bun.argv[0]` = 'bun', `Bun.argv[1]` = script path, `Bun.argv[2+]` = subcommands/args
- **Command dispatch:** Strips first arg (subcommand), passes remaining args to command.execute()
- **Exit codes:** 0 for success, 1 for unknown command
- **Stub commands:** All print "argus {cmd}: not yet implemented" and exit 0
- **Error handling:** Unknown command prints to stderr with helpful message

### Test Coverage
- ✅ Help output (no args, --help, -h)
- ✅ Command dispatch with args passing
- ✅ Exit code propagation
- ✅ Unknown command error handling
- ✅ All 3 stub commands (doctor, init, install)
- ✅ 10 tests pass, 22 expect() calls

### Verification
- `bun test src/cli/cli-program.test.ts` → 10 pass
- `bun src/cli/index.ts` → shows help, exit 0
- `bun src/cli/index.ts unknown-cmd` → error message, exit 1
- `bun src/cli/index.ts doctor|init|install` → stub messages, exit 0

### Commit
- `feat(scaffold): CLI framework and feature module structure` (ab6b8fa)
- 4 files created, 229 insertions
- Atomic: CLI framework is independent, ready for Wave 2 command implementations

### Notes
- No external CLI framework (commander, yargs) — pure Bun.argv parsing
- CliCommand interface is extensible for future commands
- createCliProgram() factory pattern allows for testing and dependency injection
- All output uses plain console.log/console.error (no colors/spinners yet)

## Task 2: Config Schema with Zod Types

### Key Learnings

1. **Zod v4 Record Syntax**
   - Must use `z.record(z.string(), z.any())` not `z.record(z.any())`
   - Two-argument form required for proper type inference

2. **Nested Schema Defaults**
   - When nesting schemas with `.default()`, apply defaults at each level
   - Parent object needs `.default({...})` with proper structure
   - Child schemas need `.default({...})` with their own defaults

3. **SDK Import Path**
   - `@opencode-ai/sdk/v2` is valid subpath export
   - Defined in SDK package.json exports: `"./v2": "./dist/v2/index.js"`
   - config-handler.ts correctly uses this path

4. **Validation Strategy**
   - Use `z.number().positive()` for positive-only numbers
   - `safeParse()` never throws - returns `{ success: boolean, data?, error? }`
   - All fields should have defaults for empty config `{}` to be valid

5. **New Fields in Schema**
   - `solodit.port` (default 3000) - configurable Solodit MCP server port
   - `disabled_hooks` (default []) - array of hook names to disable
   - Both are new additions not in old plugin-config.ts

6. **Agent Config Structure**
   - Each agent (argus, sentinel, pythia, scribe) has:
     - `model?: string` - override default model
     - `permission?: Record<string, any>` - task delegation permissions
     - `tools?: Record<string, boolean>` - tool access control
   - These fields document current defaults from config-handler.ts

### Test Coverage Strategy
- Test valid complete config
- Test empty config with all defaults
- Test partial configs with mixed defaults
- Test invalid enum values (severity, format)
- Test new fields (solodit.port, disabled_hooks)
- Test safeParse doesn't throw
- Test validation constraints (positive numbers)


## Task 5: Plugin State Types (T5)

### What Was Done
- Extended `src/state/types.ts` with `PersistentAuditState` interface:
  - Extends `AuditState` with three new fields: `savedAt: number`, `version: string`, `filePath: string`
  - Preserves all existing types: `FindingSeverity`, `AuditPhase`, `Finding`, `ContractProfile`, `ToolExecution`, `AuditState`
  - Did NOT modify existing `AuditPhase` values (still: `"reconnaissance" | "scanning" | "manual-review" | "attack-surface" | "research" | "testing" | "reporting" | "complete"`)
- Created `src/state/plugin-state.ts` with `PluginState` interface:
  - `config: ArgusConfig` — imported from `../config/types`
  - `projectDir: string` — project root directory
  - `managers: Managers` — imported from `../managers/types`
  - `isHookEnabled: (name: string) => boolean` — hook enablement check function
  - Includes JSDoc explaining purpose and composition
- Created `src/state/plugin-state.test.ts` with comprehensive type shape tests:
  - Tests PluginState compiles with correct interface structure
  - Verifies all required properties exist and have correct types
  - Uses mock ArgusConfig and Managers to validate type compatibility
  - 2 test cases covering structure validation and property existence

### Key Patterns
- `PersistentAuditState` is a simple extension interface — no logic, pure type composition
- `PluginState` is the root state container for the entire plugin instance
- Both interfaces use composition over inheritance where appropriate
- JSDoc comments on public interfaces aid implementers and IDE autocomplete

### Typecheck Status
- ✅ Zero errors on new files (plugin-state.ts, plugin-state.test.ts)
- ✅ No errors on extended types.ts
- Existing errors in other files (config-handler.test.ts, plugin-config.test.ts) are pre-existing and unrelated

### Test Results
- ✅ All 24 tests in src/state/ pass (including 2 new plugin-state tests)
- ✅ 53 expect() calls total
- ✅ No regressions in existing audit-state.test.ts or finding-store.test.ts

### Commit
- `feat(types): add manager interfaces and plugin state types` (966ce7a)
- 3 files changed, 106 insertions
- Grouped with Task 4 as planned (both type definitions)

### Notes
- `ArgusConfig` and `Managers` types already exist from Tasks 2 and 4
- No placeholder types needed — all dependencies available
- PluginState is the root container that will be passed to hooks and features in Wave 2
- PersistentAuditState will be used by AuditStateManager (Task 11) for persistence layer


## Wave 1: Shared Utilities Module (Task 1)

### Completed
- ✅ Created `src/shared/` directory with 5 utility modules + tests + barrel export
- ✅ All 59 tests passing (TDD approach: tests first, then implementation)
- ✅ Zero TypeScript errors
- ✅ Committed: `feat(shared): add logger, deep-merge, jsonc-parser, file-utils, binary-utils`

### Key Learnings

#### 1. JSONC Parser (stripJsoncComments)
- **Challenge**: Original algorithm only checked string state at first `//` occurrence
- **Solution**: Iterate through entire line, tracking string state, and capture the FIRST `//` found outside a string
- **Critical**: Must handle escaped quotes (`\"`) and preserve URLs like `https://api.example.com`
- **Pattern**: Block comments removed first (`/* */`), then line comments (`//`), then trailing commas

#### 2. Deep Merge (deepMerge)
- **Array handling**: Concatenate + deduplicate using `Set` (preserves order, removes duplicates)
- **Undefined skip**: Source values of `undefined` are skipped (don't override target)
- **Recursive**: Both objects and arrays trigger recursion; non-objects override
- **No mutation**: Creates new objects/arrays, doesn't mutate inputs

#### 3. Logger (createLogger)
- **Stderr only**: Uses `console.error`, NOT `console.log` (stderr is standard for structured logging)
- **Prefix**: All messages prefixed with `[argus]`
- **Debug flag**: When `debug=false`, `logger.debug()` outputs nothing; other methods always output
- **No side effects**: Pure function, no global state

#### 4. File Utils (detectConfigFile, readJsoncFile)
- **Config detection**: Searches in priority order: `.opencode/opencode-argus.jsonc`, `.opencode/opencode-argus.json`, then root
- **Graceful failure**: Returns `null` for missing/invalid files, never throws
- **JSONC parsing**: Reuses `stripJsoncComments` before `JSON.parse`

#### 5. Binary Utils (hasBinary, parseSolcVersion, extractContractNames)
- **Extracted verbatim** from `src/tools/slither-tool.ts` (lines 144-204)
- **hasBinary**: Uses `which` command with 3s timeout
- **parseSolcVersion**: Checks `foundryToml` first, then scans `.sol` files for pragma
- **extractContractNames**: Regex matches `contract|library|interface` keywords

### Testing Patterns
- Used `bun:test` with `describe/it/expect`
- Mocked `console.error` to capture logger output
- Created temp directories for file I/O tests, cleaned up in `afterEach`
- Tested edge cases: empty files, missing files, invalid JSON, escaped quotes, URLs in strings

### Code Quality
- No unnecessary comments (only complex algorithm logic documented)
- Strict TypeScript mode: all types explicit
- Zero external dependencies (only Node.js built-ins)
- All modules are standalone (no cross-imports within shared/)

### Next Steps
- These utilities are ready for integration into other modules
- `stripJsoncComments` can replace the one in `plugin-config.ts`
- `binary-utils` functions can be imported in `slither-tool.ts` instead of duplicated

## Task 12: Background Agent Manager (T12)

### What Was Done
- Created `src/features/background-agent/background-manager.ts` with `createBackgroundManager(dispatcher)`
- Added `BackgroundTaskOptions` with `priority` and `max_concurrent`
- Implemented in-memory task tracking with `Map<string, TaskInfo>` and queued task IDs
- Added concurrency gate (default 3) with simple queue draining logic
- Added lifecycle APIs: `dispatch`, `cancel`, `getResult`, `onComplete`, `getActiveCount`
- Updated barrel export in `src/features/background-agent/index.ts`
- Created `src/features/background-agent/background-manager.test.ts` with 4 tests covering dispatch, active counts, concurrency queueing, and completion callbacks

### Key Patterns
- Dispatcher is fully injectable and async (`(agentName, prompt, options?) => Promise<string>`)
- Manager returns local task IDs immediately (`task-{n}`), then resolves results asynchronously
- Concurrency is standalone and local to manager instance; no external active count coupling
- `getActiveCount()` counts non-terminal tasks (`queued` + `running`)
- `onComplete` supports both global callbacks (`onComplete(callback)`) and task-scoped callbacks (`onComplete(taskId, callback)`)

### Verification
- `bun test src/features/background-agent/background-manager.test.ts` → 4 pass
- `bun run typecheck` → clean
- LSP diagnostics clean on:
  - `src/features/background-agent/background-manager.ts`
  - `src/features/background-agent/background-manager.test.ts`
  - `src/features/background-agent/index.ts`

## Task 13: Persistent Audit State Manager (T13)

### What Was Done
- Created `src/features/persistent-state/audit-state-manager.ts` implementing `AuditStateManager` with `createAuditStateManager(projectDir)` factory
- Wrapped `createAuditState(projectDir)` for in-memory initialization and reset behavior (factory preserved, not replaced)
- Added async file persistence to `{projectDir}/.opencode/argus-state.json` with atomic write flow: write `argus-state.json.tmp` then rename
- Implemented `load`, `save`, `get`, `update`, `reset` with runtime shape validation for persisted JSON before hydration
- Added `src/features/persistent-state/audit-state-manager.test.ts` with 7 tests covering round-trip save/load, atomic writes, missing/invalid file behavior, update merge, reset freshness, and metadata fields
- Updated `src/features/persistent-state/index.ts` to export `createAuditStateManager`

### Key Patterns
- Keep state manager as a thin wrapper around `createAuditState`; persistence is orthogonal to state creation
- Use Bun async I/O (`Bun.file`, `Bun.write`) and `node:fs/promises` (`mkdir`, `rename`) to avoid sync operations in runtime path
- Persist as `PersistentAuditState` by adding `savedAt`, `version`, `filePath` on save and stripping those fields on load
- Shallow `update` merge matches `Partial<AuditState>` contract and then persists immediately for consistency
- Tests must isolate filesystem effects using `mkdtempSync` temp roots and recursive cleanup in `afterEach`

### Verification
- `bun test src/features/persistent-state/audit-state-manager.test.ts` -> 7 pass
- `bun test src/features/persistent-state/` -> 7 pass
- `bun run typecheck` -> pass

## Task 10: create-hooks factory with guards

### What Was Done
- Created `src/create-hooks.ts` with `createHooks({ config, managers, isHookEnabled })` and exported `Hooks` type (optional hook slots)
- Composed existing hook wiring from `src/index.ts` into factory: config handler, system prompt transform, compaction, tool tracking, and event hook
- Wrapped feature hook factories in `safeCreateHook` and guarded feature hooks with `isHookEnabled` for: `system-prompt`, `compaction`, `tool-tracking`, `event`
- Kept `config` hook always enabled (never gated by `isHookEnabled`) so agent/tool registration and knowledge-sync bootstrap are always available
- Created `src/create-hooks.test.ts` with TDD coverage for default enabled behavior, selective disable, config-hook exemption, and guard-call coverage

### Verification Notes
- `bun test src/create-hooks.test.ts` passes (4/4)
- `bun run typecheck` currently fails on pre-existing unrelated missing file: `src/features/background-agent/background-manager.test.ts` imports `./background-manager` which does not exist yet
- LSP diagnostics are clean for changed files: `src/create-hooks.ts`, `src/create-hooks.test.ts`

## Task 9: create-tools.ts Factory

### What Was Done
- Created `src/create-tools.ts` with `createTools(config: ArgusConfig): Record<string, ToolDefinition>` factory
- Extracted all 8 tool imports from `src/index.ts:11-18` into the factory
- Conditionally includes `argus_solodit_search` only when `config.solodit?.enabled !== false`
- Created `src/create-tools.test.ts` with 5 TDD tests (61 expect() calls)

### Key Patterns
- `ToolDefinition` is `ReturnType<typeof tool>` from `@opencode-ai/plugin` — has `{ description, args, execute }` shape
- The `Hooks` interface in `@opencode-ai/plugin` types `tool` as `{ [key: string]: ToolDefinition }`
- Solodit is the only conditionally-included tool; all others are always registered
- Factory does NOT modify `src/index.ts` — integration happens in Task 25

### Verification
- `bun test src/create-tools.test.ts` → 5 pass, 61 expect() calls
- `bun run typecheck` → zero new errors (only pre-existing loader.test.ts errors)
- LSP diagnostics clean on both new files

### Pre-existing Typecheck Errors (not ours)
- `src/config/loader.test.ts` — `_mergeConfigs` property missing (4 errors)
- `src/hooks/config-handler.test.ts` — SDK type mismatches (8 errors)
- `src/plugin-config.test.ts` — verbatimModuleSyntax + undefined (2 errors)
- `src/features/persistent-state/audit-state-manager.test.ts` — missing module (1 error)

## Task 8: Multi-Level Config Loader (T8)

### What Was Done
- Created `src/config/loader.ts` with `loadArgusConfig(projectDir)` and `_mergeConfigs(userRaw, projectRaw)` 
- User-level config: `~/.config/opencode/` via `detectConfigFile(userConfigDir)`
- Project-level config: `{projectDir}/` via `detectConfigFile(projectDir)` (finds `.opencode/opencode-argus.{jsonc,json}`)
- Deep merge: project overrides user via `deepMerge` from shared utils
- Validation: `safeParse` with fallback to defaults on failure, warning via logger
- Created `src/config/loader.test.ts` with 9 TDD tests (40 expect() calls)
- Updated `src/config/index.ts` barrel to export `loadArgusConfig`

### Key Patterns
- `detectConfigFile(basePath)` takes ONE arg — searches `.opencode/opencode-argus.{jsonc,json}` and `opencode-argus.{jsonc,json}` within basePath
- Exported `_mergeConfigs` as testable helper — avoids needing to mock filesystem for merge logic tests
- `Record<string, unknown>` preferred over `Record<string, any>` for type safety
- Module-level logger instance (not per-call) is fine since createLogger is stateless
- `mkdtempSync` + `rmSync` in afterEach for test isolation — never touches real project dirs

### Verification
- `bun test src/config/loader.test.ts` → 9 pass, 40 expect() calls
- `bun run typecheck` → clean (zero errors)
- LSP diagnostics clean on all 3 files
