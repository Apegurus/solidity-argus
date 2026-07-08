import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type EventSink, resetSinkRegistry } from "../features/persistent-state/event-sink"
import type { createRunJournal } from "../features/persistent-state/run-journal"
import type { AuditStateManager } from "../managers/types"
import type { Logger } from "../shared/logger"
import { createAuditState } from "../state/audit-state"
import type { AuditState } from "../state/types"
import { createBoundedSinkRegistry } from "./bounded-sink-registry"
import { createSessionActivator } from "./session-activation"

const SESSION_ID = "ses_test_activation"

const silentLogger: Logger = {
  info() {},
  debug() {},
  error() {},
  warn() {},
}

function stubManager(recovered: AuditState | null = null): AuditStateManager {
  return {
    bindSession() {},
    async load() {
      return recovered
    },
    async save() {},
    get() {
      return null
    },
    async update() {},
    async reset() {},
    async archive() {},
    async dispose() {},
  }
}

function makeFailingAppendSink(runId: string): EventSink {
  const ownerSet = new Set<string>()
  return {
    runId,
    ownerSet,
    isFinalized: false,
    addOwner: (s: string) => {
      ownerSet.add(s)
    },
    removeOwner: (s: string) => {
      ownerSet.delete(s)
    },
    markFinalized: () => {},
    append: async () => {
      throw new Error("durable append failed")
    },
  } as unknown as EventSink
}

function makeHarness(
  opts: {
    failSinkSetup?: boolean
    failAppend?: boolean
    recoveredState?: AuditState
    parents?: Record<string, string>
  } = {},
) {
  const projectDir = mkdtempSync(join(tmpdir(), "argus-session-activation-"))
  const activatedSessions = new Set<string>()
  const auditStates = new Map<string, ReturnType<typeof createAuditState>["state"]>()
  const sinkRegistry = createBoundedSinkRegistry({ maxSinks: 10, ttlMs: 60 * 60 * 1000 })

  const activate = createSessionActivator({
    projectDir,
    agentTracker: { getParentSession: (sid: string) => opts.parents?.[sid] },
    sinkRegistry,
    getAuditState: (sid) => auditStates.get(sid ?? "") ?? null,
    setAuditState: (state, sid) => {
      if (state) {
        auditStates.set(sid ?? "", state)
      } else {
        auditStates.delete(sid ?? "")
      }
    },
    setEventSink: opts.failSinkSetup
      ? (sink) => {
          if (sink !== null) {
            throw new Error("sink setup failed")
          }
        }
      : () => {},
    getSessionManager: () => stubManager(opts.recoveredState ?? null),
    runJournal: { log: () => {} } as unknown as ReturnType<typeof createRunJournal>,
    logger: silentLogger,
    activatedSessions,
    pendingActivations: new Set<string>(),
    pendingSinkCreations: new Set<string>(),
    ...(opts.failAppend
      ? { createEventSink: (runId: string) => makeFailingAppendSink(runId) }
      : {}),
  })

  return { projectDir, activate, activatedSessions, auditStates, sinkRegistry }
}

afterEach(() => {
  resetSinkRegistry()
})

test("does NOT mark a session activated when sink setup fails (WS-3 I5)", async () => {
  const h = makeHarness({ failSinkSetup: true })
  h.auditStates.set(SESSION_ID, createAuditState(h.projectDir).state)
  try {
    await h.activate(SESSION_ID)
    expect(h.activatedSessions.has(SESSION_ID)).toBe(false)
  } finally {
    rmSync(h.projectDir, { recursive: true, force: true })
  }
})

test("rolls back the run-level sink registration when the durable append fails (adj_8)", async () => {
  const h = makeHarness({ failAppend: true })
  const state = createAuditState(h.projectDir).state
  h.auditStates.set(SESSION_ID, state)
  try {
    await h.activate(SESSION_ID)
    expect(h.activatedSessions.has(SESSION_ID)).toBe(false)
    expect(h.sinkRegistry.getForRun(state.sessionId)).toBeUndefined()
  } finally {
    rmSync(h.projectDir, { recursive: true, force: true })
  }
})

test("marks a session activated once the durable sink is established", async () => {
  const h = makeHarness()
  h.auditStates.set(SESSION_ID, createAuditState(h.projectDir).state)
  try {
    await h.activate(SESSION_ID)
    expect(h.activatedSessions.has(SESSION_ID)).toBe(true)
  } finally {
    rmSync(h.projectDir, { recursive: true, force: true })
  }
})

test("resumes a recovered post-report run under its original identity (WS-3 I4/I10)", async () => {
  const recovered = createAuditState("/recovered-project").state
  recovered.sessionId = "original-run-id"
  const startTime = Date.now() - 60_000
  recovered.startTime = startTime
  recovered.reportGenerated = true

  const h = makeHarness({ recoveredState: recovered })
  h.auditStates.set(SESSION_ID, createAuditState(h.projectDir).state)

  try {
    await h.activate(SESSION_ID)
    const effective = h.auditStates.get(SESSION_ID)
    expect(effective?.sessionId).toBe("original-run-id")
    expect(effective?.startTime).toBe(startTime)
  } finally {
    rmSync(h.projectDir, { recursive: true, force: true })
  }
})

test("does nothing when the session has no audit state", async () => {
  const h = makeHarness()
  try {
    await h.activate(SESSION_ID)
    expect(h.activatedSessions.has(SESSION_ID)).toBe(false)
    expect(h.auditStates.has(SESSION_ID)).toBe(false)
  } finally {
    rmSync(h.projectDir, { recursive: true, force: true })
  }
})

test("re-activating a session with a live (non-finalized) sink is a no-op", async () => {
  const h = makeHarness()
  h.auditStates.set(SESSION_ID, createAuditState(h.projectDir).state)
  try {
    await h.activate(SESSION_ID)
    const runId = h.auditStates.get(SESSION_ID)?.sessionId
    expect(h.activatedSessions.has(SESSION_ID)).toBe(true)

    await h.activate(SESSION_ID)
    expect(h.auditStates.get(SESSION_ID)?.sessionId).toBe(runId)
  } finally {
    rmSync(h.projectDir, { recursive: true, force: true })
  }
})

test("discards recovered state older than the 24h TTL and starts fresh", async () => {
  const recovered = createAuditState("/recovered-project").state
  recovered.sessionId = "stale-run-id"
  recovered.startTime = Date.now() - 25 * 60 * 60 * 1000

  const h = makeHarness({ recoveredState: recovered })
  h.auditStates.set(SESSION_ID, createAuditState(h.projectDir).state)
  const freshRunId = h.auditStates.get(SESSION_ID)?.sessionId
  try {
    await h.activate(SESSION_ID)
    expect(h.auditStates.get(SESSION_ID)?.sessionId).not.toBe("stale-run-id")
    expect(h.auditStates.get(SESSION_ID)?.sessionId).toBe(freshRunId)
  } finally {
    rmSync(h.projectDir, { recursive: true, force: true })
  }
})

test("a subagent session coalesces into its parent's active run sink", async () => {
  const parentId = "ses_parent_activation"
  const childId = "ses_child_activation"
  const h = makeHarness({ parents: { [childId]: parentId } })
  try {
    h.auditStates.set(parentId, createAuditState(h.projectDir).state)
    await h.activate(parentId)
    const parentRunId = h.auditStates.get(parentId)?.sessionId
    expect(h.activatedSessions.has(parentId)).toBe(true)

    h.auditStates.set(childId, createAuditState(h.projectDir).state)
    const childOwnRunId = h.auditStates.get(childId)?.sessionId
    await h.activate(childId)

    expect(h.activatedSessions.has(childId)).toBe(true)
    expect(h.auditStates.get(childId)?.sessionId).toBe(parentRunId)
    expect(h.auditStates.get(childId)?.sessionId).not.toBe(childOwnRunId)
  } finally {
    rmSync(h.projectDir, { recursive: true, force: true })
  }
})
