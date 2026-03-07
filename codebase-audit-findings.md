# Solidity-Argus Codebase Audit Findings

**Date**: 2026-03-06
**Scope**: Full codebase (~190 TypeScript files, ~15,000 LOC)
**Mode**: Read-only assessment — no changes made
**Verdict**: Not production-ready. 6 critical issues, 18 high, 32 medium, 20+ low.

---

## Executive Summary

The codebase has strong architectural foundations — event-sourced audit state, clean module boundaries, strict biome linting, and good test file coverage. However, it contains a potential infinite loop, an RCE vector, pervasive DRY violations, several god-functions, and widespread silent error swallowing that collectively block production readiness.

---

## Critical Issues (6)

### C-01: Potential Infinite Loop in `audit-state-manager.ts`

**File**: `src/features/persistent-state/audit-state-manager.ts` (lines 369–396)
**Description**: The `save()` method uses a `while(true)` compare-and-swap loop. It reads the current state from disk, merges it with the in-memory state, and writes back — but only breaks when the re-read state matches what was just written. Because the state is spread into a new object on every iteration, reference equality (`===`) will never hold on object values, creating a potential infinite loop if the state contains nested objects that don't have value-equality semantics.
**Impact**: Deadlock of the audit persistence layer. The audit hangs indefinitely.
**Remediation**: Use deep-equal comparison or content hash instead of reference equality. Add a max-retry count with error escalation.

---

### C-02: Remote Code Execution Vector in `solodit-search-tool.ts`

**File**: `src/tools/solodit-search-tool.ts` (line 366)
**Description**: The code uses `new Function(\`return ${dataStr}\`)()` to parse API response data. `new Function()` is semantically equivalent to `eval()` — if the Solodit API response is compromised, poisoned, or returns unexpected content, arbitrary JavaScript will execute in the plugin's context.
**Impact**: Full RCE in the user's environment. An attacker who controls or MITM's the Solodit API response can execute arbitrary code.
**Remediation**: Replace with `JSON.parse()`. If the response isn't valid JSON, fix the API client to request JSON, or use a safe parser.

---

### C-03: Massive DRY Violation — Forge Command Execution

**Files**:
- `src/tools/forge-test-tool.ts`
- `src/tools/forge-fuzz-tool.ts`
- `src/tools/forge-coverage-tool.ts`
- `src/tools/gas-analysis-tool.ts`

**Description**: All four files contain near-identical `Bun.spawn` wrapper code for executing forge commands — argument construction, process spawning, stdout/stderr collection, timeout handling, and exit code checking. The duplicated block is ~40–60 lines in each file.
**Impact**: Bug fixes or improvements to the forge execution pattern must be applied to 4 files simultaneously. Divergence is inevitable.
**Remediation**: Extract a shared `runForgeCommand(args, options)` utility into `src/shared/forge-runner.ts`. Each tool calls the shared runner with its specific arguments.

---

### C-04: Validation Constants Duplicated Across 4+ Files

**Files**:
- `src/state/schemas.ts`
- `src/state/adapters.ts`
- `src/state/projectors.ts`
- `src/state/finding-aggregation.ts`
- `src/hooks/tool-tracking-hook.ts`

**Description**: `VALID_SEVERITIES`, `VALID_CONFIDENCES`, `VALID_SOURCES`, `SEVERITY_RANK`, and the `isRecord()` type guard are each defined 2–4 times across these files. Some definitions are slightly different (e.g., different ordering, missing values), creating subtle inconsistencies.
**Impact**: Adding a new severity level or source requires updating 4+ files. Inconsistent definitions can cause findings to be silently dropped or misclassified.
**Remediation**: Define once in `src/state/constants.ts` (or in `schemas.ts` as the single source of truth) and import everywhere.

---

### C-05: `create-hooks.ts` Is an 810-Line Orchestration Monolith

**File**: `src/create-hooks.ts` (810 lines)
**Description**: This single function wires together session management, event sinks, state persistence, tool tracking, compaction, migration parity, finalization, and knowledge sync — all in deeply nested closures that share mutable state. The function is untestable in isolation because its dependencies are constructed internally rather than injected.
**Impact**: Any change to hook wiring risks breaking unrelated subsystems. The function cannot be unit-tested — only integration-tested. New developers cannot understand the initialization flow without reading all 810 lines.
**Remediation**: Break into focused factory functions: `createSessionHooks()`, `createPersistenceHooks()`, `createTrackingHooks()`, etc. Use dependency injection for testability.

---

### C-06: `tool-tracking-hook.ts` Is a 907-Line God-Function

**File**: `src/hooks/tool-tracking-hook.ts` (907 lines)
**Description**: A single exported function handles JSON parsing of tool results, finding extraction from 8+ different tool types (Slither, Forge, patterns, Solodit, etc.), event emission, phase advancement, diagnostics collection, and truncation detection. Each tool type has its own parsing branch with duplicated error handling.
**Impact**: Adding support for a new tool type requires modifying this massive function. The parsing logic for each tool is interleaved with orchestration logic, making both hard to test.
**Remediation**: Extract per-tool parsers into a `src/hooks/tool-parsers/` directory with a common interface. The tracking hook becomes a dispatcher that routes to the appropriate parser.

---

## High Issues (18)

### H-01: Race Condition in `event-hook.ts` Finalization

**File**: `src/hooks/event-hook.ts` (lines 278–284)
**Description**: The finalization sequence reads events, materializes findings, and updates the run index — but these operations are not atomic. If the process is interrupted between materialization and index update, the run index will be stale while findings are already written.
**Impact**: Orphaned findings or missing run index entries after crashes.
**Remediation**: Write a completion marker atomically after all finalization steps succeed. On startup, detect incomplete finalizations and replay.

---

### H-02: Fire-and-Forget Git Clone in `config-handler.ts`

**File**: `src/hooks/config-handler.ts`
**Description**: The Trail of Bits building-secure-contracts repository is cloned via `Bun.spawn` without awaiting completion or checking the exit code. The clone result is never verified.
**Impact**: If the clone fails (network error, disk full, permissions), downstream pattern checking silently operates on stale or missing data. No error is surfaced to the user.
**Remediation**: Await the clone, check exit code, and surface errors. Cache the result with a TTL.

---

### H-03: Silent Error Swallowing — 5+ Locations

**Files**:
- `src/hooks/knowledge-sync-hook.ts` — catches and logs at debug level
- `src/tools/pattern-checker-tool.ts` — catches parse errors, continues with partial data
- `src/tools/pattern-loader.ts` — catches file read errors, returns empty array
- `src/shared/file-utils.ts` — `safeParseJson` returns `null` on any error
- `src/features/persistent-state/audit-state-manager.ts` — catches state read errors, returns default

**Description**: Errors are caught, logged at debug/warn level (or not at all), and execution continues with default/empty values. The caller has no way to know that critical data was lost.
**Impact**: Audit operates on incomplete data without any indication. Findings may be silently dropped, patterns may not be checked, and the final report may be incomplete.
**Remediation**: Distinguish between recoverable errors (file not found → default) and unrecoverable errors (parse failure → escalate). Use structured error types. Surface data-loss events in the audit report.

---

### H-04: Unsafe File Operations in `scvd-index.ts`

**File**: `src/knowledge/scvd-index.ts`
**Description**: Temporary files are created with non-unique paths (no random suffix). Additionally, the file mixes synchronous (`writeFileSync`, `readFileSync`) and asynchronous (`Bun.write`) file operations, creating potential race conditions when multiple instances run.
**Impact**: Concurrent audit runs could overwrite each other's temp files. Mixed sync/async could lead to reading partially-written files.
**Remediation**: Use `crypto.randomUUID()` for temp file names. Standardize on async file operations throughout.

---

### H-05: Reporting Gate Is Advisory-Only

**File**: `src/hooks/system-prompt-hook.ts`
**Description**: The system prompt instructs the LLM agent not to generate reports until all analysis phases are complete, but this is enforced only via prompt text — not programmatically. The agent can (and does) sometimes generate reports prematurely.
**Impact**: Incomplete audit reports that miss findings from later analysis phases.
**Remediation**: Implement a programmatic gate in `report-generator-tool.ts` that checks phase completion status from the audit state before allowing report generation.

---

### H-06: Event Sink Mutex Has No Timeout

**File**: `src/features/persistent-state/event-sink.ts`
**Description**: The mutex protecting event writes uses `await` without a timeout. If the lock is never released (e.g., due to an uncaught exception in the critical section), all subsequent event writes will hang indefinitely.
**Impact**: Silent deadlock of the event persistence layer.
**Remediation**: Add a timeout (e.g., 30 seconds) to the mutex acquisition. If timeout expires, log an error, force-release the lock, and continue.

---

### H-07: Weak Finding ID Generation

**File**: `src/state/finding-store.ts`
**Description**: Finding IDs are generated using a simple counter (`finding-{n}`). The counter is not persisted — it resets to 0 on each session. If findings from multiple sessions are aggregated, IDs will collide.
**Impact**: Finding deduplication and cross-session tracking are broken. Two different findings can have the same ID.
**Remediation**: Use content-based hashing (file + line + description) or `crypto.randomUUID()` for finding IDs.

---

### H-08: `report-generator-tool.ts` — 1,400+ Lines with Duplicate Parsers

**File**: `src/tools/report-generator-tool.ts` (~1,400 lines)
**Description**: The report generator contains its own JSON parsing, finding normalization, and severity classification logic — duplicating functionality already in `schemas.ts`, `adapters.ts`, and `projectors.ts`. The file also contains 3 separate functions for parsing tool output that differ only in minor details.
**Impact**: Report generation may classify findings differently than the state management layer. Changes to finding format must be synchronized across both codepaths.
**Remediation**: Have the report generator consume the canonical finding projections from the state layer instead of re-parsing raw data.

---

### H-09: `global-run-index.ts` Uses `appendFileSync` in Async Functions

**File**: `src/features/persistent-state/global-run-index.ts`
**Description**: The run index uses `appendFileSync` (blocking I/O) inside `async` functions. This blocks the event loop during file writes.
**Impact**: Performance degradation during audit runs, especially on slow disks. Can cause timeout issues in other concurrent operations.
**Remediation**: Replace `appendFileSync` with `await Bun.write()` using append mode.

---

### H-10: No Input Validation on Tool Parameters

**Files**: Multiple tool files in `src/tools/`
**Description**: Several tools accept file paths and other parameters from the LLM agent without validation beyond Zod schema parsing. Path traversal (e.g., `../../etc/passwd`) is not explicitly blocked.
**Impact**: A malicious or confused LLM agent could read/write files outside the project directory.
**Remediation**: Add path validation that resolves and checks that the target is within the project root.

---

### H-11: Solodit MCP Process Lifecycle — 6 Mutable Global Variables

**File**: `src/solodit-lifecycle.ts` (314 lines)
**Description**: The Solodit MCP client lifecycle is managed via 6 module-level mutable variables (`process`, `client`, `transport`, `isConnecting`, `connectionPromise`, `lastError`). State transitions are implicitly managed through mutation rather than an explicit state machine.
**Impact**: Difficult to reason about process state. Concurrent calls to `connect()` and `disconnect()` can leave the lifecycle in inconsistent states.
**Remediation**: Refactor into a class with explicit states (Disconnected → Connecting → Connected → Disconnecting) and validate transitions.

---

### H-12: Pattern Loader Returns Empty Array on Failure

**File**: `src/tools/pattern-loader.ts`
**Description**: When pattern files fail to parse (malformed YAML, missing fields), the loader returns an empty array instead of reporting which patterns failed to load.
**Impact**: The audit silently skips security patterns. The user has no way to know that pattern checking is incomplete.
**Remediation**: Return a result object with both loaded patterns and error details. Surface errors in the audit output.

---

### H-13: Hardcoded Agent Names in 3+ Places

**Files**:
- `src/hooks/agent-tracker.ts`
- `src/create-hooks.ts`
- `src/hooks/system-prompt-hook.ts`

**Description**: Agent names (`"argus"`, `"sentinel"`, `"pythia"`, `"scribe"`) are hardcoded as string literals in multiple files instead of referencing a shared constant or enum.
**Impact**: Renaming an agent requires a manual grep-and-replace across the codebase. Typos cause silent failures.
**Remediation**: Define agent names as a const enum or object in `src/agents/constants.ts` and import everywhere.

---

### H-14: `contract-analyzer-tool.ts` Constructs AST Manually

**File**: `src/tools/contract-analyzer-tool.ts`
**Description**: The contract analyzer builds its own simplified AST from Solidity source by regex-matching function signatures, modifiers, and state variables. This duplicates (poorly) what Slither already provides.
**Impact**: The regex-based parser misses edge cases (multi-line signatures, comments containing function-like patterns, assembly blocks). Results are unreliable for complex contracts.
**Remediation**: Use Slither's AST output (already available from `slither-tool.ts`) instead of re-parsing source code.

---

### H-15: `retry.ts` Exponential Backoff Lacks Jitter

**File**: `src/knowledge/retry.ts`
**Description**: The retry utility uses pure exponential backoff (`delay * 2^attempt`) without jitter. When multiple concurrent operations fail simultaneously, they all retry at the same time, creating thundering herd effects.
**Impact**: Cascading failures under load. All retries hit the backend simultaneously.
**Remediation**: Add randomized jitter: `delay * 2^attempt * (0.5 + Math.random() * 0.5)`.

---

### H-16: `deep-merge.ts` Handles Circular References via Exception

**File**: `src/shared/deep-merge.ts`
**Description**: The deep merge utility detects circular references by catching the `Maximum call stack size exceeded` error rather than tracking visited objects.
**Impact**: Stack overflow is caught but is extremely expensive. In V8/JSC, this can trigger garbage collection and deoptimization. If the stack size changes between runtimes, the behavior changes.
**Remediation**: Use a `WeakSet` to track visited objects and detect cycles before recursing.

---

### H-17: Migration Code Has No Sunset Date

**File**: `src/features/migration/migration-adapter.ts`
**Description**: Migration code that converts old audit state formats to the new event-sourced format has no expiration mechanism. The migration logic will run (and add overhead) on every state load indefinitely.
**Impact**: Permanent runtime overhead. The migration code becomes a maintenance burden that can never be safely removed because there's no way to know if old-format states still exist.
**Remediation**: Add a version check: if all states are already in the new format, skip migration. Add a deprecation date after which old formats are rejected with an error message.

---

### H-18: Parity Telemetry Appears Unused

**File**: `src/features/migration/parity-telemetry.ts`
**Description**: This module defines telemetry collection for migration parity checking, but no code imports or calls it. It appears to be dead code.
**Impact**: Maintenance burden with no value. Developers may waste time understanding or updating code that isn't executed.
**Remediation**: Verify it's truly unused (grep for imports). If confirmed, delete it.

---

## Medium Issues (32)

### M-01: `findSkillFiles()` Duplicated Across 4 CLI Commands

**Files**:
- `src/cli/commands/doctor.ts`
- `src/cli/commands/init.ts`
- `src/cli/commands/install.ts`
- `src/cli/commands/list-skills.ts`

**Description**: Each CLI command independently implements skill file discovery logic (glob patterns, directory traversal, filtering).
**Remediation**: Extract to `src/cli/shared/skill-discovery.ts`.

---

### M-02: `STOPWORDS` Set Duplicated

**Files**:
- `src/skills/analysis/normalize.ts`
- `src/skills/analysis/cluster.ts`

**Description**: A 109-entry stopwords set is defined identically in both files.
**Remediation**: Define once in a shared module and import.

---

### M-03: Severity Counting Logic Duplicated in 4 Files

**Files**:
- `src/state/projectors.ts`
- `src/state/finding-aggregation.ts`
- `src/tools/report-generator-tool.ts`
- `src/hooks/tool-tracking-hook.ts`

**Description**: Each file independently counts findings by severity using slightly different approaches (some use `reduce`, some use `filter().length`).
**Remediation**: Add a `countBySeverity(findings)` function to the state layer.

---

### M-04: Overengineered `AdapterResult<T>` + `Diagnostic[]` Pattern

**Files**: `src/state/adapters.ts`, `src/state/projectors.ts`
**Description**: Every adapter/projector returns `{ value: T, diagnostics: Diagnostic[] }`. Diagnostics are meticulously collected but never consumed by any caller — they're discarded immediately after destructuring.
**Impact**: Unnecessary complexity. Every call site must destructure a tuple it doesn't use.
**Remediation**: Either consume diagnostics (log them, surface in reports) or remove the pattern and return `T` directly.

---

### M-05: Missing Test Coverage for Critical State Modules

**Files**:
- `src/state/projectors.ts` — ~83% of projector functions untested
- `src/state/adapters.ts` — Adapter error paths untested
- `src/state/finding-aggregation.ts` — No test file exists
- `src/state/finding-fingerprint.ts` — No test file exists

**Impact**: State layer bugs won't be caught by CI. These modules handle finding normalization and deduplication — errors here directly affect audit accuracy.

---

### M-06: Fragile Regex-Based TOML Parsing

**File**: `src/tools/project-detector.ts`
**Description**: The project detector parses `foundry.toml` using regex patterns instead of a proper TOML parser. Patterns like `/src\s*=\s*"([^"]*)"` break on comments, multi-line values, and quoted strings containing escaped characters.
**Remediation**: Use a TOML parsing library (e.g., `@iarna/toml` or `smol-toml`).

---

### M-07: Config Schema Doesn't Reject Unknown Keys

**File**: `src/config/schema.ts`
**Description**: The Zod schema uses `.object()` without `.strict()`, allowing any extra keys to pass validation silently. Typos in config keys (e.g., `disbled_hooks` instead of `disabled_hooks`) are silently ignored.
**Remediation**: Add `.strict()` to the config schema, or at minimum `.passthrough()` with a warning log for unknown keys.

---

### M-08: Duplicated Default Config Values

**Files**:
- `src/config/schema.ts` — defaults in Zod schema
- `src/config/loader.ts` — defaults in merge logic
- Various tool files — inline defaults

**Description**: Default values for configuration options are defined in multiple places. If defaults change, they must be updated in all locations.
**Remediation**: Single source of truth for defaults in the Zod schema. All other code reads from the parsed config.

---

### M-09: `stdout/stderr` Suppression Pattern in `index.ts`

**File**: `src/index.ts`
**Description**: The plugin entry point suppresses stdout/stderr by replacing `process.stdout.write` and `process.stderr.write` with no-ops. This is a blunt instrument that affects all libraries loaded in the same process.
**Impact**: Makes debugging extremely difficult. Library warnings and errors are silently swallowed.
**Remediation**: Use a scoped logging approach instead of global suppression. Or, if suppression is truly needed, restore the original writers after initialization.

---

### M-10: `safe-create-hook.ts` Wraps All Hook Errors Uniformly

**File**: `src/hooks/safe-create-hook.ts`
**Description**: Every hook is wrapped in a try-catch that logs the error and returns a no-op result. This means any hook failure — including critical ones like state persistence — is silently swallowed.
**Impact**: Critical hook failures (state corruption, finding loss) are treated the same as cosmetic failures (logging, telemetry).
**Remediation**: Categorize hooks as critical vs. non-critical. Critical hook failures should propagate. Non-critical hook failures can be swallowed with warnings.

---

### M-11: `compaction-hook.ts` Uses Magic Numbers

**File**: `src/hooks/compaction-hook.ts`
**Description**: Compaction thresholds (event count, time intervals) are hardcoded as magic numbers throughout the file.
**Remediation**: Extract to named constants or config values.

---

### M-12: `context-budget.ts` Has Hardcoded Token Limits

**File**: `src/hooks/context-budget.ts`
**Description**: Token budget calculations use hardcoded values (e.g., `128000`, `0.8`) that should be configurable per model.
**Remediation**: Read token limits from config, keyed by model name.

---

### M-13: Error Recovery Tool Only Logs

**File**: `src/features/error-recovery/tool-error-recovery.ts`
**Description**: Despite its name, the "error recovery" module only logs errors and returns a formatted error message. It doesn't attempt any actual recovery (retry, fallback, alternative tool).
**Impact**: Misleading module name. Error "recovery" is just error formatting.
**Remediation**: Either implement actual recovery strategies or rename to `tool-error-formatter.ts`.

---

### M-14: `hook-system.ts` Allows Duplicate Hook Registration

**File**: `src/hooks/hook-system.ts`
**Description**: The hook system doesn't check for duplicate registrations. The same hook can be registered multiple times, causing it to fire multiple times per event.
**Impact**: Subtle double-processing bugs that are hard to diagnose.
**Remediation**: Check for duplicates on registration (by name or reference) and warn/reject.

---

### M-15: Mixed Import Styles

**Files**: Various across the codebase
**Description**: Some files use `import type { X }` while others use `import { type X }`. Some files import from index files while others import directly from source files.
**Impact**: Inconsistency, though functionally equivalent. Can confuse tree-shaking in some bundlers.
**Remediation**: Standardize via biome/eslint rules. Prefer `import type` for type-only imports.

---

### M-16: `run-pruner.ts` Has No Dry-Run Mode

**File**: `src/features/persistent-state/run-pruner.ts`
**Description**: The run pruner deletes old audit run data without a dry-run option. There's no way to preview what would be deleted before committing.
**Remediation**: Add a `dryRun` parameter that returns what would be pruned without deleting.

---

### M-17: `findings-materializer.ts` Re-reads Events Unnecessarily

**File**: `src/features/persistent-state/findings-materializer.ts`
**Description**: The materializer reads all events from disk, projects findings, and writes the result — even if no new events have been added since the last materialization.
**Remediation**: Track a high-water mark (last processed event ID) and only process new events.

---

### M-18: `run-journal.ts` Doesn't Validate Journal Entries

**File**: `src/features/persistent-state/run-journal.ts`
**Description**: Journal entries are appended without schema validation. Malformed entries can corrupt the journal and cause read failures.
**Remediation**: Validate entries against a Zod schema before appending.

---

### M-19: CLI Command Error Handling Is Inconsistent

**Files**: `src/cli/commands/*.ts`
**Description**: Some commands use try-catch with `process.exit(1)`, some throw and let the caller handle it, and some silently return on error.
**Remediation**: Standardize: commands throw, the CLI runner catches and exits with appropriate codes.

---

### M-20: `skill-loader.ts` Uses Dynamic `import()` Without Error Context

**File**: `src/skills/skill-loader.ts`
**Description**: Skills are loaded via `import()` but errors don't include which skill failed or why. The error message is the raw import error, which may reference internal module paths meaningless to the user.
**Remediation**: Wrap with context: `Failed to load skill '${name}' from '${path}': ${error.message}`.

---

### M-21: `normalize.ts` Lowercases Finding Titles

**File**: `src/skills/analysis/normalize.ts`
**Description**: Finding titles are lowercased during normalization. This destroys information — proper nouns, acronyms (ERC20, UUPS), and identifiers lose their casing.
**Remediation**: Normalize for comparison purposes only (create a separate comparison key), preserve original casing.

---

### M-22: `cluster.ts` Uses O(n²) Similarity Comparison

**File**: `src/skills/analysis/cluster.ts`
**Description**: Finding deduplication compares every finding against every other finding using string similarity, resulting in O(n²) complexity.
**Impact**: Acceptable for small finding sets (<100) but will become a bottleneck for large audits.
**Remediation**: Use bucketing by severity/category first to reduce comparison set, or use locality-sensitive hashing.

---

### M-23: Slither Tool Doesn't Validate Solc Version Format

**File**: `src/tools/slither-tool.ts`
**Description**: The `solc_version` parameter is passed directly to Slither without validating it's a valid semver version string.
**Remediation**: Validate against a semver regex before passing to Slither.

---

### M-24: `proxy-detection-tool.ts` Has Hardcoded Storage Slots

**File**: `src/tools/proxy-detection-tool.ts`
**Description**: ERC-1967 storage slot constants are hardcoded as hex strings without documentation of their derivation (keccak256 of specific strings minus 1).
**Remediation**: Add comments showing the derivation. Consider computing them at startup to verify correctness.

---

### M-25: Test Setup File at Root Level

**File**: `test-setup.ts` (project root)
**Description**: The test setup file is at the project root rather than in the `tests/` directory, breaking the otherwise clean directory structure.
**Remediation**: Move to `tests/setup.ts` and update `bunfig.toml` reference.

---

### M-26: `sync-knowledge-tool.ts` Downloads Without Integrity Check

**File**: `src/tools/sync-knowledge-tool.ts`
**Description**: Knowledge files are downloaded from remote sources without checksum verification. A MITM attack could inject malicious pattern definitions.
**Remediation**: Add SHA-256 checksums for known knowledge files and verify after download.

---

### M-27: Multiple Logger Implementations

**Files**:
- `src/shared/logger.ts` — custom logger
- Various files using `console.error` directly
- Some files using `Bun.stderr.write`

**Description**: Three different logging approaches are used across the codebase.
**Remediation**: Standardize on the custom logger. Replace all `console.error` and `Bun.stderr.write` calls.

---

### M-28: `argus-skill-load-tool.ts` Reads Files Without Size Limits

**File**: `src/tools/argus-skill-load-tool.ts`
**Description**: Skill files are read entirely into memory without checking file size. A maliciously large skill file could cause OOM.
**Remediation**: Add a file size check before reading (e.g., reject files > 1MB).

---

### M-29: TypeScript `strict` Mode Not Fully Leveraged

**File**: `tsconfig.json`
**Description**: While `strict: true` is enabled, some strict checks that would catch additional bugs (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) are not enabled.
**Remediation**: Enable `noUncheckedIndexedAccess` for safer array/object access patterns.

---

### M-30: No Graceful Shutdown Handling

**Files**: `src/solodit-lifecycle.ts`, `src/features/persistent-state/event-sink.ts`
**Description**: There's no `SIGTERM`/`SIGINT` handler to ensure pending events are flushed and the Solodit MCP process is cleanly terminated on shutdown.
**Impact**: Audit data loss on unexpected termination.
**Remediation**: Register signal handlers that flush pending events, close the Solodit connection, and finalize the run.

---

### M-31: `recon-context-builder.ts` Builds Redundant Context

**File**: `src/hooks/recon-context-builder.ts`
**Description**: The reconnaissance context builder includes information that's already available in the system prompt, resulting in redundant tokens in the LLM context.
**Remediation**: Deduplicate with system prompt content. Only include information not already in the prompt.

---

### M-32: Documentation Files in Root Are Accumulating

**Files**: `cc-findings.md`, `glm-production-findings.md`, `haep-susdve-assesment.md`, `kimi-production-findings.md`, `opus-assessment-v4.md`, `opus-h-production-readiness-assessment.md`, `argus-planning-prompt.md`
**Description**: Multiple assessment/findings files have accumulated in the project root, creating clutter.
**Remediation**: Move to a `docs/assessments/` directory or clean up old files.

---

## Low Issues (20+)

### L-01: Inconsistent Error Message Formatting
Various files use different error message formats — some prefix with the module name, some don't, some use template literals, some concatenate.

### L-02: Magic String `".argus"` Used as Directory Name
The `.argus` directory name is hardcoded in multiple places instead of being a constant.

### L-03: Some Test Files Use `test()` While Others Use `describe()/it()`
Inconsistent test structure across the test suite.

### L-04: `package.json` Has No `engines` Field
No minimum Node.js/Bun version is specified, risking incompatibility.

### L-05: Several `TODO` Comments in Production Code
Scattered `TODO` and `FIXME` comments without associated tracking issues.

### L-06: Unused Imports in Several Files
A few files import symbols that are never used (biome should catch these).

### L-07: Inconsistent File Naming Convention
Most files use kebab-case, but some utility functions break the pattern.

### L-08: `examples/` Directory Is Sparse
The examples directory has minimal content that doesn't showcase the full feature set.

### L-09: No JSDoc on Public API Functions
Exported functions in `src/index.ts` and `src/plugin-interface.ts` lack JSDoc comments.

### L-10: `CHANGELOG.md` Format Is Inconsistent
Some entries have dates, some don't. Some follow Keep-a-Changelog, some are free-form.

### L-11: `scripts/` Directory Has Undocumented Scripts
Scripts lack usage comments or documentation.

### L-12: `.gitmodules` References May Be Stale
Git submodule references should be verified as current.

### L-13: No Pre-commit Hooks Configured
No husky or lint-staged configuration to enforce code quality before commits.

### L-14: `dist/` Directory Is Tracked (or Present)
Build output appears to be present in the repository root.

### L-15: Test Coverage Threshold Not Configured
No minimum coverage threshold is enforced in CI.

### L-16: Some Zod Schemas Lack `.describe()` Annotations
Schema descriptions help with error messages and documentation generation.

### L-17: Import Path Aliases Not Used
Files use relative paths with deep nesting (`../../../shared/`) instead of path aliases.

### L-18: `biome.json` Could Enforce More Rules
Additional biome rules could catch more issues automatically.

### L-19: No Error Boundary in Plugin Entry Point
If the plugin throws during initialization, the host process may crash without a clear error.

### L-20: Missing `.editorconfig`
No `.editorconfig` file to standardize editor settings across contributors.

---

## Positive Observations

1. **Strong biome config**: `noExplicitAny: "error"` and `noNonNullAssertion: "error"` prevent common TypeScript anti-patterns.
2. **Clean module boundaries**: No circular dependencies detected. Clear separation between `tools/`, `hooks/`, `state/`, `features/`.
3. **Event-sourced audit state**: Architecturally sound approach for audit tracking. Enables replay, debugging, and auditability.
4. **Good test file coverage**: Nearly every module has a corresponding `.test.ts` file (though some are thin).
5. **Custom error classes**: Proper error hierarchy with `ArgusError`, `ConfigError`, etc.
6. **Agent-gated context injection**: The system prompt is dynamically constructed based on the active agent role, preventing context pollution.
7. **Plugin architecture**: Clean separation between plugin interface and implementation.
8. **Zod validation**: Consistent use of Zod for runtime validation at boundaries.

---

## Remediation Priority

### Immediate (Before Any Production Use)
1. **C-01**: Fix infinite loop in `audit-state-manager.ts`
2. **C-02**: Replace `new Function()` in `solodit-search-tool.ts`
3. **H-03**: Fix silent error swallowing (at least for critical paths)
4. **H-01**: Fix race condition in `event-hook.ts` finalization

### Before Launch
5. **C-03**: Extract shared forge command runner
6. **C-04**: Consolidate validation constants
7. **H-02**: Fix fire-and-forget git clone
8. **H-06**: Add timeout to event sink mutex
9. **H-07**: Fix weak finding ID generation
10. **H-10**: Add path validation to tool parameters
11. **M-07**: Add `.strict()` to config schema

### Next Sprint
12. **C-05**: Break up `create-hooks.ts`
13. **C-06**: Break up `tool-tracking-hook.ts`
14. **H-08**: Refactor `report-generator-tool.ts`
15. **H-05**: Implement programmatic reporting gate
16. **M-05**: Add missing test coverage
17. **M-06**: Replace regex TOML parsing

### Ongoing
18. Address remaining Medium and Low issues as part of regular development
19. Establish code review guidelines based on patterns found
20. Set up CI gates for test coverage and lint compliance
