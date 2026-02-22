import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { type ReportInput, SCHEMA_VERSION } from "../../src/state/schemas"
import { executeReportGeneration } from "../../src/tools/report-generator-tool"

function createContext(): ToolContext {
  return {
    sessionID: "session-report-contract",
    messageID: "message-report-contract",
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

function makeCanonicalReportInput(): ReportInput {
  return {
    run_id: "run-structured-1",
    seq: 7,
    session_id: "session-structured-1",
    tool_call_id: "tool-call-structured-1",
    source: "argus",
    schema_version: SCHEMA_VERSION,
    projectDir: "/tmp/project",
    findings: [
      {
        id: "finding-1",
        check: "reentrancy-withdraw",
        severity: "High",
        confidence: "High",
        description: "External call before state update in withdraw",
        file: "src/Vault.sol",
        lines: [18, 24],
        source: "manual",
        run_id: "run-structured-1",
        seq: 7,
        schema_version: SCHEMA_VERSION,
      },
    ],
    toolsExecuted: [
      {
        tool: "argus_forge_test",
        startTime: 100,
        endTime: 220,
        success: true,
        findingsCount: 1,
        run_id: "run-structured-1",
        schema_version: SCHEMA_VERSION,
      },
    ],
    scope: ["src/Vault.sol"],
  }
}

describe("report input contract", () => {
  test("accepts canonical ReportInput end-to-end", async () => {
    const result = await executeReportGeneration(
      {
        project_name: "ContractFlow",
        scope: ["src/Vault.sol"],
        report_input: JSON.stringify(makeCanonicalReportInput()),
      },
      createContext(),
    )

    expect(result.report).toContain("# Security Audit Report — ContractFlow")
    expect(result.findingsCount.high).toBe(1)
    expect(result.contractDiagnostics).toHaveLength(0)
    expect(result.report).toContain("### [HIGH-1] Reentrancy Withdraw")
  })

  test("legacy audit_state payload emits explicit deprecation diagnostics", async () => {
    const result = await executeReportGeneration(
      {
        project_name: "LegacyFlow",
        scope: ["src/LegacyVault.sol"],
        audit_state: JSON.stringify({
          findings: [
            {
              title: "Missing Access Control",
              severity: "high",
              location: "src/LegacyVault.sol:33-40",
              description: "setAdmin can be called by arbitrary user",
              source: "manual",
              impact: "Arbitrary admin takeover.",
              recommendation: "Restrict setAdmin with onlyOwner.",
              proofOfConcept: "forge test --match-test testSetAdminHijack",
            },
          ],
        }),
      },
      createContext(),
    )

    const codes = result.contractDiagnostics.map((d) => d.reason.code)
    expect(codes).toContain("REPORT_INPUT_DEPRECATED_LEGACY_PAYLOAD")
    expect(codes).toContain("REPORT_INPUT_SYNTHESIZED_SESSION")
    expect(codes).toContain("REPORT_INPUT_SYNTHESIZED_PROJECT_DIR")
    expect(result.findingsCount.high).toBe(1)
    expect(result.report).toContain("# Security Audit Report — LegacyFlow")
  })
})
