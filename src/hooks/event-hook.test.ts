import { test, expect, describe, beforeEach } from "bun:test"
import { createEventHook } from "./event-hook"
import type { AuditState, Finding } from "../state/types"

function makeState(overrides: Partial<AuditState> = {}): AuditState {
  return {
    sessionId: "test-session-1",
    projectDir: "/tmp/test-project",
    contractsReviewed: [],
    findings: [],
    toolsExecuted: [],
    currentPhase: "reconnaissance",
    scope: [],
    startTime: Date.now(),
    ...overrides,
  }
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "abc123",
    check: "reentrancy-eth",
    severity: "High",
    confidence: "High",
    description: "Reentrancy vulnerability",
    file: "src/Vault.sol",
    lines: [10, 20] as [number, number],
    source: "slither",
    ...overrides,
  }
}

describe("createEventHook", () => {
  let hook: ReturnType<typeof createEventHook>["hook"]
  let getAuditState: ReturnType<typeof createEventHook>["getAuditState"]
  let setAuditState: ReturnType<typeof createEventHook>["setAuditState"]

  beforeEach(() => {
    const result = createEventHook("/tmp/test-project")
    hook = result.hook
    getAuditState = result.getAuditState
    setAuditState = result.setAuditState
  })

  test("fresh state on session.created", async () => {
    expect(getAuditState()).toBeNull()
    await hook({ event: { type: "session.created" } })
    expect(getAuditState()).not.toBeNull()
  })

  test("state has correct initial values", async () => {
    await hook({ event: { type: "session.created" } })
    const state = getAuditState()
    expect(state).not.toBeNull()
    expect(state!.findings).toEqual([])
    expect(state!.contractsReviewed).toEqual([])
    expect(state!.toolsExecuted).toEqual([])
    expect(state!.currentPhase).toBe("reconnaissance")
    expect(state!.projectDir).toBe("/tmp/test-project")
    expect(typeof state!.sessionId).toBe("string")
    expect(state!.sessionId.length).toBeGreaterThan(0)
  })

  test("state preserved on session.idle", async () => {
    await hook({ event: { type: "session.created" } })
    const state = getAuditState()
    // Mutate state to simulate audit progress
    state!.findings.push(makeFinding())
    state!.contractsReviewed.push("Vault.sol")

    await hook({ event: { type: "session.idle" } })

    const afterIdle = getAuditState()
    expect(afterIdle).not.toBeNull()
    expect(afterIdle!.findings).toHaveLength(1)
    expect(afterIdle!.contractsReviewed).toContain("Vault.sol")
  })

  test("state cleared on session.deleted", async () => {
    await hook({ event: { type: "session.created" } })
    expect(getAuditState()).not.toBeNull()

    await hook({ event: { type: "session.deleted" } })
    expect(getAuditState()).toBeNull()
  })

  test("unknown event is no-op", async () => {
    await hook({ event: { type: "session.created" } })
    const stateBefore = getAuditState()

    // Should not throw
    await hook({ event: { type: "unknown.event" } })

    const stateAfter = getAuditState()
    expect(stateAfter).toBe(stateBefore)
  })

  test("multiple session.created overwrites previous state", async () => {
    await hook({ event: { type: "session.created" } })
    const firstState = getAuditState()
    const firstSessionId = firstState!.sessionId

    await hook({ event: { type: "session.created" } })
    const secondState = getAuditState()

    expect(secondState).not.toBeNull()
    expect(secondState!.sessionId).not.toBe(firstSessionId)
    expect(secondState!.findings).toEqual([])
  })

  test("setAuditState injects custom state", () => {
    const mockState = makeState({
      sessionId: "injected-session",
      currentPhase: "reporting",
      contractsReviewed: ["Token.sol"],
    })

    setAuditState(mockState)

    const retrieved = getAuditState()
    expect(retrieved).not.toBeNull()
    expect(retrieved!.sessionId).toBe("injected-session")
    expect(retrieved!.currentPhase).toBe("reporting")
    expect(retrieved!.contractsReviewed).toContain("Token.sol")
  })

  test("setAuditState with null clears state", () => {
    setAuditState(makeState())
    expect(getAuditState()).not.toBeNull()

    setAuditState(null)
    expect(getAuditState()).toBeNull()
  })

  test("session.error does not clear state", async () => {
    await hook({ event: { type: "session.created" } })
    const state = getAuditState()
    state!.findings.push(makeFinding())

    await hook({ event: { type: "session.error" } })

    expect(getAuditState()).not.toBeNull()
    expect(getAuditState()!.findings).toHaveLength(1)
  })

  test("session.idle with no state is no-op", async () => {
    expect(getAuditState()).toBeNull()
    // Should not throw
    await hook({ event: { type: "session.idle" } })
    expect(getAuditState()).toBeNull()
  })
})
