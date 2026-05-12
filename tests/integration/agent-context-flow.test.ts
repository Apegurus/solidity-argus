import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { createAgentTracker } from "../../src/hooks/agent-tracker"
import type { AuditState } from "../../src/state/types"

type AgentTracker = ReturnType<typeof createAgentTracker>
type ChatParamsInput = Parameters<AgentTracker["chatParamsHook"]>[0]

function makeChatParamsInput(overrides: Partial<ChatParamsInput>): ChatParamsInput {
  return {
    sessionID: overrides.sessionID ?? "session-default",
    agent: overrides.agent ?? "argus",
    model: (overrides.model ?? "anthropic/claude-sonnet-4-6") as ChatParamsInput["model"],
    provider: (overrides.provider ?? "anthropic") as ChatParamsInput["provider"],
    message: (overrides.message ?? {}) as ChatParamsInput["message"],
  }
}

function makeAuditState(): AuditState {
  return {
    sessionId: "session-audit",
    projectDir: "/tmp/project",
    contractsReviewed: ["Vault.sol", "Token.sol"],
    findings: [
      {
        id: "finding-1",
        check: "reentrancy",
        severity: "High",
        confidence: "High",
        description: "External call before state update",
        file: "src/Vault.sol",
        lines: [40, 52],
        source: "manual",
      },
    ],
    toolsExecuted: [
      {
        tool: "argus_slither_analyze",
        startTime: Date.now() - 1_000,
        endTime: Date.now(),
        success: true,
        findingsCount: 1,
      },
    ],
    currentPhase: "scanning",
    scope: ["src/Vault.sol"],
    startTime: Date.now() - 10_000,
  }
}

describe("Agent-Scoped Context Flow", () => {
  it("maps sentinel session via chat.params", () => {
    const tracker = createAgentTracker()

    tracker.chatParamsHook(
      makeChatParamsInput({
        sessionID: "ses_001",
        agent: "sentinel",
      }),
    )

    expect(tracker.getAgentForSession("ses_001")).toBe("sentinel")
    expect(tracker.isArgusAgent("ses_001")).toBe(true)
  })

  it("maps non-argus agent and blocks context", () => {
    const tracker = createAgentTracker()

    tracker.chatParamsHook(
      makeChatParamsInput({
        sessionID: "ses_002",
        agent: "build",
      }),
    )

    expect(tracker.getAgentForSession("ses_002")).toBe("build")
    expect(tracker.isArgusAgent("ses_002")).toBe(false)
  })

  it("handles concurrent sessions without cross-contamination", () => {
    const tracker = createAgentTracker()

    tracker.chatParamsHook(makeChatParamsInput({ sessionID: "ses_A", agent: "argus" }))
    tracker.chatParamsHook(makeChatParamsInput({ sessionID: "ses_B", agent: "build" }))
    tracker.chatParamsHook(makeChatParamsInput({ sessionID: "ses_C", agent: "sentinel" }))

    expect(tracker.getAgentForSession("ses_A")).toBe("argus")
    expect(tracker.getAgentForSession("ses_B")).toBe("build")
    expect(tracker.getAgentForSession("ses_C")).toBe("sentinel")
    expect(tracker.isArgusAgent("ses_A")).toBe(true)
    expect(tracker.isArgusAgent("ses_B")).toBe(false)
    expect(tracker.isArgusAgent("ses_C")).toBe(true)
  })

  it("cleans up session tracking on session.deleted", () => {
    const tracker = createAgentTracker()

    tracker.chatParamsHook(
      makeChatParamsInput({
        sessionID: "ses_cleanup",
        agent: "pythia",
      }),
    )
    expect(tracker.isArgusAgent("ses_cleanup")).toBe(true)

    tracker.clearSession("ses_cleanup")

    expect(tracker.getAgentForSession("ses_cleanup")).toBeUndefined()
    expect(tracker.isArgusAgent("ses_cleanup")).toBe(false)
  })

  it("recognizes all argus family agents", () => {
    const tracker = createAgentTracker()

    for (const agent of ["argus", "sentinel", "pythia", "scribe"]) {
      const sessionID = `ses_${agent}`
      tracker.chatParamsHook(makeChatParamsInput({ sessionID, agent }))
      expect(tracker.getAgentForSession(sessionID)).toBe(agent)
      expect(tracker.isArgusAgent(sessionID)).toBe(true)
    }
  })

  it("full lifecycle: map, verify, cleanup, verify removed", () => {
    const tracker = createAgentTracker()

    tracker.chatParamsHook(
      makeChatParamsInput({
        sessionID: "ses_lifecycle",
        agent: "argus",
      }),
    )
    expect(tracker.getAgentForSession("ses_lifecycle")).toBe("argus")
    expect(tracker.getTrackedSessions().size).toBeGreaterThan(0)

    tracker.clearSession("ses_lifecycle")

    expect(tracker.getAgentForSession("ses_lifecycle")).toBeUndefined()
    expect(tracker.getTrackedSessions().has("ses_lifecycle")).toBe(false)
  })
})

const systemPromptHookPath = `${import.meta.dir}/../../src/hooks/system-prompt-hook.ts`

if (existsSync(systemPromptHookPath)) {
  describe("system.transform integration with agent tracking", () => {
    it("injects dynamic context for tracked argus-family session", async () => {
      const module = await import("../../src/hooks/system-prompt-hook")
      const tracker = createAgentTracker()
      const auditState = makeAuditState()

      tracker.chatParamsHook(
        makeChatParamsInput({
          sessionID: "ses_sys_argus",
          agent: "sentinel",
        }),
      )

      const hook = module.createSystemPromptHook({
        getAuditState: () => auditState,
        getAgentForSession: tracker.getAgentForSession,
        isArgusAgent: tracker.isArgusAgent,
      })
      const output = { system: [] as string[] }

      await hook({ sessionID: "ses_sys_argus", model: "anthropic/claude-sonnet-4-6" }, output)

      expect(output.system).toHaveLength(1)
      expect(output.system[0]).toContain('<argus-context agent="sentinel">')
      expect(output.system[0]).toContain("Phase: scanning")
      expect(output.system[0]).toBe(module.buildDynamicContext(auditState, "sentinel"))
    })

    it("does not inject context for non-argus agent session", async () => {
      const module = await import("../../src/hooks/system-prompt-hook")
      const tracker = createAgentTracker()

      tracker.chatParamsHook(
        makeChatParamsInput({
          sessionID: "ses_sys_build",
          agent: "build",
        }),
      )

      const hook = module.createSystemPromptHook({
        getAuditState: makeAuditState,
        getAgentForSession: tracker.getAgentForSession,
        isArgusAgent: tracker.isArgusAgent,
      })
      const output = { system: [] as string[] }

      await hook({ sessionID: "ses_sys_build", model: "anthropic/claude-sonnet-4-6" }, output)

      expect(output.system).toEqual([])
    })

    it("does not inject context when sessionID is undefined", async () => {
      const module = await import("../../src/hooks/system-prompt-hook")
      const tracker = createAgentTracker()

      const hook = module.createSystemPromptHook({
        getAuditState: makeAuditState,
        getAgentForSession: tracker.getAgentForSession,
        isArgusAgent: tracker.isArgusAgent,
      })
      const output = { system: [] as string[] }

      await hook({ model: "anthropic/claude-sonnet-4-6" }, output)

      expect(output.system).toEqual([])
    })

    it("stops context injection after cleanup", async () => {
      const module = await import("../../src/hooks/system-prompt-hook")
      const tracker = createAgentTracker()

      tracker.chatParamsHook(
        makeChatParamsInput({
          sessionID: "ses_cleanup_system",
          agent: "argus",
        }),
      )

      const hook = module.createSystemPromptHook({
        getAuditState: makeAuditState,
        getAgentForSession: tracker.getAgentForSession,
        isArgusAgent: tracker.isArgusAgent,
      })
      const outputBeforeCleanup = { system: [] as string[] }
      await hook(
        { sessionID: "ses_cleanup_system", model: "anthropic/claude-sonnet-4-6" },
        outputBeforeCleanup,
      )
      expect(outputBeforeCleanup.system.length).toBeGreaterThan(0)

      tracker.clearSession("ses_cleanup_system")

      const outputAfterCleanup = { system: [] as string[] }
      await hook(
        { sessionID: "ses_cleanup_system", model: "anthropic/claude-sonnet-4-6" },
        outputAfterCleanup,
      )
      expect(outputAfterCleanup.system).toEqual([])
    })
  })
}
