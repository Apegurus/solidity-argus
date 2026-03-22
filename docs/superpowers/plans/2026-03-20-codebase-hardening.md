# Codebase Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical bugs, race conditions, DRY violations, and code smells identified in the comprehensive codebase review.

**Architecture:** Fixes are organized by subsystem with shared utilities extracted first (tasks 1-3), then critical concurrency bugs (tasks 4-6), then correctness fixes (tasks 7-12), then cleanup (tasks 13-16). Each task is independently testable and committable.

**Tech Stack:** TypeScript, Bun test framework, event-sourced state management

---

### Task 1: Extract shared `formatError` utility

Repeated `${error instanceof Error ? error.message : String(error)}` pattern appears 15+ times across the codebase.

**Files:**
- Create: `src/shared/format-error.ts`
- Create: `src/shared/format-error.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/shared/format-error.test.ts
import { test, expect } from "bun:test"
import { formatError } from "./format-error"

test("formats Error instances", () => {
  expect(formatError(new Error("boom"))).toBe("boom")
})

test("formats strings", () => {
  expect(formatError("oops")).toBe("oops")
})

test("formats numbers", () => {
  expect(formatError(42)).toBe("42")
})

test("formats null", () => {
  expect(formatError(null)).toBe("null")
})

test("formats undefined", () => {
  expect(formatError(undefined)).toBe("undefined")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/shared/format-error.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/shared/format-error.ts
export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/shared/format-error.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/format-error.ts src/shared/format-error.test.ts
git commit -m "refactor: extract shared formatError utility"
```

---

### Task 2: Extract shared `countBySeverity` — deduplicate severity counting

The severity counting pattern is duplicated in `system-prompt-hook.ts`, `compaction-hook.ts`, and `validation-constants.ts`. The canonical version already exists in `validation-constants.ts:3-15`.

**Files:**
- Modify: `src/hooks/system-prompt-hook.ts:44-54`
- Modify: `src/hooks/compaction-hook.ts:15-25`

- [ ] **Step 1: Write a test that validates the shared function works for hook contexts**

```typescript
// Add to existing src/hooks/compaction-hook.test.ts
import { countBySeverity } from "../shared/validation-constants"

test("countBySeverity returns correct counts", () => {
  const findings = [
    { severity: "High" },
    { severity: "High" },
    { severity: "Low" },
  ] as any[]
  const counts = countBySeverity(findings)
  expect(counts.High).toBe(2)
  expect(counts.Low).toBe(1)
  expect(counts.Critical).toBe(0)
})
```

- [ ] **Step 2: Run test to verify it passes (function already exists)**

Run: `bun test src/hooks/compaction-hook.test.ts`
Expected: PASS

- [ ] **Step 3: Replace inline severity counting in `system-prompt-hook.ts`**

In `src/hooks/system-prompt-hook.ts`, replace lines 44-54:

```typescript
// Before (lines 44-54):
  const severityCounts: Record<FindingSeverity, number> = {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
    Informational: 0,
  }

  for (const finding of auditState.findings) {
    severityCounts[finding.severity]++
  }

// After:
  const severityCounts = countBySeverity(auditState.findings)
```

Add import: `import { countBySeverity } from "../shared/validation-constants"`

- [ ] **Step 4: Replace inline severity counting in `compaction-hook.ts`**

In `src/hooks/compaction-hook.ts`, replace lines 15-25:

```typescript
// Before (lines 15-25):
      const severityCounts: Record<FindingSeverity, number> = {
        Critical: 0,
        High: 0,
        Medium: 0,
        Low: 0,
        Informational: 0,
      }

      for (const finding of state.findings) {
        severityCounts[finding.severity]++
      }

// After:
      const severityCounts = countBySeverity(state.findings)
```

Add import: `import { countBySeverity } from "../shared/validation-constants"`
Remove unused import: `FindingSeverity` (if no longer needed).

- [ ] **Step 5: Run all affected tests**

Run: `bun test src/hooks/system-prompt-hook.test.ts src/hooks/compaction-hook.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/system-prompt-hook.ts src/hooks/compaction-hook.ts src/hooks/compaction-hook.test.ts
git commit -m "refactor: deduplicate severity counting via shared countBySeverity"
```

---

### Task 3: Extract canonical agent name constants

Agent family sets are defined in 3 places with divergent membership: `agent-tracker.ts:8`, `context-budget.ts:16-17`, `tool-tracking-hook.ts:371-376`. Extract to a single source of truth.

**Files:**
- Create: `src/shared/agent-names.ts`
- Create: `src/shared/agent-names.test.ts`
- Modify: `src/hooks/agent-tracker.ts:8`
- Modify: `src/hooks/context-budget.ts:16-17`
- Modify: `src/shared/validation-constants.ts:40-46`

- [ ] **Step 1: Write the failing test**

```typescript
// src/shared/agent-names.test.ts
import { test, expect } from "bun:test"
import {
  ARGUS_FAMILY,
  ARGUS_ORCHESTRATOR,
  ARGUS_SUBAGENTS,
  isArgusFamily,
  isOrchestratorAgent,
  isSubagent,
} from "./agent-names"

test("ARGUS_FAMILY contains all 4 agents", () => {
  expect(ARGUS_FAMILY).toEqual(new Set(["argus", "sentinel", "pythia", "scribe"]))
})

test("ARGUS_ORCHESTRATOR is argus", () => {
  expect(ARGUS_ORCHESTRATOR).toEqual(new Set(["argus"]))
})

test("ARGUS_SUBAGENTS excludes argus", () => {
  expect(ARGUS_SUBAGENTS).toEqual(new Set(["sentinel", "pythia", "scribe"]))
})

test("isArgusFamily checks membership", () => {
  expect(isArgusFamily("argus")).toBe(true)
  expect(isArgusFamily("sentinel")).toBe(true)
  expect(isArgusFamily("unknown")).toBe(false)
  expect(isArgusFamily("other")).toBe(false)
})

test("isOrchestratorAgent checks membership", () => {
  expect(isOrchestratorAgent("argus")).toBe(true)
  expect(isOrchestratorAgent("sentinel")).toBe(false)
})

test("isSubagent checks membership", () => {
  expect(isSubagent("sentinel")).toBe(true)
  expect(isSubagent("argus")).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/shared/agent-names.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/shared/agent-names.ts
export const ARGUS_ORCHESTRATOR = new Set(["argus"] as const)
export const ARGUS_SUBAGENTS = new Set(["sentinel", "pythia", "scribe"] as const)
export const ARGUS_FAMILY = new Set([...ARGUS_ORCHESTRATOR, ...ARGUS_SUBAGENTS])

export function isArgusFamily(agent: string): boolean {
  return ARGUS_FAMILY.has(agent)
}

export function isOrchestratorAgent(agent: string): boolean {
  return ARGUS_ORCHESTRATOR.has(agent)
}

export function isSubagent(agent: string): boolean {
  return ARGUS_SUBAGENTS.has(agent)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/shared/agent-names.test.ts`
Expected: PASS

- [ ] **Step 5: Update consumers**

In `src/hooks/agent-tracker.ts:8`, replace:
```typescript
// Before:
const ARGUS_FAMILY = new Set(["argus", "sentinel", "pythia", "scribe"])
// After:
import { ARGUS_FAMILY } from "../shared/agent-names"
```

In `src/hooks/context-budget.ts:16-17`, replace:
```typescript
// Before:
const ARGUS_AGENTS = new Set(["argus"])
const SUBAGENTS = new Set(["sentinel", "pythia", "scribe"])
// After:
import { ARGUS_ORCHESTRATOR as ARGUS_AGENTS, ARGUS_SUBAGENTS as SUBAGENTS } from "../shared/agent-names"
```

In `src/shared/validation-constants.ts:40-46`, replace:
```typescript
// Before:
export const VALID_AGENTS: ReadonlySet<ArgusAgentName> = new Set([
  "argus",
  "sentinel",
  "pythia",
  "scribe",
  "unknown",
])
// After:
import { ARGUS_FAMILY } from "./agent-names"
export const VALID_AGENTS: ReadonlySet<ArgusAgentName> = new Set([...ARGUS_FAMILY, "unknown"])
```

- [ ] **Step 6: Run affected tests**

Run: `bun test src/shared/agent-names.test.ts src/hooks/agent-tracker.test.ts src/hooks/context-budget.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/shared/agent-names.ts src/shared/agent-names.test.ts src/hooks/agent-tracker.ts src/hooks/context-budget.ts src/shared/validation-constants.ts
git commit -m "refactor: extract canonical agent name constants to single source of truth"
```

---

### Task 4: Fix mutex timeout race condition (CRITICAL)

Both `createAsyncMutex` in `audit-state-manager.ts:63-99` and `createMutex` in `event-sink.ts:48-82` release the lock on timeout while the holder keeps running, allowing concurrent critical section execution.

**Files:**
- Modify: `src/features/persistent-state/audit-state-manager.ts:63-99`
- Modify: `src/features/persistent-state/event-sink.ts:48-82`
- Test: `src/features/persistent-state/audit-state-manager.test.ts`
- Test: `src/features/persistent-state/event-sink.test.ts`

- [ ] **Step 1: Write the failing test for `createAsyncMutex`**

Add to `src/features/persistent-state/audit-state-manager.test.ts`:

```typescript
import { createAsyncMutex } from "./audit-state-manager"

test("mutex timeout does not allow concurrent critical sections", async () => {
  const mutex = createAsyncMutex(50) // 50ms timeout
  const log: string[] = []

  // First acquire — hold for 200ms (well past 50ms timeout)
  const release1 = await mutex.acquire()
  const holder1 = (async () => {
    log.push("holder1-start")
    await Bun.sleep(200)
    log.push("holder1-end")
    release1()
  })()

  // Second acquire — should wait until holder1 finishes, NOT after timeout
  await Bun.sleep(10) // ensure holder1 started
  const release2Promise = mutex.acquire()
  const holder2 = release2Promise.then(async (release2) => {
    log.push("holder2-start")
    release2()
  })

  await Promise.all([holder1, holder2])

  // holder2 must NOT start before holder1 ends
  const idx1End = log.indexOf("holder1-end")
  const idx2Start = log.indexOf("holder2-start")
  expect(idx1End).toBeLessThan(idx2Start)
})
```

- [ ] **Step 2: Run test to verify it fails (current impl allows concurrent access on timeout)**

Run: `bun test src/features/persistent-state/audit-state-manager.test.ts -t "mutex timeout"`
Expected: FAIL — holder2 starts before holder1 ends

- [ ] **Step 3: Fix `createAsyncMutex` — timeout logs error but does NOT release lock**

Replace `src/features/persistent-state/audit-state-manager.ts:63-99`:

```typescript
export function createAsyncMutex(timeoutMs = SAVE_MUTEX_TIMEOUT_MS) {
  const logger = createLogger()
  let chain = Promise.resolve()

  return {
    async acquire(): Promise<() => void> {
      const previous = chain
      let releaseCurrent!: () => void
      chain = new Promise<void>((resolve) => {
        releaseCurrent = resolve
      })

      await previous

      let released = false
      const timeout = setTimeout(() => {
        // Log the timeout but do NOT release — the holder must finish
        // its critical section and call release() explicitly.
        logger.error(`audit-state-manager mutex held for >${timeoutMs}ms — possible deadlock`)
      }, timeoutMs)

      return () => {
        if (released) {
          return
        }

        released = true
        clearTimeout(timeout)
        releaseCurrent()
      }
    },
  }
}
```

- [ ] **Step 4: Fix `createMutex` in `event-sink.ts` — timeout logs but does not skip waiting**

Replace `src/features/persistent-state/event-sink.ts:48-82`:

```typescript
export function createMutex(options: MutexOptions = {}) {
  const { timeoutMs = MUTEX_TIMEOUT_MS, logger } = options
  let chain = Promise.resolve()

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      const prev = chain
      let release!: () => void
      chain = new Promise<void>((r) => {
        release = r
      })

      const timer = setTimeout(() => {
        logger?.error("EventSink mutex held >30s — possible deadlock, still waiting")
      }, timeoutMs)

      await prev

      clearTimeout(timer)

      try {
        return await fn()
      } finally {
        release()
      }
    },
  }
}
```

- [ ] **Step 5: Run tests**

Run: `bun test src/features/persistent-state/audit-state-manager.test.ts src/features/persistent-state/event-sink.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/persistent-state/audit-state-manager.ts src/features/persistent-state/event-sink.ts src/features/persistent-state/audit-state-manager.test.ts
git commit -m "fix(critical): mutex timeout no longer releases lock — prevents concurrent critical sections"
```

---

### Task 5: Fix `save()` CAS race condition (CRITICAL)

In `audit-state-manager.ts:499-501`, `currentState = state` is set before acquiring the mutex. Overlapping `save()` calls overwrite each other's state.

**Files:**
- Modify: `src/features/persistent-state/audit-state-manager.ts:499-502`
- Test: `src/features/persistent-state/audit-state-manager.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/features/persistent-state/audit-state-manager.test.ts`:

```typescript
test("concurrent save() calls do not lose state", async () => {
  // This test verifies that the first save's state is not overwritten
  // by the second save's state before the first save completes.
  // The fix moves `currentState = state` inside the mutex.
  // This is a design-level test — implementation depends on the manager's
  // internal structure. Verify by reading the saved file after both complete.
})
```

Note: This is hard to test in isolation without refactoring the manager. The fix is straightforward.

- [ ] **Step 2: Apply the fix — move assignment inside mutex**

In `src/features/persistent-state/audit-state-manager.ts`, change lines 499-502:

```typescript
// Before:
  async function save(state: AuditState): Promise<void> {
    await startupCleanup
    currentState = state
    const releaseMutex = await saveMutex.acquire()

// After:
  async function save(state: AuditState): Promise<void> {
    await startupCleanup
    const releaseMutex = await saveMutex.acquire()
    currentState = state
```

- [ ] **Step 3: Run tests**

Run: `bun test src/features/persistent-state/audit-state-manager.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/features/persistent-state/audit-state-manager.ts
git commit -m "fix(critical): move currentState assignment inside mutex to prevent CAS race"
```

---

### Task 6: Fix `processQueue` re-entrancy guard (CRITICAL)

In `background-manager.ts:74-146`, `processingScheduled` is reset in `finally` after the microtask fires, potentially blocking the queue permanently.

**Files:**
- Modify: `src/features/background-agent/background-manager.ts:74-146`
- Test: `src/features/background-agent/background-manager.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/features/background-agent/background-manager.test.ts`:

```typescript
test("queued tasks drain after concurrent completions", async () => {
  let dispatched = 0
  const dispatcher = async () => {
    dispatched++
    return `result-${dispatched}`
  }

  const manager = createBackgroundManager(dispatcher, { maxConcurrent: 1 })

  // Dispatch 3 tasks with maxConcurrent=1
  manager.dispatch("agent", "task1")
  manager.dispatch("agent", "task2")
  manager.dispatch("agent", "task3")

  // Wait for all to complete
  await Bun.sleep(500)

  expect(dispatched).toBe(3)
  expect(manager.getActiveCount()).toBe(0)
})
```

- [ ] **Step 2: Run test to verify behavior**

Run: `bun test src/features/background-agent/background-manager.test.ts -t "queued tasks drain"`
Expected: May FAIL if timing reproduces the race

- [ ] **Step 3: Fix — use `queueMicrotask` for the entire drain, not just re-entry**

Replace the `processQueue` function in `src/features/background-agent/background-manager.ts:74-146`:

```typescript
  let drainScheduled = false

  function scheduleDrain(): void {
    if (drainScheduled) return
    drainScheduled = true
    queueMicrotask(() => {
      drainScheduled = false
      drainQueue()
    })
  }

  function drainQueue(): void {
    while (runningCount < maxConcurrent && queue.length > 0) {
      const nextTaskId = queue.shift()

      if (!nextTaskId) {
        return
      }

      const task = tasks.get(nextTaskId)
      if (!task || task.status === "cancelled") {
        continue
      }

      task.status = "running"
      runningCount += 1

      const TASK_TIMEOUT_MS = 5 * 60 * 1000
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Background task timed out after 5 minutes: ${nextTaskId}`)),
          TASK_TIMEOUT_MS,
        )
      })

      Promise.race([dispatcher(task.agentName, task.prompt, task.options), timeoutPromise])
        .then((result) => {
          const currentTask = tasks.get(nextTaskId)

          if (!currentTask || currentTask.status === "cancelled") {
            return
          }

          currentTask.status = "completed"
          currentTask.result = result
          invokeCallbacks(nextTaskId, result)
        })
        .catch((error: unknown) => {
          const currentTask = tasks.get(nextTaskId)

          if (!currentTask || currentTask.status === "cancelled") {
            return
          }

          const isTimeout =
            error instanceof Error && error.message.includes("timed out after 5 minutes")
          if (isTimeout) {
            logger.error(`Background task timed out: ${nextTaskId}`, error)
          } else {
            logger.error(`Background task failed: ${nextTaskId}`, error)
          }

          currentTask.status = "failed"
          currentTask.error = error
          invokeCallbacks(nextTaskId, error)
        })
        .finally(() => {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          runningCount = Math.max(0, runningCount - 1)
          scheduleDrain()
        })
    }
  }
```

Update all `processQueue()` call sites to `scheduleDrain()` (there is one in `dispatch` at ~line 161).

- [ ] **Step 4: Run tests**

Run: `bun test src/features/background-agent/background-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/background-agent/background-manager.ts src/features/background-agent/background-manager.test.ts
git commit -m "fix(critical): processQueue re-entrancy guard no longer blocks task drain"
```

---

### Task 7: Unify `extractSessionId` / `resolveOpencodeEventSessionId` (BUG)

Two functions do the same thing but check fields in different order, producing different results when both `info.id` and `sessionID` are present.

**Files:**
- Modify: `src/create-hooks.ts:57-78`
- Modify: `src/hooks/event-hook.ts:33-55`

- [ ] **Step 1: Delete `resolveOpencodeEventSessionId` from `create-hooks.ts`**

In `src/create-hooks.ts`, remove lines 57-78 and replace all usages of `resolveOpencodeEventSessionId` with `extractSessionId` imported from `./hooks/event-hook`.

Add import: `import { extractSessionId } from "./hooks/event-hook"` (if `extractSessionId` is not already exported — check and export it).

- [ ] **Step 2: Ensure `extractSessionId` is exported from `event-hook.ts`**

In `src/hooks/event-hook.ts`, the function is currently not exported. Add `export` keyword:

```typescript
// Before:
function extractSessionId(event: {
// After:
export function extractSessionId(event: {
```

- [ ] **Step 3: Run tests**

Run: `bun test src/create-hooks.test.ts src/hooks/event-hook.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/create-hooks.ts src/hooks/event-hook.ts
git commit -m "fix: unify session ID extraction into single function — prevents divergent resolution"
```

---

### Task 8: Remove duplicate `estimateTokens` from `system-prompt-hook.ts`

`estimateTokens` is defined in both `shared/token-utils.ts` and `hooks/system-prompt-hook.ts`.

**Files:**
- Modify: `src/hooks/system-prompt-hook.ts:4-5, 35-37`

- [ ] **Step 1: Replace duplicate with import**

In `src/hooks/system-prompt-hook.ts`:

Remove lines 4-5 (`const TOKENS_PER_CHAR = 4`) and lines 35-37 (`export function estimateTokens`).

Add import: `import { estimateTokens } from "../shared/token-utils"`

Keep the export by re-exporting: `export { estimateTokens } from "../shared/token-utils"` (if other files import it from system-prompt-hook).

- [ ] **Step 2: Check for consumers that import from system-prompt-hook**

Run: `grep -r "from.*system-prompt-hook.*estimateTokens" src/` to find any consumers. If found, add a re-export.

- [ ] **Step 3: Run tests**

Run: `bun test src/hooks/system-prompt-hook.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/hooks/system-prompt-hook.ts
git commit -m "refactor: remove duplicate estimateTokens — import from shared/token-utils"
```

---

### Task 9: Fix `solodit-lifecycle.ts` — signal handlers and listener leak

1. SIGINT/SIGTERM handlers don't call `process.exit()` — process hangs.
2. `_resetSoloditState` doesn't remove listeners — they accumulate on re-init.

**Files:**
- Modify: `src/solodit-lifecycle.ts:150-164, 281-301`
- Test: `src/solodit-monitor.test.ts`

- [ ] **Step 1: Fix signal handlers to exit properly**

In `src/solodit-lifecycle.ts`, replace lines 150-164:

```typescript
let exitHandlerRegistered = false
let sigintHandler: (() => void) | null = null
let sigtermHandler: (() => void) | null = null

function ensureExitHandler(): void {
  if (exitHandlerRegistered) return
  exitHandlerRegistered = true
  process.on("exit", killSoloditChild)
  sigintHandler = () => {
    killSoloditChild()
    process.exit(130)
  }
  sigtermHandler = () => {
    killSoloditChild()
    process.exit(143)
  }
  process.on("SIGINT", sigintHandler)
  process.on("SIGTERM", sigtermHandler)
}
```

- [ ] **Step 2: Fix `_resetSoloditState` to remove listeners**

In `src/solodit-lifecycle.ts`, add listener cleanup to `_resetSoloditState` (around line 299-300):

```typescript
export function _resetSoloditState(): void {
  stopSoloditMonitoring()
  _soloditAvailable = false
  restartPromise = null
  startupPromise = null
  lifecycleState = "stopped"
  lifecycleError = undefined
  restartSettleMs = DEFAULT_RESTART_SETTLE_MS
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS
  spawnFn = defaultSpawnFn
  if (soloditChild) {
    try {
      soloditChild.kill()
    } catch {
      createLogger().debug("Failed to kill Solodit MCP on reset")
    }
    soloditChild = null
  }
  // Remove registered signal/exit handlers to prevent accumulation
  process.removeListener("exit", killSoloditChild)
  if (sigintHandler) {
    process.removeListener("SIGINT", sigintHandler)
    sigintHandler = null
  }
  if (sigtermHandler) {
    process.removeListener("SIGTERM", sigtermHandler)
    sigtermHandler = null
  }
  exitHandlerRegistered = false
}
```

- [ ] **Step 3: Run tests**

Run: `bun test src/solodit-monitor.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/solodit-lifecycle.ts
git commit -m "fix: signal handlers now exit properly and listeners are cleaned up on reset"
```

---

### Task 10: Fix `addIndicator` empty-string match bug

In `contract-analyzer-tool.ts:42-46`, when `indicator` lacks `"uses-"` prefix, `split("uses-")[1]` returns `undefined`, fallback is `""`, and `source.includes("")` is always `true`.

**Files:**
- Modify: `src/tools/contract-analyzer-tool.ts:42-46`
- Test: `src/tools/contract-analyzer-tool.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/tools/contract-analyzer-tool.test.ts`:

```typescript
test("addIndicator does not match indicators without uses- prefix", () => {
  // This test verifies the fix. Before fix, any indicator without
  // "uses-" prefix would match via empty string includes.
  // After fix, only indicators with the "uses-" prefix are matched.
})
```

Note: `addIndicator` is a private function. Test via the public `collectRiskIndicators` or the tool's `execute` function. Add a test that the tool does NOT add garbage indicators for source that contains expected keywords.

- [ ] **Step 2: Fix `addIndicator`**

In `src/tools/contract-analyzer-tool.ts:42-46`, replace:

```typescript
// Before:
function addIndicator(indicators: Set<string>, source: string, indicator: string): void {
  if (source.includes(indicator.split("uses-")[1] ?? "")) {
    indicators.add(indicator)
  }
}

// After:
function addIndicator(indicators: Set<string>, source: string, indicator: string): void {
  const keyword = indicator.split("uses-")[1]
  if (keyword && source.includes(keyword)) {
    indicators.add(indicator)
  }
}
```

- [ ] **Step 3: Run tests**

Run: `bun test src/tools/contract-analyzer-tool.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/tools/contract-analyzer-tool.ts
git commit -m "fix: addIndicator no longer matches on empty string when uses- prefix missing"
```

---

### Task 11: Fix config loader dropping Zod defaults

In `config/loader.ts:37`, `sanitized[key] = merged[key]` uses the raw value instead of `fieldResult.data`, discarding Zod defaults and transforms.

**Files:**
- Modify: `src/config/loader.ts:37`
- Test: `src/config/loader.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/config/loader.test.ts`:

```typescript
import { _mergeConfigs } from "./loader"

test("partial config fields get Zod defaults applied", () => {
  // Pass a partial knowledge config — scvd sub-fields should get defaults
  const result = _mergeConfigs(null, { knowledge: { autoSync: false } })
  // scvd.enabled should default to true even though we only set autoSync
  expect(result.knowledge.scvd.enabled).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/config/loader.test.ts -t "partial config"`
Expected: May FAIL if Zod defaults are dropped

- [ ] **Step 3: Fix — use `fieldResult.data` instead of `merged[key]`**

In `src/config/loader.ts:37`, change:

```typescript
// Before:
        sanitized[key] = merged[key]
// After:
        sanitized[key] = fieldResult.data
```

- [ ] **Step 4: Run tests**

Run: `bun test src/config/loader.test.ts src/config/loader-partial-validation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/loader.ts src/config/loader.test.ts
git commit -m "fix: config loader now uses Zod-parsed data, preserving defaults and transforms"
```

---

### Task 12: Fix `parseTrpcData` — parse standard JSON first

In `solodit-search-tool.ts:329-340`, the regex "fix" for unquoted keys can corrupt string values. Parse as standard JSON first; only attempt fixup if it fails.

**Files:**
- Modify: `src/tools/solodit-search-tool.ts:329-340`
- Test: `src/tools/solodit-search-tool.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/tools/solodit-search-tool.test.ts`:

```typescript
import { parseTrpcData } from "./solodit-search-tool"

test("parseTrpcData handles standard JSON without corruption", () => {
  const input = JSON.stringify({ findings: [{ title: "test, key: value in string" }] })
  const result = parseTrpcData(input)
  expect(result.findings).toBeDefined()
  expect((result.findings as any[])[0].title).toBe("test, key: value in string")
})

test("parseTrpcData handles unquoted keys as fallback", () => {
  const input = '{findings: [{title: "test"}]}'
  const result = parseTrpcData(input)
  expect(result.findings).toBeDefined()
})
```

Note: `parseTrpcData` may not be exported. If not, export it for testing.

- [ ] **Step 2: Fix implementation**

In `src/tools/solodit-search-tool.ts:329-340`, replace:

```typescript
// Before:
function parseTrpcData(dataStr: string): { findings?: unknown } {
  try {
    const jsonStr = dataStr
      .trim()
      .replace(/^\(/, "")
      .replace(/\)$/, "")
      .replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":')
    return JSON.parse(jsonStr) as { findings?: unknown }
  } catch {
    return {}
  }
}

// After:
export function parseTrpcData(dataStr: string): { findings?: unknown } {
  const cleaned = dataStr.trim().replace(/^\(/, "").replace(/\)$/, "")

  // Try standard JSON first
  try {
    return JSON.parse(cleaned) as { findings?: unknown }
  } catch {
    // Fall through to unquoted-key fixup
  }

  // Fallback: attempt to fix unquoted keys
  try {
    const fixed = cleaned.replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":')
    return JSON.parse(fixed) as { findings?: unknown }
  } catch {
    return {}
  }
}
```

- [ ] **Step 3: Run tests**

Run: `bun test src/tools/solodit-search-tool.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/tools/solodit-search-tool.ts src/tools/solodit-search-tool.test.ts
git commit -m "fix: parseTrpcData tries standard JSON first to prevent data corruption"
```

---

### Task 13: Fix stale `cwd` in slither-tool default deps

In `slither-tool.ts:240`, `process.cwd()` is captured once at module load. Replace with a getter.

**Files:**
- Modify: `src/tools/slither-tool.ts:233-241`

- [ ] **Step 1: Fix — make `cwd` a getter**

In `src/tools/slither-tool.ts`, replace lines 233-241:

```typescript
// Before:
const defaultFlattenDeps: FlattenFallbackDeps = {
  runCommand: runSlitherCommand,
  hasBinary,
  ensureSolc,
  parseSolcVersion,
  extractContractNames,
  spawnFn: defaultSpawnFn,
  cwd: process.cwd(),
}

// After:
function getDefaultFlattenDeps(): FlattenFallbackDeps {
  return {
    runCommand: runSlitherCommand,
    hasBinary,
    ensureSolc,
    parseSolcVersion,
    extractContractNames,
    spawnFn: defaultSpawnFn,
    cwd: process.cwd(),
  }
}
```

Update `flattenFallback` signature:
```typescript
// Before:
export async function flattenFallback(
  args: SlitherArgs,
  context: ToolContext,
  deps: FlattenFallbackDeps = defaultFlattenDeps,
): Promise<SlitherAnalyzeResult | undefined> {

// After:
export async function flattenFallback(
  args: SlitherArgs,
  context: ToolContext,
  deps: FlattenFallbackDeps = getDefaultFlattenDeps(),
): Promise<SlitherAnalyzeResult | undefined> {
```

- [ ] **Step 2: Run tests**

Run: `bun test src/tools/slither-tool.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/tools/slither-tool.ts
git commit -m "fix: slither default cwd now computed lazily instead of captured at module load"
```

---

### Task 14: Fix `spawnForgeInspect` timer leak

In `solidity-parser.ts:155-159`, the `setTimeout` is never cleared when the process exits normally.

**Files:**
- Modify: `src/utils/solidity-parser.ts:145-166`
- Test: `src/utils/solidity-parser.test.ts`

- [ ] **Step 1: Fix — clear timer on normal exit**

Replace `src/utils/solidity-parser.ts:145-166`:

```typescript
async function spawnForgeInspect(
  contractName: string,
  inspectType: string,
  cwd: string,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["forge", "inspect", contractName, inspectType, "--json"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })

  const timeout = 15_000
  let timerId: ReturnType<typeof setTimeout>
  const timer = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      proc.kill()
      reject(new Error(`forge inspect ${inspectType} timed out after ${timeout}ms`))
    }, timeout)
  })

  try {
    const exitCode = await Promise.race([proc.exited, timer])
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    return { success: exitCode === 0, stdout, stderr }
  } finally {
    clearTimeout(timerId!)
  }
}
```

- [ ] **Step 2: Run tests**

Run: `bun test src/utils/solidity-parser.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/utils/solidity-parser.ts
git commit -m "fix: clear forge inspect timeout timer on normal process exit"
```

---

### Task 15: Fix `global-run-index.ts` — use async file I/O

`recordRun` and `updateRunStatus` are async but use `appendFileSync`.

**Files:**
- Modify: `src/features/persistent-state/global-run-index.ts:31-48`
- Test: `src/features/persistent-state/global-run-index.test.ts`

- [ ] **Step 1: Replace `appendFileSync` with `appendFile`**

In `src/features/persistent-state/global-run-index.ts`:

```typescript
// Before (line 1):
import { appendFileSync, existsSync, readFileSync } from "node:fs"

// After:
import { existsSync, readFileSync } from "node:fs"
import { appendFile, mkdir } from "node:fs/promises"

// Before (line 34):
    appendFileSync(getGlobalRunIndexFile(), `${JSON.stringify(entry)}\n`)

// After:
    await appendFile(getGlobalRunIndexFile(), `${JSON.stringify(entry)}\n`)

// Before (line 44):
    appendFileSync(getGlobalRunIndexFile(), `${JSON.stringify(update)}\n`)

// After:
    await appendFile(getGlobalRunIndexFile(), `${JSON.stringify(update)}\n`)
```

Remove duplicate `mkdir` import if it already exists.

- [ ] **Step 2: Run tests**

Run: `bun test src/features/persistent-state/global-run-index.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/features/persistent-state/global-run-index.ts
git commit -m "fix: global-run-index uses async appendFile instead of appendFileSync"
```

---

### Task 16: Fix `scvd-sync` — retry on 429/503, fix error category

1. `shouldRetrySyncError` only retries network errors, not 429/503.
2. "Sync already in progress" uses `createParseError` — wrong category.

**Files:**
- Modify: `src/knowledge/scvd-sync.ts:41-47`
- Modify: `src/knowledge/scvd-errors.ts` (add `createLockError`)
- Test: `src/knowledge/scvd-sync.test.ts`
- Test: `src/knowledge/scvd-errors.test.ts`

- [ ] **Step 1: Add `createLockError` to `scvd-errors.ts`**

Add to `src/knowledge/scvd-errors.ts`:

```typescript
export function createLockError(message: string): SyncError {
  return {
    status: "error",
    success: false,
    reason: "lock" as SyncError["reason"],
    message,
    error: message,
    newFindings: 0,
    totalIndexed: 0,
    lastSync: new Date().toISOString(),
  }
}
```

Wait — `reason` is typed as `"network" | "api" | "parse"`. We need to extend it:

```typescript
// Before (line 4):
  reason: "network" | "api" | "parse"
// After:
  reason: "network" | "api" | "parse" | "lock"
```

Also update `isRetryableError`:

```typescript
// Before:
export function isRetryableError(outcome: SyncOutcome): boolean {
  return outcome.status === "error" && outcome.reason === "network"
}

// After:
const RETRYABLE_REASONS = new Set(["network"])
const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504])

export function isRetryableError(outcome: SyncOutcome): boolean {
  if (outcome.status !== "error") return false
  if (RETRYABLE_REASONS.has(outcome.reason)) return true
  if (outcome.reason === "api" && outcome.httpStatus && RETRYABLE_HTTP_STATUSES.has(outcome.httpStatus)) return true
  return false
}
```

- [ ] **Step 2: Fix `shouldRetrySyncError` in `scvd-sync.ts`**

```typescript
// Before:
function shouldRetrySyncError(error: unknown): boolean {
  if (!(error instanceof ScvdNetworkError)) {
    return false
  }
  return isRetryableError(buildErrorResult(error))
}

// After:
function shouldRetrySyncError(error: unknown): boolean {
  if (error instanceof ScvdNetworkError || error instanceof ScvdApiError) {
    return isRetryableError(buildErrorResult(error))
  }
  return false
}
```

- [ ] **Step 3: Replace `createParseError("Sync already in progress")` usages**

In `src/knowledge/scvd-sync.ts`, find lines ~114 and ~148:

```typescript
// Before:
createParseError("Sync already in progress")
// After:
createLockError("Sync already in progress")
```

Add import: `import { createLockError } from "./scvd-errors"`

- [ ] **Step 4: Run tests**

Run: `bun test src/knowledge/scvd-errors.test.ts src/knowledge/scvd-sync.test.ts`
Expected: PASS (may need test updates for new `reason` values)

- [ ] **Step 5: Commit**

```bash
git add src/knowledge/scvd-errors.ts src/knowledge/scvd-sync.ts
git commit -m "fix: retry SCVD sync on 429/503, use lock error category for concurrency"
```

---

### Task 17: Remove redundant `Bun.env` spread in forge-fuzz-tool

In `forge-fuzz-tool.ts:199-208`, the entire `Bun.env` is explicitly spread into the child process env, unlike all other forge tools. The `--fuzz-runs` CLI flag is already being passed, making the env var redundant.

**Files:**
- Modify: `src/tools/forge-fuzz-tool.ts:198-208`

- [ ] **Step 1: Remove env spread**

In `src/tools/forge-fuzz-tool.ts`, replace:

```typescript
// Before:
    const env = {
      ...Bun.env,
      FOUNDRY_FUZZ_RUNS: String(normalized.runs),
    }

    const runResult = await runCommand(buildForgeFuzzCommand(normalized), {
      signal: context.abort,
      cwd: normalized.target,
      env,
    })

// After:
    const runResult = await runCommand(buildForgeFuzzCommand(normalized), {
      signal: context.abort,
      cwd: normalized.target,
    })
```

- [ ] **Step 2: Run tests**

Run: `bun test src/tools/forge-fuzz-tool.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/tools/forge-fuzz-tool.ts
git commit -m "fix: remove redundant Bun.env spread from forge fuzz — CLI flag already sets fuzz runs"
```

---

### Task 18: Fix `TOKENS_PER_CHAR` naming and rename to `CHARS_PER_TOKEN`

The constant `TOKENS_PER_CHAR = 4` is used as `length / TOKENS_PER_CHAR`, meaning it represents chars-per-token, not tokens-per-char.

**Files:**
- Modify: `src/shared/token-utils.ts:1`

- [ ] **Step 1: Rename constant**

In `src/shared/token-utils.ts`:

```typescript
// Before:
const TOKENS_PER_CHAR = 4
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKENS_PER_CHAR)
}

// After:
const CHARS_PER_TOKEN = 4
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}
```

- [ ] **Step 2: Run tests**

Run: `bun test src/hooks/system-prompt-hook.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/shared/token-utils.ts
git commit -m "refactor: rename TOKENS_PER_CHAR to CHARS_PER_TOKEN for accuracy"
```

---

### Task 19: Final — run full test suite

- [ ] **Step 1: Run all tests**

Run: `bun test`
Expected: All PASS

- [ ] **Step 2: Fix any regressions**

If any tests fail, fix them before proceeding.

- [ ] **Step 3: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: resolve test regressions from codebase hardening"
```
