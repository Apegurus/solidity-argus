# PR #3 Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 26 findings from the PR #3 consolidated code review — 5 high, 10 medium, 11 low priority.

**Architecture:** Each task is a self-contained fix targeting a specific module. Tasks are ordered by priority (H → M → L) and grouped by subsystem. DRY extractions (shared constants, shared utilities) are done early so later tasks can reference them.

**Tech Stack:** Bun, TypeScript, `bun test`

**Full review document:** `docs/superpowers/reports/pr3-consolidated-review.md`

---

## File Structure

### New files

| File | Responsibility |
|------|----------------|
| `src/shared/audit-phases.ts` | Single source of truth for `PHASE_ORDER` constant (DRY extraction from tool-tracking-hook + audit-enforcer) |
| `src/shared/safe-emit.ts` | Shared `emitToSink` helper (DRY extraction from tool-tracking-hook + event-hook) |
| `src/shared/path-containment.ts` | `assertContained(child, root)` — reusable path containment check for forge tools + artifact resolver |

### Modified files

| File | What changes |
|------|-------------|
| `src/state/finding-store.ts` | Dedup in `addFinding`, use shared `normalizeText` |
| `src/state/finding-fingerprint.ts` | Export `normalizeText` (single source of truth) |
| `src/features/persistent-state/audit-state-manager.ts` | Use shared `normalizeText` in `generateDeterministicFindingId`, fix `createDebouncedSave` to only persist latest |
| `src/create-hooks.ts` | Fix activateSession race, exit handler cleanup, clear `_agentTrackerRef` on dispose, remove getActiveCount no-op |
| `src/tools/forge-fuzz-tool.ts` | Path containment for `target`, URL scheme validation for `fork_url` |
| `src/tools/forge-test-tool.ts` | Same path containment + URL scheme validation |
| `src/knowledge/scvd-index.ts` | Wrap `loadIndex` JSON parse in try/catch |
| `src/hooks/tool-tracking-hook.ts` | Use shared `PHASE_ORDER`, shared `emitToSink`, shared `isArgusFamily` |
| `src/hooks/event-hook.ts` | Use shared `emitToSink`, add MAX bound on `statesBySessionId` |
| `src/features/audit-enforcer/audit-enforcer.ts` | Use shared `PHASE_ORDER` |
| `src/shared/audit-artifact-resolver.ts` | Sanitize filename in `reportFilePath`/`evidenceFilePath` |
| `scripts/audit-pdf-extract.ts` | Add `import.meta.main` guard |
| `skills/vulnerability-patterns/oracle-manipulation/SKILL.md` | Remove misplaced front-running heuristics |
| `skills/vulnerability-patterns/flash-loan-attacks/SKILL.md` | Remove misplaced timestamp heuristics |

### Test files (new or modified)

| File | What |
|------|------|
| `src/state/finding-store.test.ts` | Dedup test |
| `src/shared/path-containment.test.ts` | Containment check tests |
| `src/tools/forge-fuzz-tool.test.ts` | Path traversal + fork_url validation tests |
| `src/tools/forge-test-tool.test.ts` | Path traversal + fork_url validation tests |
| `src/knowledge/scvd-index.test.ts` | Corrupted JSON test |
| `src/create-hooks.test.ts` | Exit handler cleanup, tracker ref cleanup tests |
| `src/features/persistent-state/audit-state-manager.test.ts` | Debounced save only-latest test |

---

## Task 1: Extract shared `normalizeText` from `finding-fingerprint.ts`

**Priority:** Prerequisite for H2, M10
**Files:**
- Modify: `src/state/finding-fingerprint.ts:24-26`

Currently `normalizeText` is defined identically in `finding-fingerprint.ts:24` and `finding-store.ts:26`. Make `finding-fingerprint.ts` the single source of truth by exporting it.

- [ ] **Step 1: Export the existing function**

In `src/state/finding-fingerprint.ts:24`, change:

```typescript
// Before:
function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}

// After:
export function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}
```

- [ ] **Step 2: Replace in finding-store.ts**

In `src/state/finding-store.ts`, remove lines 26-28 (the local `normalizeText`) and add an import:

```typescript
// Add to imports at top:
import { normalizeText } from "./finding-fingerprint"
```

Remove:
```typescript
function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}
```

- [ ] **Step 3: Run tests**

Run: `bun test src/state/finding-store.test.ts src/state/finding-fingerprint.ts --no-timeout`
Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/state/finding-fingerprint.ts src/state/finding-store.ts
git commit -m "refactor: export normalizeText from finding-fingerprint as single source of truth"
```

---

## Task 2: Fix H2 — `addFinding` deduplication

**Priority:** High
**Files:**
- Modify: `src/state/finding-store.ts:41-53`
- Test: `src/state/finding-store.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/state/finding-store.test.ts`:

```typescript
test("addFinding deduplicates by check+file+lines", () => {
  const state = createEmptyAuditState("test-session", "/tmp/project")
  const store = createFindingStore(state)

  const finding = {
    check: "reentrancy-eth",
    severity: "High" as const,
    confidence: "High" as const,
    description: "Reentrancy in withdraw()",
    file: "src/Vault.sol",
    lines: [10, 20] as [number, number],
    source: "slither" as const,
  }

  const first = store.addFinding(finding)
  const second = store.addFinding(finding)

  expect(second.id).toBe(first.id)
  expect(store.getFindings()).toHaveLength(1)
  expect(state.findings).toHaveLength(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/state/finding-store.test.ts -t "deduplicates" --no-timeout`
Expected: FAIL — `expect(store.getFindings()).toHaveLength(1)` receives 2.

- [ ] **Step 3: Implement dedup guard**

In `src/state/finding-store.ts`, modify `addFinding`:

```typescript
function addFinding(finding: Omit<Finding, "id">): Finding {
  const id = generateObservationId(finding.check, finding.file, finding.lines)

  const existing = hydratedFindings.find((f) => f.id === id)
  if (existing) {
    return existing
  }

  const newFinding: Finding = {
    ...finding,
    id,
  }

  state.findings.push(newFinding)
  hydratedFindings.push(newFinding)

  return newFinding
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/state/finding-store.test.ts --no-timeout`
Expected: ALL pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/finding-store.ts src/state/finding-store.test.ts
git commit -m "fix: deduplicate findings by ID in addFinding — prevents duplicate report entries"
```

---

## Task 3: Fix M10 — Normalize inputs in `generateDeterministicFindingId`

**Priority:** Medium (depends on Task 1)
**Files:**
- Modify: `src/features/persistent-state/audit-state-manager.ts:34-43`
- Test: `src/features/persistent-state/audit-state-manager.test.ts`

The `audit-state-manager` version doesn't normalize inputs, so legacy-migrated IDs diverge from `finding-store` IDs.

- [ ] **Step 1: Write failing test**

Add to `src/features/persistent-state/audit-state-manager.test.ts`:

```typescript
import { normalizeText } from "../../state/finding-fingerprint"

test("migrated finding IDs match finding-store IDs for same input", () => {
  // finding-store normalizes: " Reentrancy-Eth " → "reentrancy-eth"
  // audit-state-manager should produce the same ID
  const check = " Reentrancy-Eth "
  const file = " Src/Vault.sol "
  const lines: [number, number] = [10, 20]

  const normalizedHash = createHash("sha256")
    .update(`${normalizeText(check)}:${normalizeText(file)}:${lines[0]}-${lines[1]}`)
    .digest("hex")
    .substring(0, 16)

  // Create a state with a legacy finding
  const state = createEmptyAuditState("test-session", "/tmp")
  state.findings.push({
    id: "obs-1",
    check,
    file,
    lines,
    severity: "High",
    confidence: "High",
    description: "test",
    source: "slither",
  })

  const migratedCount = migrateLegacyFindingIds(state)
  expect(migratedCount).toBe(1)
  expect(state.findings[0].id).toBe(normalizedHash)
})
```

**Important:** `migrateLegacyFindingIds` is currently unexported. Add `export` to its declaration in `audit-state-manager.ts:45`:

```typescript
// Before:
function migrateLegacyFindingIds(state: AuditState): number {

// After:
export function migrateLegacyFindingIds(state: AuditState): number {
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/features/persistent-state/audit-state-manager.test.ts -t "migrated finding IDs" --no-timeout`
Expected: FAIL — IDs don't match because manager doesn't normalize.

- [ ] **Step 3: Fix generateDeterministicFindingId**

In `src/features/persistent-state/audit-state-manager.ts`, add import and normalize:

```typescript
import { normalizeText } from "../../state/finding-fingerprint"

function generateDeterministicFindingId(
  check: string,
  file: string,
  lines: [number, number],
): string {
  return createHash("sha256")
    .update(`${normalizeText(check)}:${normalizeText(file)}:${lines[0]}-${lines[1]}`)
    .digest("hex")
    .substring(0, 16)
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/features/persistent-state/audit-state-manager.test.ts --no-timeout`
Expected: ALL pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/persistent-state/audit-state-manager.ts src/features/persistent-state/audit-state-manager.test.ts
git commit -m "fix: normalize inputs in generateDeterministicFindingId — IDs now match finding-store"
```

---

## Task 4: Fix H3 + M1 — Exit handler leak and stale `_agentTrackerRef`

**Priority:** High
**Files:**
- Modify: `src/create-hooks.ts:53, 156-158, 178, 186-195`
- Test: `src/create-hooks.test.ts`

**Key constraint:** `releaseInstanceLock` is used in TWO paths: (1) inert-hooks dispose at line 170, and (2) full dispose at line ~1142. In the inert-hooks path, `_agentTrackerRef` was set by the PREVIOUS initialization (the one holding the lock), NOT by this instance. We must NOT clear `_agentTrackerRef` or remove exit handlers in the inert path — only in the full dispose path.

- [ ] **Step 1: Write failing test for exit handler cleanup**

Add to `src/create-hooks.test.ts`:

```typescript
test("dispose removes process exit handler", () => {
  const listenersBefore = process.listenerCount("exit")
  const hooks = createHooks({ config, managers, projectDir: "/tmp", isHookEnabled: () => true })
  const listenersAfter = process.listenerCount("exit")
  expect(listenersAfter).toBe(listenersBefore + 1)

  hooks.dispose?.()
  const listenersAfterDispose = process.listenerCount("exit")
  expect(listenersAfterDispose).toBe(listenersBefore)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/create-hooks.test.ts -t "dispose removes process exit" --no-timeout`
Expected: FAIL — listener count doesn't decrease after dispose.

- [ ] **Step 3: Implement fix**

The approach: keep `releaseInstanceLock` simple (just the lock). Create a separate `fullDispose` function that does all cleanup. Use `fullDispose` for the real dispose hook, and `releaseInstanceLock` only for the inert-hooks path.

In `src/create-hooks.ts`:

**A) At line 186, name the exit handler:**

```typescript
const exitHandler = () => {
  try {
    debouncedSave.dispose()
    for (const sessionDebouncedSave of debouncedSavesBySession.values()) {
      sessionDebouncedSave.dispose()
    }
  } catch {
    /* noop */
  }
}
process.on("exit", exitHandler)
```

**B) After the exit handler, define fullDispose:**

```typescript
const fullDispose = () => {
  _agentTrackerRef = undefined
  process.removeListener("exit", exitHandler)
  releaseInstanceLock()
}
```

**C) At the returned hooks object (line ~1142), change the dispose from `releaseInstanceLock` to `fullDispose`:**

```typescript
// Before:
dispose: releaseInstanceLock,

// After:
dispose: fullDispose,
```

The inert-hooks path at line 170 still uses `releaseInstanceLock` (which only deletes the lock symbol), so it won't touch `_agentTrackerRef` or exit handlers.

- [ ] **Step 4: Run tests**

Run: `bun test src/create-hooks.test.ts --no-timeout`
Expected: ALL pass.

- [ ] **Step 5: Commit**

```bash
git add src/create-hooks.ts src/create-hooks.test.ts
git commit -m "fix: remove exit handler and clear agentTrackerRef on full dispose — prevents handler leak"
```

---

## Task 5: Fix H1 — `activateSession` race condition

**Priority:** High
**Files:**
- Modify: `src/create-hooks.ts:338-341`
- Test: `src/create-hooks.test.ts`

When a second concurrent call hits `pendingSinkCreations.has(sessionId)` at line 338, it returns early at line 340. But this return is *inside* the outer `try` block (line 293), so the `finally` block at line 447 *does* execute. The issue is subtler: `sessionActivated` is still `false`, so the session is never added to `activatedSessions`. The second caller effectively "lost" — and since `pendingActivations` was already deleted by the first caller's finally, the session can be retried.

**The real fix:** When the `pendingSinkCreations` guard fires, the session should wait for the first activation to complete rather than silently failing.

- [ ] **Step 1: Analyze the race**

Read `src/create-hooks.ts:284-453` to understand the full flow. The race happens when:
1. Call A enters, adds to `pendingActivations` (291), passes the `pendingSinkCreations` check, adds to `pendingSinkCreations` (342).
2. Call B enters, `pendingActivations.has()` is false (A hasn't finished), passes 286, adds to `pendingActivations` (291), hits `pendingSinkCreations.has()` → returns at 340.
3. Call B's finally: `sessionActivated=false` → session NOT added to `activatedSessions`. `pendingActivations.delete(sessionId)` runs.
4. Call A completes: `sessionActivated=true` → session added to `activatedSessions`. But B's work is lost.

Actually, re-reading: B's `pendingActivations.add()` at 291 is a Set, so A already added it. `pendingActivations.has()` at 286 should catch B. **Wait** — if A is past 291 but hasn't hit 342 yet, B sees `pendingActivations.has(sessionId) = true` and returns at 286. So the guard at 286 *should* prevent the race.

The only remaining issue: if A is *between* 291 and 342 (a synchronous gap), B enters and adds to `pendingActivations` (no-op, already in Set), then hits `pendingSinkCreations` at 338 which is false (A hasn't reached 342 yet), so B also enters the sink creation path — now both A and B are creating sinks concurrently.

**Fix:** Move `pendingSinkCreations.add(sessionId)` to immediately after `pendingActivations.add(sessionId)`.

- [ ] **Step 2: Apply fix**

In `src/create-hooks.ts`, move `pendingSinkCreations.add(sessionId)` from line 342 to right after line 291:

```typescript
pendingActivations.add(sessionId)
pendingSinkCreations.add(sessionId)  // ← moved here from line 342
let sessionActivated = false
try {
```

And remove the old `pendingSinkCreations.add(sessionId)` from line 342.

Add a comment explaining why:

```typescript
pendingActivations.add(sessionId)
// Must be set BEFORE the try block — if two concurrent activateSession calls race,
// the second must see this guard immediately to prevent duplicate sink creation.
pendingSinkCreations.add(sessionId)
```

The guard at line 338 (`if (pendingSinkCreations.has(sessionId))`) then becomes an early return *inside* the try, which correctly flows to the finally cleanup.

- [ ] **Step 3: Run all tests**

Run: `bun test src/create-hooks.test.ts --no-timeout`
Expected: ALL pass.

- [ ] **Step 4: Run full test suite**

Run: `bun test --no-timeout`
Expected: ALL 1396+ tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/create-hooks.ts
git commit -m "fix: prevent activateSession race — move pendingSinkCreations guard before try block"
```

---

## Task 6: Fix L1 — Remove `getActiveCount()` no-op

**Priority:** Low (while we're in create-hooks.ts)
**Files:**
- Modify: `src/create-hooks.ts:690-694`

- [ ] **Step 1: Remove the dead code**

Replace lines 690-694:

```typescript
// Before:
async ({ type }) => {
  if (type === "session.idle") {
    backgroundManager.getActiveCount()
  }
},

// After: remove the entire handler or replace with a no-op comment
// If the handler array expects an entry, keep the structure:
async () => {},
```

Actually, check if this is part of a handler array where removing it shifts indices. If it's safe to remove entirely, do so. If not, replace with an empty async function.

- [ ] **Step 2: Run tests**

Run: `bun test src/create-hooks.test.ts --no-timeout`
Expected: ALL pass.

- [ ] **Step 3: Commit**

```bash
git add src/create-hooks.ts
git commit -m "fix: remove getActiveCount() no-op in session.idle handler"
```

---

## Task 7: Fix M2 — `createDebouncedSave` only persist latest state

**Priority:** Medium
**Files:**
- Modify: `src/features/persistent-state/audit-state-manager.ts:194-212`
- Test: `src/features/persistent-state/audit-state-manager.test.ts`

- [ ] **Step 1: Write failing test**

Add to `audit-state-manager.test.ts`:

```typescript
test("createDebouncedSave only persists the latest state on flush", async () => {
  const saved: AuditState[] = []
  const debounced = createDebouncedSave(async (state) => {
    saved.push(structuredClone(state))
  }, 100)

  const state1 = createEmptyAuditState("s1", "/tmp")
  state1.currentPhase = "reconnaissance"
  const state2 = createEmptyAuditState("s1", "/tmp")
  state2.currentPhase = "scanning"
  const state3 = createEmptyAuditState("s1", "/tmp")
  state3.currentPhase = "testing"

  debounced.save(state1)
  debounced.save(state2)
  debounced.save(state3)

  await debounced.flush()

  expect(saved).toHaveLength(1)
  expect(saved[0].currentPhase).toBe("testing")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/features/persistent-state/audit-state-manager.test.ts -t "only persists the latest" --no-timeout`
Expected: FAIL — `saved` has 3 entries, not 1.

- [ ] **Step 3: Implement fix**

Replace `persistPendingStateQueue` in `audit-state-manager.ts`:

```typescript
async function persistPendingStateQueue(): Promise<void> {
  if (pendingStates.length === 0) {
    return
  }

  // Only the latest state matters — each write replaces the file
  const latestState = pendingStates[pendingStates.length - 1]
  pendingStates.length = 0

  try {
    await saveState(latestState)
  } catch {
    createLogger().debug("Debounced state persistence failed")
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/features/persistent-state/audit-state-manager.test.ts --no-timeout`
Expected: ALL pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/persistent-state/audit-state-manager.ts src/features/persistent-state/audit-state-manager.test.ts
git commit -m "fix: debounced save only persists latest state — eliminates redundant I/O"
```

---

## Task 8: Create shared `path-containment.ts` and fix H5 + M6

**Priority:** High
**Files:**
- Create: `src/shared/path-containment.ts`
- Create: `src/shared/path-containment.test.ts`
- Modify: `src/tools/forge-fuzz-tool.ts:55-67`
- Modify: `src/tools/forge-test-tool.ts:280-294`
- Modify: `src/shared/audit-artifact-resolver.ts:71-76`
- Test: `src/tools/forge-fuzz-tool.test.ts`
- Test: `src/tools/forge-test-tool.test.ts`

- [ ] **Step 1: Write tests for path containment utility**

Create `src/shared/path-containment.test.ts`:

```typescript
import { test, expect } from "bun:test"
import { assertContained, isContained, validateUrlScheme } from "./path-containment"

test("isContained allows subdirectories", () => {
  expect(isContained("/project/src/contracts", "/project")).toBe(true)
})

test("isContained rejects traversal", () => {
  expect(isContained("/project/../etc/passwd", "/project")).toBe(false)
})

test("isContained rejects sibling directories", () => {
  expect(isContained("/other-project/src", "/project")).toBe(false)
})

test("isContained allows the root itself", () => {
  expect(isContained("/project", "/project")).toBe(true)
})

test("assertContained throws on traversal", () => {
  expect(() => assertContained("../../etc", "/project")).toThrow("outside")
})

test("validateUrlScheme accepts http", () => {
  expect(validateUrlScheme("http://localhost:8545")).toBe(true)
})

test("validateUrlScheme accepts https", () => {
  expect(validateUrlScheme("https://mainnet.infura.io/v3/key")).toBe(true)
})

test("validateUrlScheme rejects non-http schemes", () => {
  expect(validateUrlScheme("file:///etc/passwd")).toBe(false)
})

test("validateUrlScheme rejects schemeless strings", () => {
  expect(validateUrlScheme("not-a-url")).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/shared/path-containment.test.ts --no-timeout`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement path-containment.ts**

Create `src/shared/path-containment.ts`:

```typescript
import { resolve, relative } from "node:path"

export function isContained(child: string, root: string): boolean {
  const resolvedChild = resolve(root, child)
  const resolvedRoot = resolve(root)
  const rel = relative(resolvedRoot, resolvedChild)
  return !rel.startsWith("..")
}

export function assertContained(child: string, root: string): string {
  const resolvedChild = resolve(root, child)
  if (!isContained(resolvedChild, root)) {
    throw new Error(
      `Path "${child}" resolves outside project root "${root}"`,
    )
  }
  return resolvedChild
}

export function validateUrlScheme(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run containment tests**

Run: `bun test src/shared/path-containment.test.ts --no-timeout`
Expected: ALL pass.

- [ ] **Step 5: Apply to forge-fuzz-tool.ts**

In `src/tools/forge-fuzz-tool.ts`, modify `normalizeArgs`:

```typescript
import { assertContained, validateUrlScheme } from "../shared/path-containment"

function normalizeArgs(args: ForgeFuzzArgs, context: ToolContext): NormalizedForgeFuzzArgs {
  const requestedRuns =
    typeof args.runs === "number" && Number.isFinite(args.runs) ? args.runs : 256
  const clampedRuns = Math.max(1, Math.min(10000, Math.floor(requestedRuns)))
  const projectRoot = resolveProjectDir(context)
  const target = args.target && args.target !== "."
    ? assertContained(args.target, projectRoot)
    : projectRoot

  if (args.fork_url && !validateUrlScheme(args.fork_url)) {
    throw new Error(`fork_url must use http:// or https:// scheme, got: "${args.fork_url}"`)
  }

  return {
    target,
    match_test: args.match_test,
    runs: clampedRuns,
    seed: args.seed,
    fork_url: args.fork_url,
  }
}
```

- [ ] **Step 6: Apply to forge-test-tool.ts**

Same pattern in `src/tools/forge-test-tool.ts` `normalizeArgs`:

```typescript
import { assertContained, validateUrlScheme } from "../shared/path-containment"

function normalizeArgs(args: ForgeTestArgs, context: ToolContext): NormalizedForgeTestArgs {
  const projectRoot = resolveProjectDir(context)
  const target = args.target && args.target !== "."
    ? assertContained(args.target, projectRoot)
    : projectRoot

  if (args.fork_url && !validateUrlScheme(args.fork_url)) {
    throw new Error(`fork_url must use http:// or https:// scheme, got: "${args.fork_url}"`)
  }

  return {
    target,
    match_test: args.match_test,
    match_contract: args.match_contract,
    fork_url: args.fork_url,
    verbosity:
      typeof args.verbosity === "number" && args.verbosity >= 1 && args.verbosity <= 5
        ? args.verbosity
        : 3,
    gas_report: args.gas_report,
    coverage: args.coverage ?? false,
  }
}
```

- [ ] **Step 7: Apply to audit-artifact-resolver.ts**

In `src/shared/audit-artifact-resolver.ts`, sanitize filenames:

```typescript
import { basename } from "node:path"

// Inside the returned object:
reportFilePath(filename: string): string {
  const safe = basename(filename)
  return join(cachedPaths.reportDir, safe)
},
evidenceFilePath(filename: string): string {
  const safe = basename(filename)
  return join(cachedPaths.evidenceDir, safe)
},
```

Using `basename` strips any path components (including `../`), keeping only the filename.

- [ ] **Step 8: Add path traversal tests to forge tool tests**

Add to `src/tools/forge-fuzz-tool.test.ts`:

```typescript
test("rejects target with path traversal", () => {
  expect(() =>
    normalizeArgs(
      { target: "../../etc", runs: 256 },
      { directory: "/project", abort: new AbortController().signal },
    ),
  ).toThrow("outside")
})

test("rejects fork_url with non-http scheme", () => {
  expect(() =>
    normalizeArgs(
      { fork_url: "file:///etc/passwd", runs: 256 },
      { directory: "/project", abort: new AbortController().signal },
    ),
  ).toThrow("http")
})
```

Add equivalent tests to `src/tools/forge-test-tool.test.ts`.

- [ ] **Step 9: Run all tool tests**

Run: `bun test src/tools/forge-fuzz-tool.test.ts src/tools/forge-test-tool.test.ts src/shared/path-containment.test.ts --no-timeout`
Expected: ALL pass.

- [ ] **Step 10: Commit**

```bash
git add src/shared/path-containment.ts src/shared/path-containment.test.ts \
  src/tools/forge-fuzz-tool.ts src/tools/forge-test-tool.ts \
  src/tools/forge-fuzz-tool.test.ts src/tools/forge-test-tool.test.ts \
  src/shared/audit-artifact-resolver.ts
git commit -m "fix: add path containment and URL scheme validation to forge tools and artifact resolver"
```

---

## Task 9: Fix H4 — Remove misplaced SKILL.md heuristics

**Priority:** High
**Files:**
- Modify: `skills/vulnerability-patterns/oracle-manipulation/SKILL.md`
- Modify: `skills/vulnerability-patterns/flash-loan-attacks/SKILL.md`

- [ ] **Step 1: Remove misplaced content from oracle-manipulation**

In `skills/vulnerability-patterns/oracle-manipulation/SKILL.md`, remove the entire `## Supplemental Heuristics (kadenzipfel)` section starting at line 213 through the end of the misplaced front-running content (approximately line 274). Keep the `## References` section above it intact.

- [ ] **Step 2: Remove misplaced content from flash-loan-attacks**

In `skills/vulnerability-patterns/flash-loan-attacks/SKILL.md`, remove the `## Supplemental Heuristics (kadenzipfel)` section starting around line 214 through the end of the misplaced timestamp content (approximately line 263). Keep the `## References` section above it intact.

- [ ] **Step 3: Verify the skill files parse correctly**

Run: `bun run src/cli/index.ts lint-skills 2>&1 | head -20`
Expected: No new errors from these two files.

- [ ] **Step 4: Commit**

```bash
git add skills/vulnerability-patterns/oracle-manipulation/SKILL.md \
  skills/vulnerability-patterns/flash-loan-attacks/SKILL.md
git commit -m "fix: remove misplaced supplemental heuristics from oracle-manipulation and flash-loan SKILL.md"
```

---

## Task 10: Fix M5 — `loadIndex` JSON parse error handling

**Priority:** Medium
**Files:**
- Modify: `src/knowledge/scvd-index.ts:191`
- Test: `src/knowledge/scvd-index.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/knowledge/scvd-index.test.ts`:

```typescript
import { loadIndex } from "./scvd-index"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

test("loadIndex returns null for corrupted JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scvd-test-"))
  const indexPath = join(dir, "index.json")
  await writeFile(indexPath, '{"version": 1, CORRUPTED')

  const result = await loadIndex(indexPath)
  expect(result).toBeNull()

  await rm(dir, { recursive: true })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/knowledge/scvd-index.test.ts -t "corrupted JSON" --no-timeout`
Expected: FAIL — unhandled JSON parse error.

- [ ] **Step 3: Wrap in try/catch**

In `src/knowledge/scvd-index.ts`, wrap the JSON parse:

```typescript
export async function loadIndex(filePath: string): Promise<ScvdIndex | null> {
  const file = Bun.file(filePath)
  const exists = await file.exists()

  if (!exists) {
    return null
  }

  let raw: unknown
  try {
    raw = (await file.json()) as unknown
  } catch {
    return null
  }

  // ... rest unchanged
```

- [ ] **Step 4: Run tests**

Run: `bun test src/knowledge/scvd-index.test.ts --no-timeout`
Expected: ALL pass.

- [ ] **Step 5: Commit**

```bash
git add src/knowledge/scvd-index.ts src/knowledge/scvd-index.test.ts
git commit -m "fix: handle corrupted JSON gracefully in loadIndex — returns null instead of crashing"
```

---

## Task 11: Fix M4 — Bound `statesBySessionId` in event-hook

**Priority:** Medium
**Files:**
- Modify: `src/hooks/event-hook.ts:76`

- [ ] **Step 1: Add eviction logic**

At the top of the `createEventHook` function (or wherever `statesBySessionId` is defined), add a MAX bound consistent with create-hooks.ts patterns:

```typescript
const MAX_SESSION_STATES = 500

// When setting a new entry:
function setSessionState(sessionId: string, state: AuditState): void {
  if (statesBySessionId.size >= MAX_SESSION_STATES && !statesBySessionId.has(sessionId)) {
    const oldest = statesBySessionId.keys().next().value
    if (oldest) statesBySessionId.delete(oldest)
  }
  statesBySessionId.set(sessionId, state)
}
```

Replace all direct `statesBySessionId.set(sessionId, state)` calls with `setSessionState(sessionId, state)`.

- [ ] **Step 2: Run tests**

Run: `bun test src/hooks/event-hook.test.ts --no-timeout`
Expected: ALL pass.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/event-hook.ts
git commit -m "fix: bound statesBySessionId map to prevent unbounded memory growth"
```

---

## Task 12: Fix M7 — `audit-pdf-extract.ts` import guard

**Priority:** Medium
**Files:**
- Modify: `scripts/audit-pdf-extract.ts` (last line)

**Note from exploration:** The explorer reported the file already has `await main()` at the end. However, this is a bare call — not guarded by `import.meta.main`. Fix it.

- [ ] **Step 1: Wrap in guard**

At the bottom of `scripts/audit-pdf-extract.ts`, change:

```typescript
// Before:
await main()

// After:
if (import.meta.main) {
  await main()
}
```

- [ ] **Step 2: Run tests**

Run: `bun test scripts/audit-pdf-extract.test.ts --no-timeout`
Expected: ALL pass (tests import the file; without the guard they'd trigger main()).

- [ ] **Step 3: Commit**

```bash
git add scripts/audit-pdf-extract.ts
git commit -m "fix: guard audit-pdf-extract main() with import.meta.main"
```

---

## Task 13: Extract shared `PHASE_ORDER` (L8 DRY)

**Priority:** Low
**Files:**
- Create: `src/shared/audit-phases.ts`
- Modify: `src/hooks/tool-tracking-hook.ts:482-491`
- Modify: `src/features/audit-enforcer/audit-enforcer.ts:3-12`

- [ ] **Step 1: Create shared constant**

Create `src/shared/audit-phases.ts`:

```typescript
import type { AuditPhase } from "../state/types"

export const PHASE_ORDER: readonly AuditPhase[] = [
  "reconnaissance",
  "scanning",
  "manual-review",
  "attack-surface",
  "research",
  "testing",
  "reporting",
  "complete",
] as const
```

- [ ] **Step 2: Replace in tool-tracking-hook.ts**

Remove lines 482-491 and add import:

```typescript
import { PHASE_ORDER } from "../shared/audit-phases"
```

- [ ] **Step 3: Replace in audit-enforcer.ts**

Remove lines 3-12 and add import:

```typescript
import { PHASE_ORDER } from "../../shared/audit-phases"
```

- [ ] **Step 4: Run tests**

Run: `bun test src/hooks/tool-tracking-hook.test.ts src/features/audit-enforcer/audit-enforcer.test.ts --no-timeout`
Expected: ALL pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/audit-phases.ts src/hooks/tool-tracking-hook.ts src/features/audit-enforcer/audit-enforcer.ts
git commit -m "refactor: extract PHASE_ORDER to shared module — DRY"
```

---

## Task 14: Use `isArgusFamily` from shared module (L8 DRY)

**Priority:** Low
**Files:**
- Modify: `src/hooks/tool-tracking-hook.ts:823-833`

- [ ] **Step 1: Replace inline agent check**

In `src/hooks/tool-tracking-hook.ts:328-335`, the inline check is:

```typescript
(reportedByAgentRaw === "argus" ||
  reportedByAgentRaw === "sentinel" ||
  reportedByAgentRaw === "pythia" ||
  reportedByAgentRaw === "scribe" ||
  reportedByAgentRaw === "unknown")
```

Replace with the shared helper. Note: `"unknown"` is not in `ARGUS_FAMILY`, handle explicitly:

```typescript
import { isArgusFamily } from "../shared/agent-names"

// Replace inline check with:
(isArgusFamily(reportedByAgentRaw) || reportedByAgentRaw === "unknown")
```

- [ ] **Step 2: Run tests**

Run: `bun test src/hooks/tool-tracking-hook.test.ts --no-timeout`
Expected: ALL pass.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/tool-tracking-hook.ts
git commit -m "refactor: use isArgusFamily from shared module instead of inline agent checks"
```

---

## Task 15: Extract shared `emitToSink` (L8 DRY)

**Priority:** Low
**Files:**
- Create: `src/shared/safe-emit.ts`
- Modify: `src/hooks/tool-tracking-hook.ts:110-125`
- Modify: `src/hooks/event-hook.ts:143-167`

The two `emitToSink` functions have slightly different signatures — tool-tracking-hook takes an `AuditEvent` object, event-hook constructs the event inline. The shared version should take the pre-built event.

- [ ] **Step 1: Create shared emit utility**

Create `src/shared/safe-emit.ts`:

```typescript
import type { AuditEvent, EventSink } from "../state/types"
import { formatError } from "./format-error"
import { createLogger } from "./logger"

const logger = createLogger()

export async function safeEmitToSink(
  sink: EventSink | null,
  event: AuditEvent,
  options?: { failFast?: boolean },
): Promise<void> {
  if (!sink) return
  try {
    await sink.append(event)
  } catch (error) {
    const message = `Failed to emit ${event.type} event to sink: ${formatError(error)}`
    logger.error(message)

    if (options?.failFast) {
      throw new Error(message)
    }
  }
}
```

- [ ] **Step 2: Replace in both hooks**

In `tool-tracking-hook.ts`, replace the local `emitToSink` with an import:

```typescript
import { safeEmitToSink } from "../shared/safe-emit"
```

In `event-hook.ts`, refactor the local `emitToSink` to build the event then call `safeEmitToSink`:

```typescript
import { safeEmitToSink } from "../shared/safe-emit"

async function emitToSink(
  sink: EventSink | null,
  type: AuditEvent["type"],
  runId: string,
  sessionId: string | undefined,
  payload: unknown,
): Promise<void> {
  if (!sink) return
  await safeEmitToSink(sink, {
    type,
    run_id: runId,
    seq: 0,
    session_id: sessionId ?? "",
    source: "event-hook",
    schema_version: SCHEMA_VERSION,
    timestamp: Date.now(),
    payload,
  })
}
```

- [ ] **Step 3: Run tests**

Run: `bun test src/hooks/tool-tracking-hook.test.ts src/hooks/event-hook.test.ts --no-timeout`
Expected: ALL pass.

- [ ] **Step 4: Commit**

```bash
git add src/shared/safe-emit.ts src/hooks/tool-tracking-hook.ts src/hooks/event-hook.ts
git commit -m "refactor: extract safeEmitToSink to shared module — DRY"
```

---

## Task 16: Run full test suite and verify

**Priority:** Required
**Files:** None (verification only)

- [ ] **Step 1: Run full suite**

Run: `bun test --no-timeout`
Expected: ALL tests pass (1396+).

- [ ] **Step 2: Run linter if available**

Run: `bunx biome check src/`
Expected: No new errors.

- [ ] **Step 3: Commit any remaining fixes**

If any tests fail, fix and commit incrementally.

---

## Not addressed in this plan (tracked as backlog)

These items from the review are acknowledged but deferred — they require architectural changes or have very low practical impact:

| Item | Reason deferred |
|------|----------------|
| **L2** `withSuppressedParentOutput` concurrency | Only wraps synchronous `Bun.spawn`; would need architectural rethink of solodit lifecycle |
| **L3** `provenance.phase` enum validation | Low impact — invalid strings don't cause crashes, just unclean data |
| **L4** SCVD sync lock cross-process | Would need file-based locking; low impact with single-editor usage |
| **L5** Finding ID 64-bit truncation | Theoretical; would break all existing IDs if changed |
| **L7** 66% skills lack frontmatter | Batch frontmatter addition is content work, not code |
| **L9** `create-hooks.ts` god function | Major refactor; should be its own dedicated plan |
| **L10** Module-level state in solodit-lifecycle | Architectural; already has `_resetSoloditState()` for tests |
| **L11** `isAuditState` loose type guard | Low impact; corrupt data is caught downstream |
| **L8** `formatError` usage (30+ inline patterns) | Mechanical find-and-replace; low risk, do separately |
| **M8** Background manager tasks Map pruning | Exploration showed `tasks` is function-scoped, not module-level; impact is per-session only |
| **M9** orphanBuffer per-session cap | Has per-session cap (50); global cap is low priority |
