import { describe, expect, it } from "bun:test"
import type { EventSubHandler } from "./event-hook"
import { createEventHook } from "./event-hook"

describe("createEventHook", () => {
  it("handles session.created", async () => {
    const { hook, getAuditState } = createEventHook("/tmp/test")

    await hook({ event: { type: "session.created" } })

    expect(getAuditState()).not.toBeNull()
    expect(getAuditState()?.currentPhase).toBe("reconnaissance")
  })

  it("handles session.deleted", async () => {
    const { hook, getAuditState, setAuditState } = createEventHook()
    setAuditState({
      sessionId: "s1",
      projectDir: "/tmp",
      contractsReviewed: [],
      findings: [],
      toolsExecuted: [],
      currentPhase: "scanning",
      scope: [],
      startTime: Date.now(),
    })

    await hook({ event: { type: "session.deleted" } })

    expect(getAuditState()).toBeNull()
  })

  it("handles session.idle without error", async () => {
    const { hook, setAuditState } = createEventHook()
    setAuditState({
      sessionId: "s1",
      projectDir: "/tmp",
      contractsReviewed: [],
      findings: [],
      toolsExecuted: [],
      currentPhase: "scanning",
      scope: [],
      startTime: Date.now(),
    })

    await expect(hook({ event: { type: "session.idle" } })).resolves.toBeUndefined()
  })

  it("handles session.error without throwing", async () => {
    const { hook, setAuditState } = createEventHook()
    setAuditState({
      sessionId: "s1",
      projectDir: "/tmp",
      contractsReviewed: ["Vault.sol"],
      findings: [],
      toolsExecuted: [],
      currentPhase: "scanning",
      scope: [],
      startTime: Date.now(),
    })

    await expect(hook({ event: { type: "session.error" } })).resolves.toBeUndefined()
  })

  it("handles unknown events without error", async () => {
    const { hook } = createEventHook()
    await expect(hook({ event: { type: "unknown.event" } })).resolves.toBeUndefined()
  })

  it("calls sub-handlers with event and audit state", async () => {
    const calls: string[] = []
    const subHandler: EventSubHandler = async (event) => {
      calls.push(event.type)
    }

    const { hook } = createEventHook("/tmp", [subHandler])
    await hook({ event: { type: "session.created" } })

    expect(calls).toEqual(["session.created"])
  })

  it("sub-handler errors do not crash the hook", async () => {
    const failHandler: EventSubHandler = async () => {
      throw new Error("handler failed")
    }

    const { hook } = createEventHook("/tmp", [failHandler])
    await expect(hook({ event: { type: "session.created" } })).resolves.toBeUndefined()
  })
})
