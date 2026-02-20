import { describe, expect, it } from "bun:test"
import { createAuditEnforcer } from "../../src/features/audit-enforcer/audit-enforcer"
import { createAgentTracker } from "../../src/hooks/agent-tracker"
import { getTokenBudgetForAgent } from "../../src/hooks/context-budget"
import { createSystemPromptHook } from "../../src/hooks/system-prompt-hook"
import { createAuditState } from "../../src/state/audit-state"

type AgentTracker = ReturnType<typeof createAgentTracker>
type ChatParamsInput = Parameters<AgentTracker["chatParamsHook"]>[0]

function makeChatParamsInput(overrides: Partial<ChatParamsInput>): ChatParamsInput {
  return {
    sessionID: overrides.sessionID ?? "session-default",
    agent: overrides.agent ?? "argus",
    model: (overrides.model ?? "test-model") as ChatParamsInput["model"],
    provider: (overrides.provider ?? "test-provider") as ChatParamsInput["provider"],
    message: (overrides.message ?? {}) as ChatParamsInput["message"],
  }
}

function registerAgent(tracker: AgentTracker, sessionID: string, agent: string): void {
  tracker.chatParamsHook(makeChatParamsInput({ sessionID, agent }))
}

function buildHook(tracker: AgentTracker, phase: "scanning" | "research" | "reporting" = "scanning") {
  const { state } = createAuditState("/tmp/argus-acceptance")
  state.currentPhase = phase
  state.contractsReviewed.push("Vault.sol")
  state.findings.push({
    id: "f-1",
    check: "reentrancy",
    severity: "High",
    confidence: "High",
    description: "State update after external call",
    file: "src/Vault.sol",
    lines: [12, 28],
    source: "manual",
  })
  state.toolsExecuted.push({
    tool: "argus_slither_analyze",
    startTime: Date.now() - 1000,
    endTime: Date.now(),
    success: true,
    findingsCount: 1,
  })

  return createSystemPromptHook({
    getAuditState: () => state,
    getAgentForSession: tracker.getAgentForSession,
    isArgusAgent: tracker.isArgusAgent,
    getTokenBudget: getTokenBudgetForAgent,
    getEnforcerReminder: createAuditEnforcer(),
  })
}

async function executeHook(
  tracker: AgentTracker,
  sessionID: string | undefined,
  phase: "scanning" | "research" | "reporting" = "scanning",
) {
  const hook = buildHook(tracker, phase)
  const output = { system: [] as string[] }
  await hook({ sessionID, model: "test" }, output)
  return output
}

describe("non-Argus agent isolation", () => {
  it("build agent receives zero injected context", async () => {
    const tracker = createAgentTracker()
    registerAgent(tracker, "ses-build", "build")

    const output = await executeHook(tracker, "ses-build")

    expect(output.system).toEqual([])
    expect(getTokenBudgetForAgent("build", 0)).toBe(0)
  })

  it("code agent receives zero injected context", async () => {
    const tracker = createAgentTracker()
    registerAgent(tracker, "ses-code", "code")

    const output = await executeHook(tracker, "ses-code")

    expect(output.system).toEqual([])
    expect(getTokenBudgetForAgent("code", 0.9)).toBe(0)
  })

  it("unknown agent name receives zero injected context", async () => {
    const tracker = createAgentTracker()
    registerAgent(tracker, "ses-unknown", "random-custom-agent")

    const output = await executeHook(tracker, "ses-unknown")

    expect(output.system).toEqual([])
    expect(getTokenBudgetForAgent("random-custom-agent", 0.3)).toBe(0)
  })

  it("agent with no session mapping receives zero context", async () => {
    const tracker = createAgentTracker()
    registerAgent(tracker, "ses-other", "argus")

    const output = await executeHook(tracker, "ses-unmapped")

    expect(output.system).toEqual([])
    expect(tracker.getAgentForSession("ses-unmapped")).toBeUndefined()
  })
})

describe("Argus-family agent context levels", () => {
  it("argus agent receives full dynamic context with enforcer", async () => {
    const tracker = createAgentTracker()
    registerAgent(tracker, "ses-argus", "argus")

    const output = await executeHook(tracker, "ses-argus", "scanning")

    expect(output.system).toHaveLength(2)
    expect(output.system[0]).toContain('<argus-context agent="argus">')
    expect(output.system[0]).toContain("Phase: scanning")
    expect(output.system[0]).toContain("Findings: Critical=0 High=1 Medium=0 Low=0 Info=0")
    expect(output.system[1]).toContain("[Argus Audit Enforcer]")
    expect(getTokenBudgetForAgent("argus", 0.2)).toBe(2000)
    expect(getTokenBudgetForAgent("argus", 0.95)).toBe(1000)
  })

  it("sentinel agent receives context without enforcer", async () => {
    const tracker = createAgentTracker()
    registerAgent(tracker, "ses-sentinel", "sentinel")

    const output = await executeHook(tracker, "ses-sentinel", "scanning")

    expect(output.system).toHaveLength(1)
    expect(output.system[0]).toContain('<argus-context agent="sentinel">')
    expect(output.system[0]).toContain("Tools: argus_slither_analyze")
    expect(output.system.some((line) => line.includes("[Argus Audit Enforcer]"))).toBe(false)
    expect(getTokenBudgetForAgent("sentinel", 0.2)).toBe(1000)
    expect(getTokenBudgetForAgent("sentinel", 0.95)).toBe(500)
  })

  it("pythia agent receives context without enforcer", async () => {
    const tracker = createAgentTracker()
    registerAgent(tracker, "ses-pythia", "pythia")

    const output = await executeHook(tracker, "ses-pythia", "research")

    expect(output.system).toHaveLength(1)
    expect(output.system[0]).toContain('<argus-context agent="pythia">')
    expect(output.system[0]).toContain("Phase: research")
    expect(output.system.some((line) => line.includes("[Argus Audit Enforcer]"))).toBe(false)
    expect(getTokenBudgetForAgent("pythia", 0.4)).toBe(1000)
  })

  it("scribe agent receives context without enforcer", async () => {
    const tracker = createAgentTracker()
    registerAgent(tracker, "ses-scribe", "scribe")

    const output = await executeHook(tracker, "ses-scribe", "reporting")

    expect(output.system).toHaveLength(1)
    expect(output.system[0]).toContain('<argus-context agent="scribe">')
    expect(output.system[0]).toContain("Phase: reporting")
    expect(output.system.some((line) => line.includes("[Argus Audit Enforcer]"))).toBe(false)
    expect(getTokenBudgetForAgent("scribe", 0.8)).toBe(500)
  })
})

describe("session lifecycle isolation", () => {
  it("session cleanup removes all agent tracking data", async () => {
    const tracker = createAgentTracker()
    registerAgent(tracker, "ses-cleanup", "argus")

    const beforeCleanup = await executeHook(tracker, "ses-cleanup")
    expect(beforeCleanup.system).toHaveLength(2)

    tracker.clearSession("ses-cleanup")

    const afterCleanup = await executeHook(tracker, "ses-cleanup")
    expect(afterCleanup.system).toEqual([])
    expect(tracker.getAgentForSession("ses-cleanup")).toBeUndefined()
    expect(tracker.getTrackedSessions().has("ses-cleanup")).toBe(false)
  })

  it("concurrent sessions for different agents don't cross-contaminate", async () => {
    const tracker = createAgentTracker()
    registerAgent(tracker, "ses-A", "argus")
    registerAgent(tracker, "ses-B", "build")
    registerAgent(tracker, "ses-C", "sentinel")

    const outputArgus = await executeHook(tracker, "ses-A")
    const outputBuild = await executeHook(tracker, "ses-B")
    const outputSentinel = await executeHook(tracker, "ses-C")

    expect(outputArgus.system).toHaveLength(2)
    expect(outputArgus.system[0]).toContain('<argus-context agent="argus">')
    expect(outputBuild.system).toEqual([])
    expect(outputSentinel.system).toHaveLength(1)
    expect(outputSentinel.system[0]).toContain('<argus-context agent="sentinel">')
    expect(outputSentinel.system[0]).not.toContain('agent="argus"')
  })

  it("undefined sessionID is handled gracefully", async () => {
    const tracker = createAgentTracker()
    registerAgent(tracker, "ses-defined", "argus")

    const output = await executeHook(tracker, undefined)

    expect(output.system).toEqual([])
  })

  it("session re-registration updates agent mapping", async () => {
    const tracker = createAgentTracker()
    registerAgent(tracker, "ses-reregister", "build")
    registerAgent(tracker, "ses-reregister", "argus")

    const output = await executeHook(tracker, "ses-reregister")

    expect(tracker.getAgentForSession("ses-reregister")).toBe("argus")
    expect(output.system).toHaveLength(2)
    expect(output.system[0]).toContain('<argus-context agent="argus">')
    expect(output.system[1]).toContain("[Argus Audit Enforcer]")
  })
})
