import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { SCHEMA_VERSION } from "../../src/state/schemas"
import { executeReportGeneration } from "../../src/tools/report-generator-tool"

function createContext(): ToolContext {
  return {
    sessionID: "session-gate",
    messageID: "message-gate",
    agent: "scribe",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: new AbortController().signal,
    metadata() {
      return
    },
    async ask() {
      return
    },
  }
}

function makeReportInput(toolsExecuted: Array<{ tool: string }> = []) {
  return {
    run_id: "run-gate-test",
    seq: 2,
    session_id: "sess-gate-test",
    tool_call_id: "tc-gate",
    source: "argus",
    schema_version: SCHEMA_VERSION,
    projectDir: "/tmp/project",
    findings: [
      {
        id: "f-gate-1",
        check: "reentrancy-eth",
        severity: "High",
        confidence: "High",
        description: "Reentrancy vulnerability",
        file: "src/Vault.sol",
        lines: [10, 15],
        source: "slither",
        run_id: "run-gate-test",
        seq: 1,
        schema_version: SCHEMA_VERSION,
        observation_id: "obs-gate-1",
        issue_fingerprint: "issue-gate-1",
        observation_fingerprint: "obs-fp-gate-1",
        reported_by_agent: "sentinel",
      },
    ],
    toolsExecuted: toolsExecuted.map((t, i) => ({
      ...t,
      startTime: 100 + i * 100,
      endTime: 200 + i * 100,
      success: true,
      findingsCount: 0,
      run_id: "run-gate-test",
      schema_version: SCHEMA_VERSION,
    })),
    scope: ["src/Vault.sol"],
  }
}

describe("tool coverage gate", () => {
  test("enforce mode blocks report when key tools are missing", async () => {
    const reportInput = makeReportInput([])

    await expect(
      executeReportGeneration(
        {
          project_name: "GateTest",
          scope: ["src/Vault.sol"],
          report_input: JSON.stringify(reportInput),
          tool_coverage_policy: "enforce",
        },
        createContext(),
      ),
    ).rejects.toThrow("Tool coverage gate failed")
  })

  test("enforce mode blocks report listing specific missing tools", async () => {
    const reportInput = makeReportInput([
      { tool: "argus_slither_analyze" },
      { tool: "argus_forge_test" },
    ])

    try {
      await executeReportGeneration(
        {
          project_name: "GateTest",
          scope: ["src/Vault.sol"],
          report_input: JSON.stringify(reportInput),
          tool_coverage_policy: "enforce",
        },
        createContext(),
      )
      expect.unreachable("should have thrown")
    } catch (err) {
      const message = (err as Error).message
      expect(message).toContain("patterns")
      expect(message).toContain("solodit")
      expect(message).toContain("analyzer")
      expect(message).not.toContain("slither")
      expect(message).not.toContain("forge-test")
    }
  })

  test("enforce mode allows report when all key tools have been executed", async () => {
    const reportInput = makeReportInput([
      { tool: "argus_slither_analyze" },
      { tool: "argus_forge_test" },
      { tool: "argus_check_patterns" },
      { tool: "argus_solodit_search" },
      { tool: "argus_analyze_contract" },
    ])

    const result = await executeReportGeneration(
      {
        project_name: "GatePassTest",
        scope: ["src/Vault.sol"],
        report_input: JSON.stringify(reportInput),
        tool_coverage_policy: "enforce",
      },
      createContext(),
    )

    expect(result.report).toContain("# Security Audit Report — GatePassTest")
  })

  test("warn mode allows report but adds warning when tools are missing", async () => {
    const reportInput = makeReportInput([])

    const result = await executeReportGeneration(
      {
        project_name: "GateWarnTest",
        scope: ["src/Vault.sol"],
        report_input: JSON.stringify(reportInput),
        tool_coverage_policy: "warn",
      },
      createContext(),
    )

    expect(result.report).toContain("# Security Audit Report")
    expect(result.report).toContain("Completeness Warning")
    expect(result.report).toContain("Tool coverage incomplete")
  })

  test("skip mode generates report without any tool checks", async () => {
    const reportInput = makeReportInput([])

    const result = await executeReportGeneration(
      {
        project_name: "GateSkipTest",
        scope: ["src/Vault.sol"],
        report_input: JSON.stringify(reportInput),
        tool_coverage_policy: "skip",
      },
      createContext(),
    )

    expect(result.report).toContain("# Security Audit Report — GateSkipTest")
    expect(result.report).not.toContain("Tool coverage incomplete")
  })

  test("defaults to enforce for canonical report_input path", async () => {
    const reportInput = makeReportInput([])

    await expect(
      executeReportGeneration(
        {
          project_name: "DefaultEnforceTest",
          scope: ["src/Vault.sol"],
          report_input: JSON.stringify(reportInput),
        },
        createContext(),
      ),
    ).rejects.toThrow("Tool coverage gate failed")
  })

  test("defaults to warn for legacy audit_state path", async () => {
    const auditState = {
      findings: [
        {
          title: "Test Finding",
          severity: "high",
          location: "src/Vault.sol:10-15",
          description: "Test description",
          source: "manual",
        },
      ],
    }

    const result = await executeReportGeneration(
      {
        project_name: "DefaultWarnTest",
        scope: ["src/Vault.sol"],
        audit_state: JSON.stringify(auditState),
      },
      createContext(),
    )

    // Legacy path defaults to warn, so should succeed
    expect(result.report).toContain("# Security Audit Report")
  })
})
