import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import {
  type AuditEvent,
  type ReportInput,
  SCHEMA_VERSION,
  validateReportInput,
} from "../../src/state/schemas"
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

function makeCompleteLifecycleEvents(runId: string, sessionId: string): AuditEvent[] {
  return [
    {
      type: "session.created",
      run_id: runId,
      seq: 1,
      session_id: sessionId,
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_001,
      payload: { scope: ["src/Vault.sol"] },
    },
    {
      type: "tool.started",
      run_id: runId,
      seq: 2,
      session_id: sessionId,
      tool_call_id: "tool-call-structured-1",
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_002,
      payload: { tool: "argus_forge_test" },
    },
    {
      type: "tool.completed",
      run_id: runId,
      seq: 3,
      session_id: sessionId,
      tool_call_id: "tool-call-structured-1",
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_003,
      payload: { tool: "argus_forge_test", success: true, findingsCount: 1 },
    },
    {
      type: "session.deleted",
      run_id: runId,
      seq: 4,
      session_id: sessionId,
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_004,
      payload: {},
    },
  ]
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

  test("strict mode rejects incomplete orchestration with orphaned tools", async () => {
    const reportInput = makeCanonicalReportInput()
    const orphanedEvents: AuditEvent[] = [
      {
        type: "session.created",
        run_id: reportInput.run_id,
        seq: 1,
        session_id: reportInput.session_id,
        source: "argus",
        schema_version: SCHEMA_VERSION,
        timestamp: 1_700_000_000_101,
        payload: { scope: reportInput.scope },
      },
      {
        type: "tool.started",
        run_id: reportInput.run_id,
        seq: 2,
        session_id: reportInput.session_id,
        tool_call_id: "orphaned-tool-call",
        source: "argus",
        schema_version: SCHEMA_VERSION,
        timestamp: 1_700_000_000_102,
        payload: { tool: "argus_forge_test" },
      },
    ]

    expect(
      executeReportGeneration(
        {
          project_name: "StrictPreflight",
          scope: reportInput.scope,
          report_input: JSON.stringify(reportInput),
          preflight_policy: "strict-fail",
        },
        createContext(),
        {
          readEvents: async () => orphanedEvents,
        },
      ),
    ).rejects.toThrow("Preflight failed (strict-fail)")
  })

  test("warn mode succeeds and includes completeness warning section", async () => {
    const reportInput = makeCanonicalReportInput()
    const orphanedEvents: AuditEvent[] = [
      {
        type: "session.created",
        run_id: reportInput.run_id,
        seq: 1,
        session_id: reportInput.session_id,
        source: "argus",
        schema_version: SCHEMA_VERSION,
        timestamp: 1_700_000_000_201,
        payload: { scope: reportInput.scope },
      },
      {
        type: "tool.started",
        run_id: reportInput.run_id,
        seq: 2,
        session_id: reportInput.session_id,
        tool_call_id: "orphaned-tool-call",
        source: "argus",
        schema_version: SCHEMA_VERSION,
        timestamp: 1_700_000_000_202,
        payload: { tool: "argus_forge_test" },
      },
    ]

    const result = await executeReportGeneration(
      {
        project_name: "WarnPreflight",
        scope: reportInput.scope,
        report_input: JSON.stringify(reportInput),
        preflight_policy: "warn",
      },
      createContext(),
      {
        readEvents: async () => orphanedEvents,
      },
    )

    expect(result.findingsCount.high).toBe(1)
    expect(result.report).toContain("⚠ Completeness Warning")
    expect(result.report).toContain("Orphaned tools")
  })

  test("validateReportInput rejects malformed toolsExecuted entries", () => {
    const malformed = {
      ...makeCanonicalReportInput(),
      toolsExecuted: [
        {
          tool: "argus_forge_test",
          startTime: 100,
          endTime: 220,
          findingsCount: 1,
          run_id: "run-structured-1",
          schema_version: SCHEMA_VERSION,
        },
        {
          tool: "argus_check_patterns",
          startTime: 240,
          endTime: 260,
          success: true,
          run_id: "run-structured-1",
          schema_version: SCHEMA_VERSION,
        },
      ],
    }

    const validation = validateReportInput(malformed)
    expect(validation.success).toBe(false)
    if (!validation.success) {
      const fields = validation.errors.map((error) => error.field)
      expect(fields).toContain("toolsExecuted[0].success")
      expect(fields).toContain("toolsExecuted[1].findingsCount")
    }
  })

  test("long-session durable evidence renders without undefined synthesis artifacts", async () => {
    const reportInput = makeCanonicalReportInput()
    const completeEvents = makeCompleteLifecycleEvents(reportInput.run_id, reportInput.session_id)

    const result = await executeReportGeneration(
      {
        project_name: "DurableEvidenceOnly",
        scope: reportInput.scope,
        report_input: JSON.stringify(reportInput),
        preflight_policy: "warn",
      },
      createContext(),
      {
        readEvents: async () => completeEvents,
      },
    )

    expect(result.report).toContain("# Security Audit Report — DurableEvidenceOnly")
    expect(result.report).toContain("### [HIGH-1] Reentrancy Withdraw")
    expect(result.report).not.toContain("undefined")
  })
})
