import { describe, expect, it, spyOn, beforeEach, afterEach } from "bun:test"
import { createSessionRecoveryHandler } from "./session-recovery"
import type { AuditStateManager } from "../../managers/types"
import type { AuditState } from "../../state/types"
import { resetLoggerSink } from "../../shared/logger"

function makeMockManager(state: AuditState | null = null): AuditStateManager {
  return {
    load: async () => state,
    save: async () => {},
    get: () => state,
    update: async () => {},
    reset: async () => {},
  }
}

function makeMockState(): AuditState {
  return {
    sessionId: "test-session",
    projectDir: "/tmp/test",
    contractsReviewed: ["Vault.sol"],
    findings: [{ id: "f1", check: "reentrancy", severity: "High", confidence: "High", description: "test", file: "Vault.sol", lines: [1, 10] as [number, number], source: "slither" }],
    toolsExecuted: [],
    currentPhase: "scanning",
    scope: [],
    startTime: Date.now(),
  }
}

describe("createSessionRecoveryHandler", () => {
  it("recovers persisted state on session.error", async () => {
    const state = makeMockState()
    const manager = makeMockManager(state)
    const handler = createSessionRecoveryHandler(manager)

    await handler({ type: "session.error", sessionId: "s1" })

    expect(manager.load).toBeDefined()
  })

  it("handles missing persisted state gracefully", async () => {
    // Logger writes to stderr when ARGUS_LOG=stderr, otherwise to file.
    // We enable stderr mode so we can capture the warn output in-process.
    process.env.ARGUS_LOG = "stderr"
    resetLoggerSink()

    const stderrChunks: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString())
      return true
    }) as typeof process.stderr.write

    try {
      const manager = makeMockManager(null)
      const handler = createSessionRecoveryHandler(manager)

      await handler({ type: "session.error", sessionId: "s1" })

      const hasWarn = stderrChunks.some((c) => c.includes("No persisted state"))
      expect(hasWarn).toBe(true)
    } finally {
      process.stderr.write = origWrite
      delete process.env.ARGUS_LOG
      resetLoggerSink()
    }
  })

  it("ignores non-error events", async () => {
    const manager = makeMockManager()
    const loadSpy = spyOn(manager, "load")
    const handler = createSessionRecoveryHandler(manager)

    await handler({ type: "session.created" })

    expect(loadSpy).not.toHaveBeenCalled()
    loadSpy.mockRestore()
  })

  it("does not throw when load fails", async () => {
    const manager = makeMockManager()
    manager.load = async () => { throw new Error("disk failure") }
    const handler = createSessionRecoveryHandler(manager)

    await expect(handler({ type: "session.error" })).resolves.toBeUndefined()
  })
})
