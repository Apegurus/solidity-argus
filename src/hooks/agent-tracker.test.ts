import { describe, expect, it } from "bun:test"
import { createAgentTracker } from "./agent-tracker"

function makeChatParamsInput(
  overrides: Partial<Parameters<ReturnType<typeof createAgentTracker>["chatParamsHook"]>[0]> = {},
): Parameters<ReturnType<typeof createAgentTracker>["chatParamsHook"]>[0] {
  return {
    sessionID: "session-1",
    agent: "argus",
    model: {} as Parameters<ReturnType<typeof createAgentTracker>["chatParamsHook"]>[0]["model"],
    provider: {} as Parameters<
      ReturnType<typeof createAgentTracker>["chatParamsHook"]
    >[0]["provider"],
    message: {} as Parameters<
      ReturnType<typeof createAgentTracker>["chatParamsHook"]
    >[0]["message"],
    ...overrides,
  }
}

function makeChatMessageInput(
  overrides: Partial<Parameters<ReturnType<typeof createAgentTracker>["chatMessageHook"]>[0]> = {},
): Parameters<ReturnType<typeof createAgentTracker>["chatMessageHook"]>[0] {
  return {
    sessionID: "session-1",
    ...overrides,
  }
}

describe("createAgentTracker", () => {
  it("maps sessionID to agent name from chat.params", () => {
    const tracker = createAgentTracker()

    tracker.chatParamsHook(makeChatParamsInput({ sessionID: "s1", agent: "argus" }))

    expect(tracker.getTrackedSessions().get("s1")).toBe("argus")
  })

  it("getAgentForSession returns mapped agent", () => {
    const tracker = createAgentTracker()

    tracker.chatParamsHook(makeChatParamsInput({ sessionID: "s2", agent: "sentinel" }))

    expect(tracker.getAgentForSession("s2")).toBe("sentinel")
  })

  it("getAgentForSession returns undefined for unknown session", () => {
    const tracker = createAgentTracker()

    expect(tracker.getAgentForSession("missing")).toBeUndefined()
  })

  it('isArgusAgent returns true for "argus"', () => {
    const tracker = createAgentTracker()

    tracker.chatParamsHook(makeChatParamsInput({ sessionID: "argus-session", agent: "argus" }))

    expect(tracker.isArgusAgent("argus-session")).toBe(true)
  })

  it('isArgusAgent returns true for "sentinel"', () => {
    const tracker = createAgentTracker()

    tracker.chatParamsHook(
      makeChatParamsInput({ sessionID: "sentinel-session", agent: "sentinel" }),
    )

    expect(tracker.isArgusAgent("sentinel-session")).toBe(true)
  })

  it('isArgusAgent returns true for "pythia" and "scribe"', () => {
    const tracker = createAgentTracker()

    tracker.chatParamsHook(makeChatParamsInput({ sessionID: "pythia-session", agent: "pythia" }))
    tracker.chatParamsHook(makeChatParamsInput({ sessionID: "scribe-session", agent: "scribe" }))

    expect(tracker.isArgusAgent("pythia-session")).toBe(true)
    expect(tracker.isArgusAgent("scribe-session")).toBe(true)
  })

  it("isArgusAgent returns false for non-argus and unknown agents", () => {
    const tracker = createAgentTracker()

    tracker.chatParamsHook(makeChatParamsInput({ sessionID: "build-session", agent: "build" }))
    tracker.chatMessageHook(makeChatMessageInput({ sessionID: "code-session", agent: "code" }))

    expect(tracker.isArgusAgent("build-session")).toBe(false)
    expect(tracker.isArgusAgent("code-session")).toBe(false)
    expect(tracker.isArgusAgent("unknown-session")).toBe(false)
  })

  it("clearSession removes a tracked mapping", () => {
    const tracker = createAgentTracker()

    tracker.chatParamsHook(makeChatParamsInput({ sessionID: "s3", agent: "argus" }))
    tracker.clearSession("s3")

    expect(tracker.getAgentForSession("s3")).toBeUndefined()
  })

  it("handles undefined/missing agent without crashing", () => {
    const tracker = createAgentTracker()

    tracker.chatParamsHook(makeChatParamsInput({ sessionID: "s4", agent: undefined }))
    tracker.chatMessageHook(makeChatMessageInput({ sessionID: "s4", agent: undefined }))

    expect(tracker.getAgentForSession("s4")).toBeUndefined()
  })

  it("tracks multiple sessions simultaneously", () => {
    const tracker = createAgentTracker()

    tracker.chatParamsHook(makeChatParamsInput({ sessionID: "s5", agent: "argus" }))
    tracker.chatParamsHook(makeChatParamsInput({ sessionID: "s6", agent: "sentinel" }))
    tracker.chatMessageHook(makeChatMessageInput({ sessionID: "s7", agent: "pythia" }))

    expect(tracker.getAgentForSession("s5")).toBe("argus")
    expect(tracker.getAgentForSession("s6")).toBe("sentinel")
    expect(tracker.getAgentForSession("s7")).toBe("pythia")
  })

  it("tracks child session relationships", () => {
    const tracker = createAgentTracker()

    tracker.trackChildSession("parent-1", "child-1")
    tracker.trackChildSession("parent-1", "child-2")

    expect(tracker.getChildSessions("parent-1").sort()).toEqual(["child-1", "child-2"])
    expect(tracker.getParentSession("child-1")).toBe("parent-1")
  })
})
