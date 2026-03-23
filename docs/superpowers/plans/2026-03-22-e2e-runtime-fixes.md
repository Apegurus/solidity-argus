# E2E Runtime Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 runtime bugs found during E2E testing — absolute path normalization dead code, missing title→check alias, and child session coalescence race.

**Architecture:** Fix #1 (title→check) and #2 (projectDir threading) are in the adapter/normalization layer. Fix #3 (coalescence race) is in the session activation orchestrator. All fixes are independent and can be done in any order.

**Tech Stack:** Bun, TypeScript, `bun test`

---

## File Structure

### Modified files

| File | What changes |
|------|-------------|
| `src/state/adapters.ts` | Add `title`/`name` → `check`, `location` → `file`+`lines` aliases |
| `src/hooks/tool-tracking-hook.ts` | Accept `projectDir` option, pass to `normalizeToCanonicalFinding` |
| `src/tools/record-finding-tool.ts` | Pass `context.directory` as `projectDir` to `normalizeToCanonicalFinding` |
| `src/create-hooks.ts` | Add fallback: inherit parent run ID for child session coalescence |
| `src/agents/argus-prompt.ts` | Remove incorrect "will fail validation" warning for title/location — aliases now accepted |
| `src/agents/sentinel-prompt.ts` | Same prompt fix |
| `src/tools/record-finding-tool.ts` | Update tool description to reflect accepted aliases |

### Test files

| File | What |
|------|------|
| `src/state/schemas.test.ts` | Tests for title→check and name→check aliases |
| `src/hooks/tool-tracking-hook.test.ts` | Test that projectDir is forwarded to normalization |
| `src/tools/record-finding-tool.test.ts` | Test that projectDir is forwarded |
| `src/create-hooks.test.ts` | Test that deferred child activation works |

---

## Task 1: Add `title`→`check` and `name`→`check` aliases to adapters

**Priority:** Highest user-facing impact — findings silently dropped
**Files:**
- Modify: `src/state/adapters.ts:27-64` (KNOWN_INPUT_FIELDS) and `src/state/adapters.ts:167-172` (check fallback)
- Test: `src/state/schemas.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/state/schemas.test.ts`:

```typescript
test("normalizes title alias to check", () => {
  const raw = {
    title: "reentrancy-eth",
    severity: "High",
    confidence: "High",
    description: "Reentrancy in withdraw",
    file: "src/Vault.sol",
    lines: [10, 20],
    source: "manual",
  }
  const result = normalizeToCanonicalFinding(raw, "run-title", 1)
  expect(result.data.check).toBe("reentrancy-eth")
  expect(result.diagnostics.filter((d) => d.code === "field.dropped" && d.field === "title")).toHaveLength(0)
})

test("normalizes name alias to check", () => {
  const raw = {
    name: "unchecked-transfer",
    severity: "Medium",
    confidence: "Medium",
    description: "Unchecked return value",
    file: "src/Token.sol",
    lines: [5, 10],
    source: "manual",
  }
  const result = normalizeToCanonicalFinding(raw, "run-name", 1)
  expect(result.data.check).toBe("unchecked-transfer")
  expect(result.diagnostics.filter((d) => d.code === "field.dropped" && d.field === "name")).toHaveLength(0)
})

test("check field takes precedence over title alias", () => {
  const raw = {
    check: "the-real-check",
    title: "should-be-ignored",
    severity: "Low",
    confidence: "Low",
    description: "test",
    file: "src/A.sol",
    lines: [1, 2],
    source: "manual",
  }
  const result = normalizeToCanonicalFinding(raw, "run-precedence", 1)
  expect(result.data.check).toBe("the-real-check")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/state/schemas.test.ts -t "title alias" --no-timeout`
Expected: FAIL — `check` is empty string because `title` is dropped as unknown field.

- [ ] **Step 3: Add `title`, `name`, and `location` to KNOWN_INPUT_FIELDS**

In `src/state/adapters.ts`, add to the `KNOWN_INPUT_FIELDS` set (around line 30, after `"detector"`):

```typescript
const KNOWN_INPUT_FIELDS = new Set([
  "id",
  "check",
  "detector",
  "title",      // alias for check
  "name",       // alias for check
  "severity",
  // ... existing fields ...
  "elements",
  "location",   // alias for file + lines (e.g. "src/Vault.sol:10-15")
])
```

- [ ] **Step 4: Add `title` and `name` to the check fallback chain**

In `src/state/adapters.ts`, modify the `check` resolution (lines 167-172):

```typescript
const check =
  typeof input.check === "string" && input.check.length > 0
    ? input.check
    : typeof input.detector === "string" && input.detector.length > 0
      ? input.detector
      : typeof input.title === "string" && input.title.length > 0
        ? input.title
        : typeof input.name === "string" && input.name.length > 0
          ? input.name
          : ""
```

- [ ] **Step 5: Add `location` → `file` + `lines` alias**

Add a helper function above `normalizeToCanonicalFinding`:

```typescript
function extractFileFromLocation(location: string): string {
  const colonIndex = location.lastIndexOf(":")
  if (colonIndex > 0) {
    const afterColon = location.substring(colonIndex + 1)
    if (/^\d+(-\d+)?$/.test(afterColon)) {
      return location.substring(0, colonIndex)
    }
  }
  return location
}
```

Then modify the `rawFile` resolution (line 184-188):

```typescript
const rawFile =
  typeof input.file === "string" && input.file.length > 0
    ? input.file
    : typeof input.location === "string" && input.location.length > 0
      ? extractFileFromLocation(input.location)
      : (slitherElementFileAlias(input) ?? "")
```

And after `normalizeLines` (line 190), add a fallback for extracting lines from `location`:

```typescript
let lines = normalizeLines(input.lines, input)
if (!lines && typeof input.location === "string") {
  const match = input.location.match(/:(\d+)(?:-(\d+))?$/)
  if (match) {
    const start = parseInt(match[1]!, 10)
    const end = match[2] ? parseInt(match[2], 10) : start
    lines = [start, end] as [number, number]
  }
}
```

Note: `normalizeLines` returns `undefined` (not `[0, 0]`) when no lines are found. The `[0, 0]` default is applied later at the canonical finding construction (line ~270). So `!lines` is the correct guard.

- [ ] **Step 6: Add location alias test**

Add to `src/state/schemas.test.ts`:

```typescript
test("normalizes location alias to file and lines", () => {
  const raw = {
    check: "reentrancy",
    description: "State after call",
    location: "src/Vault.sol:10-15",
    severity: "High",
  }
  const result = normalizeToCanonicalFinding(raw, "run-loc", 1)
  expect(result.data.file).toBe("src/Vault.sol")
  expect(result.data.lines).toEqual([10, 15])
  expect(result.diagnostics.filter((d) => d.code === "field.dropped" && d.field === "location")).toHaveLength(0)
})

test("location without line numbers uses full string as file", () => {
  const raw = {
    check: "test",
    description: "test",
    location: "src/Token.sol",
    severity: "Low",
  }
  const result = normalizeToCanonicalFinding(raw, "run-loc2", 1)
  expect(result.data.file).toBe("src/Token.sol")
})
```

- [ ] **Step 7: Run tests**

Run: `bun test src/state/schemas.test.ts --no-timeout`
Expected: ALL pass.

- [ ] **Step 8: Commit**

```bash
git add src/state/adapters.ts src/state/schemas.test.ts
git commit -m "fix: add title and name as aliases for check in finding normalization"
```

---

## Task 1b: Update prompts and tool description to reflect accepted aliases

**Priority:** Prevents future confusion — prompts currently say aliases "fail validation" but they're now accepted
**Files:**
- Modify: `src/agents/argus-prompt.ts` (~line 358)
- Modify: `src/agents/sentinel-prompt.ts` (~line 154)
- Modify: `src/tools/record-finding-tool.ts` (~line 185)

- [ ] **Step 1: Read the prompt files and find the warnings**

In `argus-prompt.ts`, find the line that says:
> "Do not use `title`, `location`, or other non-canonical field names — they will be silently dropped and the finding will fail validation."

In `sentinel-prompt.ts`, check for a similar warning. **Note:** This file may NOT have matching text — skip if no warning exists.

In `record-finding-tool.ts`, find line ~185:
> "Do NOT use title, location, or other non-canonical field names."

- [ ] **Step 2: Update to reflect that aliases are accepted but canonical names are preferred**

Replace the warnings with something like:

```
Preferred field names: `check`, `file`, `lines`. The aliases `title`/`name` → `check` and `location` → `file` are accepted but the canonical names above are preferred.
```

The key change: remove "will fail validation" / "silently dropped" language since aliases now work. Keep the preference for canonical names to reduce unnecessary normalization.

- [ ] **Step 3: Commit**

```bash
git add src/agents/argus-prompt.ts src/agents/sentinel-prompt.ts src/tools/record-finding-tool.ts
git commit -m "docs(prompts): update finding field guidance — aliases now accepted, canonical names preferred"
```

---

## Task 2: Thread `projectDir` through `normalizeToCanonicalFinding` callers

**Priority:** Causes absolute paths in report findings
**Files:**
- Modify: `src/hooks/tool-tracking-hook.ts:496-500` (add projectDir to options) and `:894` (pass it)
- Modify: `src/tools/record-finding-tool.ts:106` (pass context.directory)
- Test: `src/hooks/tool-tracking-hook.test.ts`
- Test: `src/tools/record-finding-tool.test.ts`

- [ ] **Step 1: Write failing test for tool-tracking-hook**

Add to `src/hooks/tool-tracking-hook.test.ts`:

```typescript
test("normalizes absolute file paths to project-relative in findings", async () => {
  const projectDir = "/home/user/project"
  const hookWithDir = createToolTrackingHook(() => auditState, undefined, {
    projectDir,
  })

  const slitherResult = {
    findings: [
      {
        check: "reentrancy-eth",
        severity: "High",
        confidence: "High",
        description: "test",
        file: "/home/user/project/src/Vault.sol",
        lines: [10, 20],
        source: "slither",
      },
    ],
  }

  await hookWithDir({
    tool: "argus_slither_analyze",
    args: { target: "." },
    result: JSON.stringify(slitherResult),
  })

  expect(auditState.findings[0]?.file).toBe("src/Vault.sol")
})
```

Check the existing test file to see how `createToolTrackingHook` is called and what `ToolTrackingOptions` looks like. Adapt accordingly.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/hooks/tool-tracking-hook.test.ts -t "normalizes absolute" --no-timeout`
Expected: FAIL — file is still the absolute path.

- [ ] **Step 3: Add `projectDir` to `ToolTrackingOptions`**

In `src/hooks/tool-tracking-hook.ts`, find the `ToolTrackingOptions` type (or create it if inline) and add:

```typescript
interface ToolTrackingOptions {
  // ... existing fields
  projectDir?: string
}
```

In `createToolTrackingHook`, destructure it:

```typescript
export function createToolTrackingHook(
  getAuditState: (sessionId?: string) => AuditState | null,
  onStateChanged?: (metadata: ToolExecutionMetadata) => void,
  options?: ToolTrackingOptions,
): ToolTrackingHook {
  const projectDir = options?.projectDir
```

- [ ] **Step 4: Pass `projectDir` to `normalizeToCanonicalFinding`**

At the call site (around line 894), add the 5th argument:

```typescript
const { data: canonical } = normalizeToCanonicalFinding(finding, runId, 0, {
  reportedByAgent,
  reportedBySessionId: sessionId,
  toolCallId,
  observationId: `${toolCallId}:${index + 1}`,
}, projectDir)
```

- [ ] **Step 5: Pass `projectDir` from create-hooks.ts**

In `src/create-hooks.ts`, where `createToolTrackingHook` is called (find the call site), pass `projectDir` from the `createHooks` args:

```typescript
createToolTrackingHook(
  getAuditState,
  onStateChanged,
  {
    // ... existing options
    projectDir,
  },
)
```

- [ ] **Step 6: Pass `projectDir` in record-finding-tool**

In `src/tools/record-finding-tool.ts:106`, add the 5th argument. The `ToolContext` has a `directory` property. Compute `projectDir` once before the loop:

```typescript
// In executeRecordFinding, before the for loop:
const projectDir = context.directory ?? process.cwd()

// At line 106, add 5th argument:
const normalized = normalizeToCanonicalFinding(rawFinding, runId, index + 1, {
  reportedByAgent,
  reportedBySessionId,
  observationId: `${reportedBySessionId}:${index + 1}`,
}, projectDir)
```

- [ ] **Step 7: Run tests**

Run: `bun test src/hooks/tool-tracking-hook.test.ts src/tools/record-finding-tool.test.ts --no-timeout`
Expected: ALL pass.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/tool-tracking-hook.ts src/tools/record-finding-tool.ts src/create-hooks.ts \
  src/hooks/tool-tracking-hook.test.ts src/tools/record-finding-tool.test.ts
git commit -m "fix: thread projectDir to normalizeToCanonicalFinding — absolute paths now normalized"
```

---

## Task 3: Fix child session coalescence timing race

**Priority:** Most complex — causes fragmented audit trails
**Files:**
- Modify: `src/create-hooks.ts:307-319` (activateSession existingSink resolution)

### Problem

When a parent launches a child session via the `task` tool:
1. `onChildSessionDetected` fires (line 834) and records the parent-child relationship via `agentTracker.trackChildSession`
2. It tries to register the child with the parent's sink (line 838-844)
3. **BUT** if the parent's sink isn't in `eventSinksByOpencodeSession` yet, the child registration is skipped
4. When the child's `activateSession` runs, `getParentSession` returns the parent ID, but `eventSinksByOpencodeSession.get(parentSessionId)` returns `undefined`
5. The child falls through to the single-active-sink heuristic or creates its own sink — divergent run ID

### Fix: Inherit parent run ID via audit state

Instead of adding a complex deferred queue, add a fallback in `activateSession`: if no existing sink is found but the parent session has an audit state with a run ID, inherit that run ID and look up the sink by run ID in `eventSinksByRunId`. This is simpler and deterministic — the parent's audit state is available even when its sink map entry isn't.

- [ ] **Step 1: Add fallback lookup in activateSession**

In `src/create-hooks.ts`, in the `activateSession` function, after the `existingSink` IIFE resolution (around line 307-319), add a second resolution attempt before the sink creation path:

```typescript
const existingSink = (() => {
  // ... existing resolution logic (lines 307-319, unchanged) ...
})()

// If existingSink is null but we know the parent, try inheriting the parent's run ID
if (!existingSink) {
  const parentSessionId = agentTracker.getParentSession(sessionId)
  if (parentSessionId) {
    const parentState = getAuditState(parentSessionId)
    if (parentState && parentState.sessionId.length > 0) {
      const parentSink = eventSinksByRunId.get(parentState.sessionId)
      if (parentSink && !parentSink.isFinalized) {
        // Found parent's sink via run ID — coalesce
        setEventSink(parentSink, sessionId)
        setBoundedSink(eventSinksByOpencodeSession, sinkCreatedAtBySession, sessionId, parentSink)
        setBoundedSink(eventSinksByRunId, sinkCreatedAtByRunId, parentSink.runId, parentSink)

        if (auditState) {
          setAuditState({ ...auditState, sessionId: parentSink.runId }, sessionId)
        }
        runJournal.log({ type: "state.loaded", timestamp, success: true, findingsCount: 0 })
        sessionActivated = true
        return
      }
    }
  }
}

if (existingSink) {
  // ... existing existingSink handling ...
```

**Important:** This block goes BETWEEN the `existingSink` IIFE and the `if (existingSink)` check. It only fires when existingSink is null AND the parent relationship exists.

- [ ] **Step 2: Verify `trackChildSession` ordering**

The fallback depends on `agentTracker.getParentSession(sessionId)` returning the parent ID. This only works if `trackChildSession` was called BEFORE `activateSession` for the child.

Check: `onChildSessionDetected` (line 834) calls `agentTracker.trackChildSession()` synchronously from the `task` tool's `tool.execute.after` handler. The child's `activateSession` is called from `chat.params` — a separate event. Since `tool.execute.after` fires before the child's `chat.params` (the tool result must be processed before the child session starts), the ordering is guaranteed.

Read `create-hooks.ts` to confirm `onChildSessionDetected` fires from `tool.execute.after` (via tool-tracking-hook), and `activateSession` fires from `chat.params`. If the ordering is NOT guaranteed, add a defensive `await` or queue.

- [ ] **Step 3: Write unit test for the fallback path**

Add to `src/create-hooks.test.ts`:

```typescript
test("child session inherits parent sink via eventSinksByRunId when direct lookup misses", async () => {
  // This test verifies the coalescence fallback: parent sink is in eventSinksByRunId
  // but NOT in eventSinksByOpencodeSession when the child tries to activate
  // The exact setup depends on how createHooks test harness works — read existing
  // tests to understand how sessions are activated and sinks are created.
  // Key assertion: after child activation, child's audit state sessionId matches parent's run ID
})
```

Adapt to match existing test patterns. The test should:
1. Activate a parent session (creates a sink, registers in eventSinksByRunId)
2. Register a child session via agentTracker.trackChildSession
3. Remove the parent from eventSinksByOpencodeSession (simulating the race)
4. Activate the child session
5. Assert the child's sink matches the parent's

- [ ] **Step 4: Run tests**

Run: `bun test src/create-hooks.test.ts --no-timeout`
Expected: ALL pass.

- [ ] **Step 5: Run full suite**

Run: `bun test --no-timeout`
Expected: ALL 1414+ tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/create-hooks.ts src/create-hooks.test.ts
git commit -m "fix: inherit parent run ID for child session coalescence — prevents fragmented audit trail"
```

---

## Task 4: Run full test suite and verify

**Priority:** Required
**Files:** None (verification only)

- [ ] **Step 1: Run full suite**

Run: `bun test --no-timeout`
Expected: ALL tests pass.

- [ ] **Step 2: Run type check**

Run: `bunx tsc --noEmit`
Expected: No new type errors from our changes (especially the new `projectDir` parameter threading).

- [ ] **Step 3: Commit any remaining fixes**

If any tests or type errors, fix and commit.
