import { describe, expect, it } from "bun:test"
import type { AuditState, Finding } from "../state/types"
import {
  buildDynamicContext,
  buildFallbackDirectives,
  createSystemPromptHook,
  estimateTokens,
  type SystemPromptHookDeps,
} from "./system-prompt-hook"
import { createAuditEnforcer } from "../features/audit-enforcer/audit-enforcer"

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "finding-1",
    check: "reentrancy-eth",
    severity: "Medium",
    confidence: "High",
    description: "Reentrancy risk",
    file: "src/Vault.sol",
    lines: [12, 20],
    source: "slither",
    ...overrides,
  }
}

function makeAuditState(overrides: Partial<AuditState> = {}): AuditState {
  return {
    sessionId: "session-1",
    projectDir: "/tmp/project",
    contractsReviewed: ["Vault.sol"],
    findings: [],
    toolsExecuted: [],
    currentPhase: "reconnaissance",
    scope: ["Vault.sol"],
    startTime: Date.now(),
    ...overrides,
  }
}

function makeDeps(overrides: Partial<SystemPromptHookDeps> = {}): SystemPromptHookDeps {
  return {
    getAuditState: () => makeAuditState(),
    getAgentForSession: () => "argus",
    isArgusAgent: () => true,
    ...overrides,
  }
}

describe("createSystemPromptHook", () => {
  it("injects context for argus agent session", async () => {
    const hook = createSystemPromptHook(makeDeps({ getAgentForSession: () => "argus" }))
    const output = { system: [] as string[] }

    await hook({ sessionID: "s-1", model: "anthropic/claude" }, output)

    expect(output.system).toHaveLength(1)
    expect(output.system[0]).toContain('<argus-context agent="argus">')
  })

  it("injects context for sentinel agent session", async () => {
    const hook = createSystemPromptHook(makeDeps({ getAgentForSession: () => "sentinel" }))
    const output = { system: [] as string[] }

    await hook({ sessionID: "s-1", model: "anthropic/claude" }, output)

    expect(output.system).toHaveLength(1)
    expect(output.system[0]).toContain('<argus-context agent="sentinel">')
  })

  it("injects context for pythia agent session", async () => {
    const hook = createSystemPromptHook(makeDeps({ getAgentForSession: () => "pythia" }))
    const output = { system: [] as string[] }

    await hook({ sessionID: "s-1", model: "anthropic/claude" }, output)

    expect(output.system).toHaveLength(1)
    expect(output.system[0]).toContain('<argus-context agent="pythia">')
  })

  it("injects context for scribe agent session", async () => {
    const hook = createSystemPromptHook(makeDeps({ getAgentForSession: () => "scribe" }))
    const output = { system: [] as string[] }

    await hook({ sessionID: "s-1", model: "anthropic/claude" }, output)

    expect(output.system).toHaveLength(1)
    expect(output.system[0]).toContain('<argus-context agent="scribe">')
  })

  it("does not inject for non-argus agents", async () => {
    const hook = createSystemPromptHook(
      makeDeps({
        isArgusAgent: () => false,
        getAgentForSession: () => "build",
      }),
    )
    const output = { system: [] as string[] }

    await hook({ sessionID: "s-1", model: "anthropic/claude" }, output)

    expect(output.system).toHaveLength(0)
  })

  it("does not inject when sessionID is undefined", async () => {
    const hook = createSystemPromptHook(makeDeps())
    const output = { system: [] as string[] }

    await hook({ model: "anthropic/claude" }, output)

    expect(output.system).toHaveLength(0)
  })

  it("does not inject when no audit state exists", async () => {
    const hook = createSystemPromptHook(makeDeps({ getAuditState: () => null }))
    const output = { system: [] as string[] }

    await hook({ sessionID: "s-1", model: "anthropic/claude" }, output)

    expect(output.system).toHaveLength(0)
  })

  it("leaves output system array unmodified for non-argus agents", async () => {
    const hook = createSystemPromptHook(makeDeps({ isArgusAgent: () => false }))
    const output = { system: ["baseline"] }

    await hook({ sessionID: "s-1", model: "anthropic/claude" }, output)

    expect(output.system).toEqual(["baseline"])
  })
})

describe("buildDynamicContext", () => {
  it("includes phase information", () => {
    const context = buildDynamicContext(makeAuditState({ currentPhase: "manual-review" }), "argus")
    expect(context).toContain("Phase: manual-review")
  })

  it("includes findings counts by severity", () => {
    const context = buildDynamicContext(
      makeAuditState({
        findings: [
          makeFinding({ id: "f-1", severity: "Critical" }),
          makeFinding({ id: "f-2", severity: "High" }),
          makeFinding({ id: "f-3", severity: "Medium" }),
          makeFinding({ id: "f-4", severity: "Low" }),
          makeFinding({ id: "f-5", severity: "Informational" }),
          makeFinding({ id: "f-6", severity: "Critical" }),
        ],
      }),
      "argus",
    )

    expect(context).toContain("Findings: Critical=2 High=1 Medium=1 Low=1 Info=1")
  })

  it("truncates to minimal summary when budget is exceeded", () => {
    const context = buildDynamicContext(
      makeAuditState({
        findings: [
          makeFinding({ id: "f-1", description: "x".repeat(500) }),
          makeFinding({ id: "f-2", description: "y".repeat(500) }),
        ],
        toolsExecuted: [
          { tool: "argus_solodit_search", startTime: 1, success: true, findingsCount: 1 },
          { tool: "argus_check_patterns", startTime: 2, success: true, findingsCount: 1 },
          { tool: "argus_analyze_contract", startTime: 3, success: true, findingsCount: 0 },
          { tool: "argus_forge_test", startTime: 4, success: true, findingsCount: 0 },
          { tool: "argus_forge_fuzz", startTime: 5, success: true, findingsCount: 0 },
        ],
      }),
      "argus",
      15,
    )

    expect(context).toContain("Phase: reconnaissance | Findings: 2 | Contracts: 1")
    expect(context).not.toContain("Tools:")
  })
})

describe("estimateTokens", () => {
  it("calculates token estimate using character length / 4", () => {
    expect(estimateTokens("abcd")).toBe(1)
    expect(estimateTokens("abcde")).toBe(2)
    expect(estimateTokens("a".repeat(21))).toBe(6)
  })
})

describe("audit enforcer integration", () => {
  const auditEnforcer = createAuditEnforcer()

  it("injects enforcer reminder for argus agent during active audit", async () => {
    const hook = createSystemPromptHook(
      makeDeps({
        getAgentForSession: () => "argus",
        getAuditState: () => makeAuditState({ currentPhase: "scanning" }),
        getEnforcerReminder: auditEnforcer,
      }),
    )
    const output = { system: [] as string[] }

    await hook({ sessionID: "s-1", model: "anthropic/claude" }, output)

    expect(output.system).toHaveLength(2)
    expect(output.system[0]).toContain('<argus-context agent="argus">')
    expect(output.system[1]).toContain("[Argus Audit Enforcer]")
    expect(output.system[1]).toContain("current phase: scanning")
    expect(output.system[1]).toContain("Next phase: manual-review")
  })

  it("does not inject enforcer reminder for sentinel agent", async () => {
    const hook = createSystemPromptHook(
      makeDeps({
        getAgentForSession: () => "sentinel",
        getAuditState: () => makeAuditState({ currentPhase: "scanning" }),
        getEnforcerReminder: auditEnforcer,
      }),
    )
    const output = { system: [] as string[] }

    await hook({ sessionID: "s-1", model: "anthropic/claude" }, output)

    expect(output.system).toHaveLength(1)
    expect(output.system[0]).toContain('<argus-context agent="sentinel">')
    expect(output.system.some((s) => s.includes("[Argus Audit Enforcer]"))).toBe(false)
  })

  it("does not inject enforcer reminder for pythia agent", async () => {
    const hook = createSystemPromptHook(
      makeDeps({
        getAgentForSession: () => "pythia",
        getAuditState: () => makeAuditState({ currentPhase: "research" }),
        getEnforcerReminder: auditEnforcer,
      }),
    )
    const output = { system: [] as string[] }

    await hook({ sessionID: "s-1", model: "anthropic/claude" }, output)

    expect(output.system).toHaveLength(1)
    expect(output.system[0]).toContain('<argus-context agent="pythia">')
    expect(output.system.some((s) => s.includes("[Argus Audit Enforcer]"))).toBe(false)
  })

  it("does not inject enforcer reminder when audit is complete", async () => {
    const hook = createSystemPromptHook(
      makeDeps({
        getAgentForSession: () => "argus",
        getAuditState: () => makeAuditState({ currentPhase: "complete" }),
        getEnforcerReminder: auditEnforcer,
      }),
    )
    const output = { system: [] as string[] }

    await hook({ sessionID: "s-1", model: "anthropic/claude" }, output)

    expect(output.system).toHaveLength(1)
    expect(output.system[0]).toContain('<argus-context agent="argus">')
    expect(output.system.some((s) => s.includes("[Argus Audit Enforcer]"))).toBe(false)
  })

  it("does not inject enforcer reminder for scribe agent", async () => {
    const hook = createSystemPromptHook(
      makeDeps({
        getAgentForSession: () => "scribe",
        getAuditState: () => makeAuditState({ currentPhase: "reporting" }),
        getEnforcerReminder: auditEnforcer,
      }),
    )
    const output = { system: [] as string[] }

    await hook({ sessionID: "s-1", model: "anthropic/claude" }, output)

    expect(output.system).toHaveLength(1)
    expect(output.system[0]).toContain('<argus-context agent="scribe">')
    expect(output.system.some((s) => s.includes("[Argus Audit Enforcer]"))).toBe(false)
  })
})

describe("buildFallbackDirectives", () => {
  it("returns slither fallback directive", () => {
    const directives = buildFallbackDirectives(["slither"])
    expect(directives).toHaveLength(1)
    expect(directives[0]).toContain("DO NOT re-attempt argus_slither_analyze")
    expect(directives[0]).toContain("argus_analyze_contract")
    expect(directives[0]).toContain("argus_check_patterns")
  })

  it("returns forge fallback directive", () => {
    const directives = buildFallbackDirectives(["forge"])
    expect(directives).toHaveLength(1)
    expect(directives[0]).toContain("DO NOT re-attempt argus_forge_test")
    expect(directives[0]).toContain("manual code tracing")
  })

  it("returns multiple directives for multiple tools", () => {
    const directives = buildFallbackDirectives(["slither", "forge"])
    expect(directives).toHaveLength(2)
  })

  it("returns empty array for unknown tools", () => {
    const directives = buildFallbackDirectives(["unknown"])
    expect(directives).toHaveLength(0)
  })

  it("returns empty array for empty input", () => {
    const directives = buildFallbackDirectives([])
    expect(directives).toHaveLength(0)
  })
})

describe("buildDynamicContext with unavailable tools", () => {
  it("includes unavailable tools and fallback directives", () => {
    const context = buildDynamicContext(
      makeAuditState({ unavailableTools: ["slither"] }),
      "sentinel",
    )
    expect(context).toContain("Unavailable: slither")
    expect(context).toContain("DO NOT re-attempt argus_slither_analyze")
  })

  it("includes multiple fallback directives", () => {
    const context = buildDynamicContext(
      makeAuditState({ unavailableTools: ["slither", "forge"] }),
      "argus",
    )
    expect(context).toContain("Unavailable: slither, forge")
    expect(context).toContain("DO NOT re-attempt argus_slither_analyze")
    expect(context).toContain("DO NOT re-attempt argus_forge_test")
  })

  it("omits unavailable section when no tools are unavailable", () => {
    const context = buildDynamicContext(makeAuditState(), "argus")
    expect(context).not.toContain("Unavailable:")
    expect(context).not.toContain("DO NOT")
  })

  it("injects unavailable tools via system prompt hook", async () => {
    const hook = createSystemPromptHook(
      makeDeps({
        getAuditState: () => makeAuditState({ unavailableTools: ["slither", "forge"] }),
        getAgentForSession: () => "sentinel",
      }),
    )
    const output = { system: [] as string[] }
    await hook({ sessionID: "s-1", model: "anthropic/claude" }, output)

    expect(output.system[0]).toContain("Unavailable: slither, forge")
    expect(output.system[0]).toContain("DO NOT re-attempt argus_slither_analyze")
  })
})
