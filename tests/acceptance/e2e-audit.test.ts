import { describe, expect, it } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { createAuditEnforcer } from "../../src/features/audit-enforcer/audit-enforcer"
import { createAgentTracker } from "../../src/hooks/agent-tracker"
import { createCompactionHook } from "../../src/hooks/compaction-hook"
import { createSystemPromptHook } from "../../src/hooks/system-prompt-hook"
import { createToolTrackingHook } from "../../src/hooks/tool-tracking-hook"
import { createAuditState } from "../../src/state/audit-state"
import { executeReportGeneration } from "../../src/tools/report-generator-tool"

type AgentTracker = ReturnType<typeof createAgentTracker>
type ChatParamsInput = Parameters<AgentTracker["chatParamsHook"]>[0]

function makeChatParamsInput(overrides: Partial<ChatParamsInput>): ChatParamsInput {
  return {
    sessionID: overrides.sessionID ?? "session-e2e",
    agent: overrides.agent ?? "argus",
    model: (overrides.model ?? "test-model") as ChatParamsInput["model"],
    provider: (overrides.provider ?? "test-provider") as ChatParamsInput["provider"],
    message: (overrides.message ?? {}) as ChatParamsInput["message"],
  }
}

function createHarness(projectDir = "/tmp/e2e-audit") {
  const { state } = createAuditState(projectDir)
  const toolHook = createToolTrackingHook(() => state)
  return { state, toolHook }
}

function createContext(): ToolContext {
  return {
    sessionID: "session-e2e",
    messageID: "message-e2e",
    agent: "argus",
    directory: "/tmp/e2e-audit",
    worktree: "/tmp/e2e-audit",
    abort: new AbortController().signal,
    metadata() {
      return
    },
    async ask() {
      return
    },
  }
}

async function runCoreToolSequence(
  toolHook: (input: { tool: string; args: unknown; result: string }) => Promise<void>,
): Promise<void> {
  await toolHook({
    tool: "argus_slither_analyze",
    args: { target: "." },
    result: JSON.stringify({
      success: true,
      findingsCount: 1,
      findings: [
        {
          check: "reentrancy-eth",
          severity: "High",
          confidence: "High",
          description: "External call before state update",
          file: "src/Vault.sol",
          lines: [42, 55],
          source: "slither",
        },
      ],
      executionTime: 1250,
      errors: [],
    }),
  })

  await toolHook({
    tool: "argus_check_patterns",
    args: { target: ".", patterns: ["oracle"] },
    result: JSON.stringify({
      sources: [
        {
          source: "scvd-pack",
          matches: [
            {
              pattern: "oracle-single-source",
              severity: "Medium",
              file: "src/Oracle.sol",
              lines: [10, 19],
              description: "Single-source AMM spot price dependency",
            },
          ],
        },
      ],
      patternsChecked: 5,
      executionTime: 90,
    }),
  })

  await toolHook({
    tool: "argus_solodit_search",
    args: { query: "reentrancy withdraw" },
    result: JSON.stringify({
      results: [
        {
          title: "Reentrancy in withdraw",
          severity: "High",
          description: "State mutation after external call",
          protocol: "Compound",
          url: "https://solodit.xyz/issues/reentrancy-withdraw",
          remediation: "Use CEI and reentrancy guard",
        },
      ],
      totalFound: 1,
      query: "reentrancy withdraw",
    }),
  })

  await toolHook({
    tool: "argus_forge_fuzz",
    args: { target: ".", runs: 256 },
    result: JSON.stringify({
      success: false,
      results: [{ testName: "testFuzzWithdraw", status: "fail", runs: 256, gas: 40000 }],
      counterexamples: [
        {
          testName: "testFuzzWithdraw",
          inputs: { amount: "999999999999" },
          revertReason: "Insufficient balance",
        },
      ],
      totalRuns: 256,
      executionTime: 1800,
    }),
  })

  await toolHook({
    tool: "argus_analyze_contract",
    args: { file_path: "src/Vault.sol" },
    result: JSON.stringify({
      name: "Vault",
      filePath: "src/Vault.sol",
      functions: [],
      stateVars: [],
      inheritance: [],
      accessControlPattern: "ownable",
      externalCalls: [],
      riskIndicators: [],
    }),
  })
}

describe("full audit lifecycle simulation", () => {
  it("slither tool execution populates findings in audit state", async () => {
    const { state, toolHook } = createHarness()

    await toolHook({
      tool: "argus_slither_analyze",
      args: { target: "." },
      result: JSON.stringify({
        success: true,
        findingsCount: 1,
        findings: [
          {
            check: "reentrancy-eth",
            severity: "High",
            confidence: "High",
            description: "External call before state update",
            file: "src/Vault.sol",
            lines: [40, 52],
            source: "slither",
          },
        ],
        executionTime: 1000,
        errors: [],
      }),
    })

    expect(state.findings).toHaveLength(1)
    expect(state.findings[0]?.check).toBe("reentrancy-eth")
    expect(state.findings[0]?.source).toBe("slither")
  })

  it("pattern checker execution populates pattern findings", async () => {
    const { state, toolHook } = createHarness()

    await toolHook({
      tool: "argus_check_patterns",
      args: { target: "." },
      result: JSON.stringify({
        sources: [
          {
            source: "pack-reentrancy",
            matches: [
              {
                pattern: "state-update-after-call",
                severity: "High",
                file: "src/Vault.sol",
                lines: [44, 50],
                description: "State updated after external call",
              },
            ],
          },
        ],
        patternsChecked: 12,
        executionTime: 140,
      }),
    })

    expect(state.findings).toHaveLength(1)
    expect(state.findings[0]?.source).toBe("pattern")
    expect(state.findings[0]?.check).toBe("state-update-after-call")
  })

  it("solodit search captures research evidence", async () => {
    const { state, toolHook } = createHarness()

    await toolHook({
      tool: "argus_solodit_search",
      args: { query: "vault reentrancy" },
      result: JSON.stringify({
        results: [
          {
            title: "Vault withdraw reentrancy",
            severity: "High",
            description: "Known exploit pattern",
            protocol: "Euler",
            url: "https://solodit.xyz/issues/vault-reentrancy",
            remediation: "Use CEI pattern",
          },
        ],
        totalFound: 1,
        query: "vault reentrancy",
      }),
    })

    expect(state.soloditResults).toHaveLength(1)
    expect(state.soloditResults?.[0]?.query).toBe("vault reentrancy")
    expect(state.soloditResults?.[0]?.resultCount).toBe(1)
  })

  it("fuzz test captures counterexample evidence", async () => {
    const { state, toolHook } = createHarness()

    await toolHook({
      tool: "argus_forge_fuzz",
      args: { target: ".", runs: 256 },
      result: JSON.stringify({
        success: false,
        results: [{ testName: "testFuzzWithdraw", status: "fail", runs: 256, gas: 39000 }],
        counterexamples: [
          {
            testName: "testFuzzWithdraw",
            inputs: { amount: "11579208923731619542357" },
            revertReason: "Arithmetic overflow",
          },
        ],
        totalRuns: 256,
        executionTime: 2100,
      }),
    })

    expect(state.fuzzCounterexamples).toHaveLength(1)
    expect(state.fuzzCounterexamples?.[0]?.testName).toBe("testFuzzWithdraw")
    expect(state.fuzzCounterexamples?.[0]?.revertReason).toBe("Arithmetic overflow")
  })

  it("contract analyzer tracks reviewed contracts", async () => {
    const { state, toolHook } = createHarness()

    await toolHook({
      tool: "argus_analyze_contract",
      args: { file_path: "src/Vault.sol" },
      result: JSON.stringify({
        name: "Vault",
        filePath: "src/Vault.sol",
        functions: [],
        stateVars: [],
        inheritance: [],
        accessControlPattern: "custom",
        externalCalls: [],
        riskIndicators: [],
      }),
    })

    expect(state.contractsReviewed).toEqual(["src/Vault.sol"])
  })

  it("cross-tool observations are both retained", async () => {
    const { state, toolHook } = createHarness()

    await toolHook({
      tool: "argus_slither_analyze",
      args: { target: "." },
      result: JSON.stringify({
        success: true,
        findingsCount: 1,
        findings: [
          {
            check: "reentrancy-eth",
            severity: "High",
            confidence: "High",
            description: "Slither finding",
            file: "src/Vault.sol",
            lines: [14, 22],
            source: "slither",
          },
        ],
        executionTime: 1000,
        errors: [],
      }),
    })

    await toolHook({
      tool: "argus_check_patterns",
      args: { target: "." },
      result: JSON.stringify({
        sources: [
          {
            source: "pack-reentrancy",
            matches: [
              {
                pattern: "reentrancy-eth",
                severity: "High",
                file: "src/Vault.sol",
                lines: [14, 22],
                description: "Pattern finding",
              },
            ],
          },
        ],
        patternsChecked: 2,
        executionTime: 75,
      }),
    })

    expect(state.findings).toHaveLength(2)
    expect(state.findings[0]?.source).toBe("slither")
    expect(state.findings[1]?.source).toBe("pattern")
  })

  it("agent context injection reflects accumulated state", async () => {
    const { state, toolHook } = createHarness()
    const tracker = createAgentTracker()
    tracker.chatParamsHook(makeChatParamsInput({ sessionID: "ses-context", agent: "argus" }))

    await runCoreToolSequence(toolHook)
    state.currentPhase = "scanning"

    const hook = createSystemPromptHook({
      getAuditState: () => state,
      getAgentForSession: tracker.getAgentForSession,
      isArgusAgent: tracker.isArgusAgent,
      getEnforcerReminder: createAuditEnforcer(),
    })

    const output = { system: [] as string[] }
    await hook({ sessionID: "ses-context", model: "test-model" }, output)

    expect(output.system).toHaveLength(2)
    expect(output.system[0]).toContain('<argus-context agent="argus">')
    expect(output.system[0]).toContain("Contracts: 1 reviewed")
    expect(output.system[0]).toContain("Findings: Critical=0 High=1 Medium=1 Low=0 Info=0")
    expect(output.system[0]).toContain(
      "Tools: argus_slither_analyze, argus_check_patterns, argus_solodit_search, argus_forge_fuzz, argus_analyze_contract",
    )
  })

  it("enforcer produces phase reminder for argus during audit", async () => {
    const enforcer = createAuditEnforcer()
    const { state } = createHarness()

    state.currentPhase = "scanning"
    state.contractsReviewed.push("src/Vault.sol")
    state.findings.push({
      id: "f-enforcer",
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "External call before state update",
      file: "src/Vault.sol",
      lines: [40, 50],
      source: "manual",
    })

    const reminder = enforcer(state)
    expect(reminder).toContain("current phase: scanning")
    expect(reminder).toContain("Next phase: manual-review")
    expect(reminder).toContain("1 findings, 1 contracts reviewed")
  })

  it("report generation includes provenance appendix with all evidence", async () => {
    const { state, toolHook } = createHarness()
    await runCoreToolSequence(toolHook)
    state.currentPhase = "reporting"

    const result = await executeReportGeneration(
      {
        project_name: "E2EAcceptance",
        scope: ["src/Vault.sol", "src/Oracle.sol"],
        severity_threshold: "low",
        audit_state: JSON.stringify(state),
      },
      createContext(),
    )

    expect(result.report).toContain("## Appendix: Data Provenance")
    expect(result.report).toContain("### Source Breakdown")
    expect(result.report).toContain("| slither | 1 |")
    expect(result.report).toContain("| pattern | 1 |")
    expect(result.report).toContain("### Tool Execution Summary")
    expect(result.report).toContain("argus_slither_analyze")
    expect(result.report).toContain("argus_forge_fuzz")
    expect(result.report).toContain("### Solodit Cross-References")
    expect(result.report).toContain('"reentrancy withdraw" — 1 results')
    expect(result.report).toContain("### Fuzz Evidence")
    expect(result.report).toContain("testFuzzWithdraw")
  })

  it("compaction preserves audit state across context compression", async () => {
    const { state, toolHook } = createHarness()
    await runCoreToolSequence(toolHook)
    state.currentPhase = "testing"

    const compactionHook = createCompactionHook(
      () => state,
      () => null,
    )
    const compacted = await compactionHook({ summary: "Large prior context" })

    expect(compacted).not.toBeNull()
    expect(compacted).toContain("<argus-audit-state>")
    expect(compacted).toContain("Phase: testing")
    expect(compacted).toContain("Contracts Reviewed: src/Vault.sol")
    expect(compacted).toContain(
      "Tools Executed: argus_slither_analyze, argus_check_patterns, argus_solodit_search, argus_forge_fuzz, argus_analyze_contract",
    )
  })

  it("full pipeline: tools -> state -> context -> report", async () => {
    const { state, toolHook } = createHarness("/tmp/e2e-pipeline")
    const tracker = createAgentTracker()
    const enforcer = createAuditEnforcer()

    tracker.chatParamsHook(makeChatParamsInput({ sessionID: "ses-pipeline", agent: "argus" }))

    await runCoreToolSequence(toolHook)
    state.currentPhase = "reporting"

    const systemHook = createSystemPromptHook({
      getAuditState: () => state,
      getAgentForSession: tracker.getAgentForSession,
      isArgusAgent: tracker.isArgusAgent,
      getEnforcerReminder: enforcer,
    })

    const systemOutput = { system: [] as string[] }
    await systemHook({ sessionID: "ses-pipeline", model: "test-model" }, systemOutput)

    const compactionHook = createCompactionHook(
      () => state,
      () => null,
    )
    const compacted = await compactionHook({ summary: "Audit context to compact" })

    const report = await executeReportGeneration(
      {
        project_name: "PipelineProject",
        scope: ["src/Vault.sol", "src/Oracle.sol"],
        severity_threshold: "informational",
        audit_state: JSON.stringify(state),
      },
      createContext(),
    )

    expect(state.findings).toHaveLength(2)
    expect(state.soloditResults).toHaveLength(1)
    expect(state.fuzzCounterexamples).toHaveLength(1)
    expect(state.contractsReviewed).toEqual(["src/Vault.sol"])
    expect(state.toolsExecuted).toHaveLength(5)

    expect(systemOutput.system[0]).toContain('<argus-context agent="argus">')
    expect(systemOutput.system[0]).toContain("Findings: Critical=0 High=1 Medium=1 Low=0 Info=0")
    expect(systemOutput.system[1]).toContain("[Argus Audit Enforcer]")

    expect(compacted).toContain("<argus-audit-state>")
    expect(compacted).toContain("Phase: reporting")

    expect(report.report).toContain("# Security Audit Report — PipelineProject")
    expect(report.report).toContain("## Findings")
    expect(report.report).toContain("## Appendix: Data Provenance")
    expect(report.report).toContain("### Tool Execution Summary")
    expect(report.report).toContain("### Solodit Cross-References")
    expect(report.report).toContain("### Fuzz Evidence")
  })
})
