import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resetSinkRegistry } from "../features/persistent-state/event-sink"
import type { createRunJournal } from "../features/persistent-state/run-journal"
import type { AuditStateManager } from "../managers/types"
import type { Logger } from "../shared/logger"
import { createAuditState } from "../state/audit-state"
import { createBoundedSinkRegistry } from "./bounded-sink-registry"
import { createSessionActivator } from "./session-activation"

const SESSION_ID = "ses_test_activation"

const silentLogger: Logger = {
  info() {},
  debug() {},
  error() {},
  warn() {},
}

function stubManager(): AuditStateManager {
  return {
    bindSession() {},
    async load() {
      return null
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

function makeHarness(opts: { failSinkSetup?: boolean } = {}) {
  const projectDir = mkdtempSync(join(tmpdir(), "argus-session-activation-"))
  const activatedSessions = new Set<string>()
  const auditStates = new Map<string, ReturnType<typeof createAuditState>["state"]>()
  const sinkRegistry = createBoundedSinkRegistry({ maxSinks: 10, ttlMs: 60 * 60 * 1000 })

  const activate = createSessionActivator({
    projectDir,
    agentTracker: { getParentSession: () => undefined },
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
    getSessionManager: () => stubManager(),
    runJournal: { log: () => {} } as unknown as ReturnType<typeof createRunJournal>,
    logger: silentLogger,
    activatedSessions,
    pendingActivations: new Set<string>(),
    pendingSinkCreations: new Set<string>(),
  })

  return { projectDir, activate, activatedSessions, auditStates }
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
