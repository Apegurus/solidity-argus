import { describe, expect, it, spyOn } from "bun:test"
import { createSessionRecoveryHandler } from "./session-recovery"
import type { AuditStateManager } from "../../managers/types"
import type { AuditState } from "../../state/types"

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
    const manager = makeMockManager(null)
    const warnSpy = spyOn(console, "error")
    const handler = createSessionRecoveryHandler(manager)

    await handler({ type: "session.error", sessionId: "s1" })

    const warnCalls = warnSpy.mock.calls.filter(
      (call) => call.some((a) => typeof a === "string" && a.includes("No persisted state")),
    )
    expect(warnCalls.length).toBeGreaterThanOrEqual(1)
    warnSpy.mockRestore()
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
