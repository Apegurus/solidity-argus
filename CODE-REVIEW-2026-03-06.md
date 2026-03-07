# Solidity Auditor Codebase Review

**Date:** 2026-03-06
**Reviewer:** Claude Opus 4.6
**Branch:** staging
**Scope:** Full codebase (~80 source files, ~4,500 LOC + tests)

---

## Executive Summary

This is a substantial Claude Code plugin for automated Solidity security auditing. It orchestrates multiple AI agents (Argus, Sentinel, Pythia, Scribe), integrates external tools (Slither, Forge), and manages persistent audit state via event sourcing. The architecture is ambitious and well-structured, but has **critical issues** that must be resolved before production deployment.

**Overall Score: 6/10** — Strong foundations, but concurrency bugs, security gaps, and extensive code duplication create real risk.

---

## Table of Contents

1. [Critical — Fix Before Any Production Use](#1-critical--fix-before-any-production-use)
2. [High — Fix Before Beta/Staging](#2-high--fix-before-betastaging)
3. [Medium — DRY Violations & Code Duplication](#3-medium--dry-violations--code-duplication)
4. [Medium — KISS Violations / Over-Engineering](#4-medium--kiss-violations--over-engineering)
5. [Medium — Hidden Bugs](#5-medium--hidden-bugs)
6. [Low — Code Smells & Inconsistencies](#6-low--code-smells--inconsistencies)
7. [Test Quality Assessment](#7-test-quality-assessment)
8. [Architectural Observations](#8-architectural-observations)
9. [Priority Matrix](#9-priority-matrix)

---

## 1. Critical — Fix Before Any Production Use

### 1.1 Remote Code Execution via `new Function()`

**File:** `src/tools/solodit-search-tool.ts:366`
**Severity:** CRITICAL

The Solodit search tool parses API responses using dynamic code execution:

```typescript
const fn = new Function(`return ${dataStr}`) as () => unknown
```

`dataStr` comes from an external API response. If the Solodit API is compromised or a MITM attack modifies the response, this allows arbitrary code execution on the user's machine.

**Fix:** Replace with `JSON.parse()` or a safe parsing alternative.

---

### 1.2 Race Condition in State Persistence

**File:** `src/features/persistent-state/audit-state-manager.ts:360-402`
**Severity:** CRITICAL

The `saveInFlight` boolean flag has no locking:

```typescript
if (saveInFlight) return  // Line 365
saveInFlight = true       // Line 366
```

Two concurrent `save()` calls can both pass the check before either sets it `true`, leading to parallel state derivation and file writes. While the atomic rename at line 393 prevents data corruption at the file level, the loop logic at lines 369-396 could produce inconsistent snapshots.

**Fix:** Replace with a proper promise-based queue (similar to the mutex pattern already used in `event-sink.ts`).

---

### 1.3 Lost Updates in Debounced Save

**File:** `src/features/persistent-state/audit-state-manager.ts:113-160`
**Severity:** CRITICAL

The debounce implementation overwrites `pendingState` on each call:

```typescript
save(state: AuditState): void {
  pendingState = state       // Overwrites any previous pending state
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    void persistPendingState()
  }, delayMs)
}
```

**Scenario:**
- T0: `save(state1)` queued (contains new finding)
- T5ms: `save(state2)` overwrites `pendingState`, timer reset
- T100ms: Only `state2` is persisted, `state1` is lost

If these represent different findings or phase changes, intermediate audit state is permanently dropped.

**Fix:** Queue states or use a version stamp to detect and merge intermediate updates.

---

### 1.4 Non-Deterministic Finding IDs

**File:** `src/state/finding-store.ts:27-33`
**Severity:** CRITICAL

The observation ID generator uses a mutable counter:

```typescript
let observationCounter = state.findings.length

function generateObservationId(check, file, lines) {
  const key = `${check}:${file}:${lines[0]}-${lines[1]}:${observationCounter}`
  observationCounter += 1  // Mutates closure
  return createHash("sha256").update(key).digest("hex").substring(0, 16)
}
```

If `addFinding()` is called with the same finding twice (e.g., after error recovery), IDs will differ because the counter has advanced. This breaks deduplication entirely.

**Fix:** Make ID generation deterministic based solely on finding content, not invocation order.

---

### 1.5 Silent Config Discard on Validation Error

**File:** `src/config/loader.ts:16-19`
**Severity:** CRITICAL

When config validation fails, the entire user configuration is silently replaced with defaults:

```typescript
const result = ArgusConfigSchema.safeParse(merged)
if (!result.success) {
  logger.warn("Invalid argus config, using defaults:", result.error.message)
  return ArgusConfigSchema.parse({})  // ALL user config discarded
}
```

A single typo in one field silently wipes API keys, tool paths, severity thresholds, and all custom settings. The warning is only emitted at debug level (depends on `ARGUS_LOG` env var).

**Fix:** Use partial validation — apply defaults only for invalid fields, keep valid ones. At minimum, log at WARN level unconditionally.

---

## 2. High — Fix Before Beta/Staging

### 2.1 Command Injection in Slither Tool

**File:** `src/tools/slither-tool.ts:348-351`
**Severity:** HIGH

`solcVersion` from user input is passed directly into the command array:

```typescript
const command = ["slither", flatFile, "--json", "-", "--solc-solcs-select", solcVersion]
```

While `Bun.spawn` uses array form (not shell execution), crafted version strings could still cause unexpected behavior with the `--solc-solcs-select` flag. No validation or sanitization is applied.

**Fix:** Validate `solcVersion` against a regex like `/^\d+\.\d+\.\d+$/` before use.

---

### 2.2 Concurrent State Mutation Without Locks

**File:** `src/create-hooks.ts:198-447`
**Severity:** HIGH

Multiple async sub-handlers mutate `auditState` concurrently:
- Line 225-226: Event handler A updates state
- Line 514-516: Tool tracking saves state
- Line 346: Another handler saves state

No mutex or transactional guarantee exists. If save completes between mutations from concurrent tool executions, intermediate state is persisted.

**Fix:** Introduce a state mutation queue or single-writer pattern.

---

### 2.3 Finalization Flag Not Persisted

**File:** `src/features/persistent-state/event-sink.ts:143`
**Severity:** HIGH

The `finalized` flag is in-memory only:

```typescript
const sinkState = { finalized: false }  // In-memory only
```

After process restart, a finalized run's event sink can accept new events, corrupting a completed audit. Tests at lines 247-260 don't verify this scenario across sink recreation.

**Fix:** Persist finalization status to disk alongside the journal.

---

### 2.4 Path Traversal in Artifact Resolver

**File:** `src/shared/audit-artifact-resolver.ts:43-48`
**Severity:** HIGH

Validates that `runId` is non-empty but doesn't check for path traversal:

```typescript
if (!runId || runId.trim() === "") {
  throw new ArtifactResolverError("runId must not be empty")
}
```

A `runId` like `../../etc/passwd` would create paths outside the `.argus` directory.

**Fix:** Reject runIds containing `/`, `\`, or `..`.

---

### 2.5 Memory Leak — Unbounded EventSink Maps

**File:** `src/create-hooks.ts:187-188`
**Severity:** HIGH

Two maps grow indefinitely with no cleanup mechanism:

```typescript
const eventSinksByOpencodeSession = new Map<string, EventSink>()
const eventSinksByRunId = new Map<string, EventSink>()
```

No TTL, no size limit, no idle cleanup. Long-running OpenCode instances will leak memory proportional to the number of audit sessions.

**Fix:** Add TTL-based eviction or cleanup on session deletion.

---

### 2.6 No Plugin Teardown/Cleanup

**File:** `src/index.ts`
**Severity:** HIGH

The plugin exports no shutdown handler. When OpenCode unloads the plugin:
- Event sinks remain open
- Background manager tasks continue running
- Logger file handles leak
- Solodit child processes (`solodit-lifecycle.ts`) are orphaned

**Fix:** Export a `cleanup()` or `dispose()` function and register it with OpenCode's lifecycle.

---

### 2.7 Inverted Log Levels

**File:** `src/shared/drop-diagnostics.ts:78-81`
**Severity:** HIGH

Error diagnostics are logged as WARN, warnings as INFO:

```typescript
if (level === "error") {
  logger.warn(logMsg)   // ERROR -> WARN (wrong!)
} else {
  logger.info(logMsg)   // WARN -> INFO (wrong!)
}
```

Production log filters for ERROR level would miss actual errors.

**Fix:** Map error to `logger.error()` and warn to `logger.warn()`.

---

### 2.8 Event Sink Fallback Logic Bug

**File:** `src/hooks/event-hook.ts:83-97`
**Severity:** HIGH

Session state fallback is inconsistent:

```typescript
return statesBySessionId.size === 0 ? fallbackAuditState : null
```

When the first session is created, `statesBySessionId.size > 0`. A second session calling `getAuditState(undefined)` gets `null` instead of fallback, creating inconsistent behavior across multi-session audits.

---

### 2.9 No Timeout on Background Tasks

**File:** `src/features/background-agent/background-manager.ts:89-116`
**Severity:** HIGH

Dispatcher promises have no timeout. A hanging task permanently blocks its concurrency slot (`runningCount` never decrements), eventually deadlocking the entire background queue.

**Fix:** Wrap dispatcher calls with `Promise.race([dispatcher(...), timeout(ms)])`.

---

## 3. Medium — DRY Violations & Code Duplication

### 3.1 `isRecord()` Helper — 5 Independent Copies

The same type guard is independently defined in:
- `src/state/projectors.ts:43`
- `src/state/adapters.ts:90`
- `src/state/schemas.ts:173`
- `src/features/persistent-state/audit-state-manager.ts:28`
- `src/features/persistent-state/run-finalizer.ts:79`

All five are identical implementations. Extract to `src/shared/type-guards.ts`.

---

### 3.2 `SEVERITY_RANK` — 3 Independent Copies

Identical severity ranking objects defined in:
- `src/state/projectors.ts:35-41`
- `src/state/finding-aggregation.ts:3-9`
- `src/state/adapters.ts:19-25`

If one is updated and the others aren't, severity sorting silently diverges.

---

### 3.3 Validation Constants — 4 Copies

`VALID_SEVERITIES`, `VALID_SOURCES`, `VALID_AGENTS` are duplicated across:
- `src/state/schemas.ts:145-171`
- `src/state/adapters.ts:19-45`

With slightly different names (`VALID_AGENTS` vs `VALID_REPORTED_AGENTS`).

---

### 3.4 Forge/Slither Command Runner — 5 Copies

Nearly identical `Bun.spawn()` wrappers in:
- `src/tools/forge-coverage-tool.ts:141-160`
- `src/tools/forge-fuzz-tool.ts:180-200`
- `src/tools/forge-test-tool.ts:314-333`
- `src/tools/gas-analysis-tool.ts:164-183`
- `src/tools/slither-tool.ts:182-201`

All handle spawn, stdout/stderr collection, exit code checking. Should be a single `runExternalTool()` utility.

---

### 3.5 Token Estimation — 2 Copies

`Math.ceil(text.length / 4)` duplicated in:
- `src/hooks/system-prompt-hook.ts:50-52`
- `src/features/context-monitor/context-monitor.ts:16-18`

---

### 3.6 Stopword Sets — Verbatim 160-Line Duplication

160+ line stopword arrays duplicated between:
- `src/skills/analysis/cluster.ts:52-160`
- `src/skills/analysis/normalize.ts:14-122`

Extract to `src/skills/analysis/stopwords.ts`.

---

### 3.7 Schema Defaults — Doubled

`src/config/schema.ts` defines `.default()` on nested Zod schemas AND on parent schemas with the same values. For example, the SCVD API URL `"https://api.scvd.dev"` appears in both the `ScvdConfigSchema.default()` and the parent `KnowledgeConfigSchema.default()`.

---

### 3.8 Severity Distribution Computation — 3 Copies

Nearly identical severity counting loops in:
- `src/features/migration/parity-telemetry.ts:36-52`
- `src/hooks/compaction-hook.ts:15-25`
- `src/hooks/system-prompt-hook.ts:59-69`

---

### 3.9 Materialization Call Pattern — 3 Copies

`materializeFindingsForRun` is called with similar try-catch patterns in:
- `src/create-hooks.ts:599-602` (event hook sub-handler)
- `src/create-hooks.ts:633-638` (session deleted event)
- `src/create-hooks.ts:752-758` (report generation after)

---

## 4. Medium — KISS Violations / Over-Engineering

### 4.1 Three-Layer Session-to-Sink Mapping

`eventSinksByOpencodeSession`, `eventSinksByRunId` (create-hooks.ts:187-188), and `sinksBySessionId` (event-hook.ts) create a 7-level nested fallback chain with side effects (cache population inside getter lambdas at lines 535-554). This is the primary source of event routing complexity and bugs.

**Recommendation:** Consolidate into a single `SessionRegistry` class with explicit lookup semantics.

---

### 4.2 Over-Parameterized Tool Tracking

`createToolTrackingHook` (tool-tracking-hook.ts:520-524) accepts 6+ optional callbacks via `ToolTrackingOptions`. Most callers in `create-hooks.ts:527-555` provide nearly all of them. This creates unnecessary indirection.

---

### 4.3 Two-Pass JSONC Parser

`src/shared/jsonc-parser.ts:1-134` processes the string twice (strip comments in pass 1, strip trailing commas in pass 2). Variables like `inString` vs `inString2` and `escaped` vs `escaped2` indicate copy-paste. Could be a single pass.

---

### 4.4 DeepMerge Array Deduplication

`src/shared/deep-merge.ts:1-36` uses WeakMap + JSON.stringify + unbounded counter for array deduplication during config merging. Config objects don't need array deduplication. This adds complexity and a minor memory leak (global counter never resets).

---

### 4.5 Unnecessary Abstraction in run-finalizer.ts

`asRecord()` helper at lines 79-84 duplicates the `isRecord()` check that already exists in 5 other files. Adds 6 lines to do what a shared type guard already does.

---

### 4.6 Over-Specified Pruner Options

`pruneStaleRuns()` in `run-pruner.ts` accepts excessive options (`staleTtlMs`, `finalizedRetentionMs`, `dryRun`, `resolver`). For most calls, only `projectDir` is needed.

---

## 5. Medium — Hidden Bugs

### 5.1 `auditStateGetter` Used Before Assigned

**File:** `src/create-hooks.ts:181, 458`

`toolErrorRecoveryHandler` captures `auditStateGetter` in its closure at line 181, but it's not assigned until line 458. Early tool errors between these lines will call `undefined()`, crashing.

---

### 5.2 Event Ordering Non-Determinism

**File:** `src/features/persistent-state/event-sink.ts:88-95`

Events with identical timestamps are tie-broken by `seq`, but seq values from different writers can overlap across isolated sessions, making sort order non-deterministic.

---

### 5.3 Context Budget Not Enforced for Dynamic Content

**File:** `src/hooks/system-prompt-hook.ts:144-151`

Dynamic context is always pushed to the system prompt without checking the token budget. Only the recon block respects the budget. Large audit states can blow the context window.

---

### 5.4 Fire-and-Forget Project Detection

**File:** `src/create-hooks.ts:487-493`

`detectProject()` runs as a fire-and-forget promise with silent error suppression. The system prompt hook uses `reconProjectConfig` immediately, but detection may not have completed. In slow environments, audit context is missing critical project metadata.

---

### 5.5 Orphan Sink Cleanup Deletes Active Sinks

**File:** `src/create-hooks.ts:662-669`

Cleanup logic assumes all active runs are tracked in `eventSinksByOpencodeSession`. But sinks can exist in `eventSinksByRunId` without a corresponding session (e.g., if an OpenCode session crashes). Deleting these sinks orphans the run data.

---

### 5.6 Sink Run ID Mismatch Silently Drops Events

**File:** `src/hooks/tool-tracking-hook.ts:561-572`

When the sink's `runId` doesn't match the state's `runId`, events are silently discarded (`sink = null`). No retry, no fallback emission, no user notification.

---

### 5.7 Git Clone Fire-and-Forget in Config Handler

**File:** `src/hooks/config-handler.ts:37-66`

Git clone is spawned without await. If the module is unloaded before the promise resolves, the promise may be lost. `tobCloneInFlight` can persist indefinitely if the process crashes. No max retry logic.

---

### 5.8 Solodit Magic Numbers in tRPC Input

**File:** `src/tools/solodit-search-tool.ts:248-289`

Completely opaque magic number array used in `buildTrpcInput()`:

```typescript
[7, 8, 9], [{ label: 11, value: 12 }, "1", "100", 1, true, ...]
```

No comments explaining what each index means. This is unmaintainable and will break silently if the API changes.

---

### 5.9 Incomplete Tool Fallback Registry

**File:** `src/features/error-recovery/tool-error-recovery.ts:9-30`

`TOOL_FALLBACKS` is missing entries for:
- `argus_analyze_contract`
- `argus_proxy_detection`
- `argus_forge_coverage`
- `argus_gas_analysis`

If these tools fail, no recovery hint is provided.

---

## 6. Low — Code Smells & Inconsistencies

### 6.1 Inconsistent Error Handling Strategy

- `event-sink.ts`: Throws `EventSinkError`
- `audit-state-manager.ts`: Swallows errors or returns null
- `run-finalizer.ts`: Returns errors in result object
- `run-journal.ts`: Silent failures
- `run-pruner.ts`: Returns errors in result array

No consistent error strategy across the codebase.

---

### 6.2 Dead Debug Parameter in Logger

**File:** `src/shared/logger.ts:90-93`

Every `createLogger()` call uses no config, so `debug` is always `false`. The `debug` parameter in `LoggerConfig` is dead code — users cannot enable debug logging without code changes.

---

### 6.3 Stdout/Stderr Hijacking During Init

**File:** `src/index.ts:16-20, 54-57`

Process stdout/stderr are suppressed during entire plugin initialization. If `startSoloditMcp` hangs, output remains suppressed. Should suppress only around the specific noisy operation.

---

### 6.4 Fragile Plugin Version Resolution

**File:** `src/shared/plugin-metadata.ts:5-21`

Assumes `../../package.json` relative path from `import.meta.url`. Fragile during bundling. Silent fallback to `"unknown"` with no logging.

---

### 6.5 Hardcoded External URLs

URLs like `https://api.scvd.dev` and `https://solodit.cyfrin.io` appear in multiple files without centralized configuration:
- `src/config/schema.ts`
- `src/cli/commands/doctor.ts:285, 300`
- `src/tools/solodit-search-tool.ts:13, 60`
- `src/tools/sync-knowledge-tool.ts:32`

---

### 6.6 Missing Timeout in Forge Tools

`forge-fuzz-tool.ts`, `forge-coverage-tool.ts`, `forge-test-tool.ts` — No timeout on external process execution. Fuzz runs with 10,000 iterations could hang indefinitely. Only `slither-tool.ts` properly uses `AbortSignal.timeout(30_000)`.

---

### 6.7 Silent Error Swallowing in Event Sink

**File:** `src/features/persistent-state/event-sink.ts:84-85`

Malformed journal lines are silently skipped during parsing. No logging of corruption. Could hide data integrity issues.

---

### 6.8 Insufficient Error Context in Messages

Most error messages lack run ID or session ID:
- `event-sink.ts:206`: `"Failed to write event to journal: ${String(err)}"`
- `audit-state-manager.ts:398`: `"Failed to persist audit state"`

Makes production debugging difficult.

---

### 6.9 `report-path-resolver.ts` — Empty Sanitization Result

**File:** `src/shared/report-path-resolver.ts:39-45`

`sanitizeContractName()` removes special characters but doesn't validate the result is non-empty. A contract named `"!!!"` becomes `""`.

---

### 6.10 Exported Mutable Global in Solodit Lifecycle

**File:** `src/solodit-lifecycle.ts:20-28`

```typescript
export let soloditAvailable = false  // Exported mutable global
```

External code can mutate this directly, bypassing lifecycle logic. Should be a getter function.

---

### 6.11 No Symlink Validation in File Operations

`src/tools/proxy-detection-tool.ts:175-176` and `src/tools/pattern-checker-tool.ts:178-220` read files without symlink validation. Symlinks pointing outside the intended scope could read arbitrary files.

---

### 6.12 Magic String `"argus_"` in Multiple Places

Used as tool prefix check in:
- `src/hooks/tool-tracking-hook.ts:606`
- `src/create-hooks.ts:709`
- `src/features/error-recovery/tool-error-recovery.ts:52`

Should be a named constant: `const ARGUS_TOOL_PREFIX = "argus_"`.

---

### 6.13 Stale State TTL Hardcoded in Handler

**File:** `src/create-hooks.ts:277`

```typescript
const STALE_STATE_TTL_MS = 24 * 60 * 60 * 1000
```

Buried in handler code. Should be in `constants/defaults.ts`. Not configurable. If an audit runs 23+ hours, state may be incorrectly discarded on next session.

---

### 6.14 Noop Background Dispatcher Generates Fake Task IDs

**File:** `src/create-managers.ts:15-23`

When background dispatcher is not wired, fallback generates fake task IDs (`noop-${Date.now()}`). Downstream code expecting real task IDs could silently malfunction. Multi-agent orchestration fails without user notification.

---

## 7. Test Quality Assessment

**Score: 7/10** — Good integration coverage, weak error path coverage.

### Strengths

- **Determinism testing** is excellent — byte-identical replay verified across 10 runs (`determinism-replay.test.ts`)
- **Real fixture project** with actual Solidity code (`tests/fixtures/vulnerable-vault/`)
- **Pipeline integration tests** cover full event -> materialization -> report flow (`canonical-report-pipeline.test.ts`)
- **Regression tests** for 5+ specific production bugs (`pipeline-fixes-e2e.test.ts`)
- **Event lifecycle** well-tested (`full-audit-pipeline.test.ts`)

### Critical Gaps

| Gap | Impact |
|-----|--------|
| `smoke.test.ts` is `expect(true).toBe(true)` | Zero value, false sense of coverage |
| `hook-firing-order.test.ts` uses compile-time type assertions as runtime tests | Always pass, never catch regressions |
| No concurrent audit session tests | Race conditions in state management untested |
| No error recovery path tests | Tool timeout, disk full, permission denied all untested |
| No finding deduplication tests | Core correctness assumption unverified |
| No `severity_threshold` filtering tests | Feature flag behavior unknown |
| Mock verification weak | Mocks set but rarely verified as called |
| No test for config validation failure | Silent config discard (issue 1.5) has no test |

### Flakiness Risks

- Report determinism tests freeze `Date.now()` but some tests don't
- Event sequencing tests assume hooks are synchronous
- Temp directory cleanup is manual (`tempDirs.push()`) — leak risk if test throws before push
- Shared mutable state between tests in `subagent-telemetry-capture.test.ts`

### Per-File Assessment

| File | Quality | Key Gap |
|------|---------|---------|
| `smoke.test.ts` | Worthless | Delete or replace |
| `full-audit.test.ts` | Good | Needs error scenarios |
| `full-audit-pipeline.test.ts` | Excellent | Complete pipeline coverage |
| `hook-firing-order.test.ts` | Type-only | Not real runtime tests |
| `single-writer-policy.test.ts` | Good | Missing FS edge cases |
| `report-quality-gates.test.ts` | Very Good | Determinism proven |
| `report-contract.test.ts` | Good | Missing positive path tests |
| `canonical-report-pipeline.test.ts` | Excellent | Full E2E |
| `agent-context-flow.test.ts` | Good | Missing concurrent session test |
| `pipeline-fixes-e2e.test.ts` | Excellent | Real bug coverage |
| `migration-modes.test.ts` | Good | Compatibility matrix incomplete |
| `determinism-replay.test.ts` | Excellent | Perfect determinism proofs |
| `subagent-telemetry-capture.test.ts` | Very Good | Child session tracking proven |
| `e2e-audit.test.ts` | Good | Missing enforcer fail scenarios |
| `skill-validation.test.ts` | Good | Corrupt file handling missing |
| `agent-isolation.test.ts` | Good | Token budget verified |
| `scvd-sync-simulation.test.ts` | Good | Network failure modes covered |
| `plugin-e2e.test.ts` | Good | Never calls tools, only checks shape |
| `source-manifest.test.ts` | Good | All 8 sources validated |

---

## 8. Architectural Observations

### What Works Well

- **Agent separation** (Argus/Sentinel/Pythia/Scribe) is clean with well-defined responsibilities
- **Event sourcing** via journal + projectors is sound in principle
- **Skill system** with frontmatter parsing, TF-IDF similarity, and clustering is well-designed
- **Zod schemas** for validation throughout the codebase
- **Deterministic report generation** is properly implemented and tested
- **Comprehensive agent prompts** with fallback procedures and severity guidelines
- **Rich error classification** in SCVD client (ScvdNetworkError, ScvdApiError)

### What Needs Rethinking

| Area | Problem | Suggested Direction |
|------|---------|-------------------|
| State management | No concurrency model | Introduce mutex/queue/single-writer pattern |
| Session-to-sink routing | 3 maps + 7-level fallback | Single `SessionRegistry` class |
| External tool execution | 5 nearly identical spawn wrappers | Shared `runExternalTool()` with timeout, validation, output parsing |
| Error strategy | Inconsistent (throw / return null / swallow / return object) | Pick one pattern per layer |
| Validation constants | 4 copies of severity/source/agent enums | Single `src/constants/validation.ts` |
| Configuration | Silent full-discard on partial error | Partial validation with per-field defaults |

---

## 9. Priority Matrix

| Priority | Count | Examples | Action |
|----------|-------|---------|--------|
| **Critical** | 5 | RCE via `new Function()`, race conditions, finding ID non-determinism, silent config discard | Block production deployment |
| **High** | 9 | Command injection, no teardown, memory leaks, inverted log levels, no task timeout | Fix before beta/staging |
| **Medium (DRY)** | 9 | 5x `isRecord()`, 3x `SEVERITY_RANK`, 5x command runner, stopwords | Consolidate into shared modules |
| **Medium (KISS)** | 6 | 3-layer sink mapping, over-parameterized hooks, 2-pass parser | Simplify architecture |
| **Medium (Bugs)** | 9 | Use-before-assign, event ordering, budget enforcement, orphan cleanup | Fix before extended testing |
| **Low** | 14 | Dead code, magic strings, hardcoded URLs, missing timeouts | Address incrementally |
| **Test Gaps** | 8+ | No concurrent tests, no error paths, no dedup tests, worthless smoke test | Add before relying on test suite |

### Recommended Fix Order

1. **Immediate (blocks deployment):**
   - Remove `new Function()` RCE vector (1.1)
   - Fix state persistence race condition with proper mutex (1.2)
   - Fix debounced save to not lose intermediate state (1.3)
   - Make finding IDs deterministic (1.4)
   - Fix config loader to not discard valid fields (1.5)

2. **Near-term (before beta):**
   - Add path traversal validation (2.4)
   - Add plugin teardown handler (2.6)
   - Fix inverted log levels (2.7)
   - Add timeouts to background tasks (2.9) and forge tools (6.6)
   - Fix `auditStateGetter` initialization order (5.1)

3. **Short-term (1-2 sprints):**
   - Extract shared `runExternalTool()` utility (3.4)
   - Extract shared constants module (3.1, 3.2, 3.3)
   - Simplify session-to-sink routing (4.1)
   - Add concurrent session tests
   - Add error recovery path tests
   - Delete or replace `smoke.test.ts`

4. **Ongoing:**
   - Centralize external URLs to configuration (6.5)
   - Improve error messages with context (6.8)
   - Address remaining code smells incrementally

---

*This review was conducted on the `staging` branch at commit `9f8dd9e`.*
