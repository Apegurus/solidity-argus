import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type EventSink, resetSinkRegistry } from "../features/persistent-state/event-sink"
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

function stubManager(
  recovered: AuditState | null = null,
  load: (() => Promise<AuditState | null>) | undefined = undefined,
): AuditStateManager {
  return {
    bindSession() {},
    load: load ?? (async () => recovered),
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
    state: "ACTIVE",
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
    async readAll() {
      return []
    },
    markDraining() {},
    markFailedRecoverable() {},
  }
}

function makeDelayedAppendSink(
  runId: string,
  appendStarted: () => void,
  waitForAppend: Promise<void>,
): EventSink {
  const ownerSet = new Set<string>()
  return {
    runId,
    state: "ACTIVE",
    ownerSet,
    isFinalized: false,
    addOwner: (sessionId: string) => ownerSet.add(sessionId),
    removeOwner: (sessionId: string) => ownerSet.delete(sessionId),
    markFinalized() {},
    async append() {
      appendStarted()
      await waitForAppend
    },
    async readAll() {
      return []
    },
    markDraining() {},
    markFailedRecoverable() {},
  }
}

function makeHarness(
  opts: {
    failSinkSetup?: boolean
    failAppend?: boolean
    recoveredState?: AuditState
    parents?: Record<string, string>
    isSessionDeleted?: (sessionId: string) => boolean
    load?: () => Promise<AuditState | null>
    createEventSink?: (runId: string) => EventSink
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
    getSessionManager: () => stubManager(opts.recoveredState ?? null, opts.load),
    runJournal: {
      log() {},
      async close() {},
      getPath: () => join(projectDir, "argus-journal.jsonl"),
    },
    logger: silentLogger,
    activatedSessions,
    pendingActivations: new Set<string>(),
    isSessionDeleted: opts.isSessionDeleted ?? (() => false),
    ...(opts.createEventSink
      ? { createEventSink: opts.createEventSink }
      : opts.failAppend
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

test("starts a fresh run when an activated session loses its run sink", async () => {
  const h = makeHarness()
  h.auditStates.set(SESSION_ID, createAuditState(h.projectDir).state)
  try {
    await h.activate(SESSION_ID)
    const priorRunId = h.auditStates.get(SESSION_ID)?.sessionId
    expect(priorRunId).toBeDefined()

    h.sinkRegistry.deleteRun(priorRunId ?? "")
    await h.activate(SESSION_ID)

    expect(h.auditStates.get(SESSION_ID)?.sessionId).not.toBe(priorRunId)
  } finally {
    rmSync(h.projectDir, { recursive: true, force: true })
  }
})

test("does not restore a session deleted while activation is in flight", async () => {
  let markLoadStarted: () => void = () => {}
  const loadStarted = new Promise<void>((resolve) => {
    markLoadStarted = resolve
  })
  let completeLoad: () => void = () => {}
  const load = new Promise<void>((resolve) => {
    completeLoad = resolve
  })
  let sessionDeleted = false
  const h = makeHarness({
    isSessionDeleted: () => sessionDeleted,
    load: async () => {
      markLoadStarted()
      await load
      return null
    },
  })
  const state = createAuditState(h.projectDir).state
  h.auditStates.set(SESSION_ID, state)

  try {
    const activation = h.activate(SESSION_ID)
    await loadStarted
    sessionDeleted = true
    completeLoad()
    await activation

    expect(h.activatedSessions.has(SESSION_ID)).toBe(false)
    expect(h.sinkRegistry.getForSession(SESSION_ID)).toBeUndefined()
    expect(h.sinkRegistry.getForRun(state.sessionId)).toBeUndefined()
  } finally {
    rmSync(h.projectDir, { recursive: true, force: true })
  }
})

test("rolls back a sink when deletion occurs during the durable activation append", async () => {
  let markAppendStarted: () => void = () => {}
  const appendStarted = new Promise<void>((resolve) => {
    markAppendStarted = resolve
  })
  let completeAppend: () => void = () => {}
  const waitForAppend = new Promise<void>((resolve) => {
    completeAppend = resolve
  })
  let sessionDeleted = false
  const h = makeHarness({
    isSessionDeleted: () => sessionDeleted,
    createEventSink: (runId) => makeDelayedAppendSink(runId, markAppendStarted, waitForAppend),
  })
  const state = createAuditState(h.projectDir).state
  h.auditStates.set(SESSION_ID, state)

  try {
    const activation = h.activate(SESSION_ID)
    await appendStarted
    sessionDeleted = true
    completeAppend()
    await activation

    expect(h.activatedSessions.has(SESSION_ID)).toBe(false)
    expect(h.sinkRegistry.getForSession(SESSION_ID)).toBeUndefined()
    expect(h.sinkRegistry.getForRun(state.sessionId)).toBeUndefined()
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
