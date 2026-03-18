import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { SCHEMA_VERSION } from "../../src/state/schemas"
import type { Finding } from "../../src/state/types"
import { executeReportGeneration } from "../../src/tools/report-generator-tool"

function createContext(): ToolContext {
  return {
    sessionID: "session-quality",
    messageID: "message-quality",
    agent: "argus",
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

function makeFinding(overrides: Partial<Finding> & Record<string, unknown>): Finding {
  return {
    id: String(overrides.id ?? "f-default"),
    check: String(overrides.check ?? "default-check"),
    severity: (overrides.severity as Finding["severity"]) ?? "Low",
    confidence: (overrides.confidence as Finding["confidence"]) ?? "Medium",
    description: String(overrides.description ?? "default description"),
    file: String(overrides.file ?? "src/Default.sol"),
    lines: (overrides.lines as [number, number]) ?? [1, 1],
    source: (overrides.source as Finding["source"]) ?? "manual",
    remediation: overrides.remediation as string | undefined,
    exploitReference: overrides.exploitReference as string | undefined,
    ...(typeof overrides.impact === "string" ? { impact: overrides.impact } : {}),
    ...(typeof overrides.recommendation === "string"
      ? { recommendation: overrides.recommendation }
      : {}),
    ...(typeof overrides.proofOfConcept === "string"
      ? { proofOfConcept: overrides.proofOfConcept }
      : {}),
  } as Finding
}

describe("report quality gates", () => {
  test("identical input produces identical content hash across 5 runs", async () => {
    const findings: Finding[] = [
      makeFinding({
        id: "h-2",
        check: "high-b",
        severity: "High",
        file: "src/Zeta.sol",
        lines: [20, 20],
        impact: "Unauthorized withdrawals can occur.",
        recommendation: "Add ownership checks before transfers.",
        exploitReference: "PoC: forge test --match-test testUnauthorizedWithdraw",
      }),
      makeFinding({
        id: "c-1",
        check: "critical-a",
        severity: "Critical",
        file: "src/Alpha.sol",
        lines: [9, 12],
        impact: "Protocol insolvency is possible.",
        recommendation: "Patch accounting invariant and add invariant tests.",
        exploitReference: "PoC: differential replay script #12",
      }),
    ]

    const hashes = new Set<string>()
    const contents = new Set<string>()

    for (let i = 0; i < 5; i++) {
      const result = await executeReportGeneration(
        {
          project_name: "DeterminismProject",
          scope: ["src/Alpha.sol", "src/Zeta.sol"],
          severity_threshold: "informational",
          quality_gate_policy: "warn",
          report_input: JSON.stringify({
            run_id: "test-run-1",
            seq: findings.length,
            session_id: "session-1",
            tool_call_id: "tc-report",
            source: "test",
            schema_version: SCHEMA_VERSION,
            projectDir: "/tmp/project",
            findings: findings.map((f, i) => ({
              ...f,
              run_id: "test-run-1",
              seq: i + 1,
              session_id: "session-1",
              tool_call_id: "tc-1",
              source: f.source ?? "slither",
              schema_version: SCHEMA_VERSION,
              observation_id: `obs-${f.id ?? i}`,
              issue_fingerprint: `issue-${f.id ?? i}`,
              observation_fingerprint: `obs-fp-${f.id ?? i}`,
              reported_by_agent: "sentinel" as const,
            })),
            toolsExecuted: [],
            scope: ["src/Alpha.sol", "src/Zeta.sol"],
          }),
          tool_coverage_policy: "skip",
        },
        createContext(),
      )
      hashes.add(result.contentHash)
      contents.add(result.report)
    }

    expect(hashes.size).toBe(1)
    expect(contents.size).toBe(1)
  })

  test("strict mode fails when Critical finding has empty impact", async () => {
    const findings: Finding[] = [
      makeFinding({
        id: "crit-empty-impact",
        check: "critical-impact-gap",
        severity: "Critical",
        impact: "",
        recommendation: "Restrict privileged path and add regression tests.",
        exploitReference: "PoC: exploit tx simulation in test suite",
      }),
    ]

    let thrown = ""
    try {
      await executeReportGeneration(
        {
          project_name: "StrictImpact",
          scope: ["src/Critical.sol"],
          quality_gate_policy: "strict-fail",
          report_input: JSON.stringify({
            run_id: "test-run-1",
            seq: findings.length,
            session_id: "session-1",
            tool_call_id: "tc-report",
            source: "test",
            schema_version: SCHEMA_VERSION,
            projectDir: "/tmp/project",
            findings: findings.map((f, i) => ({
              ...f,
              run_id: "test-run-1",
              seq: i + 1,
              session_id: "session-1",
              tool_call_id: "tc-1",
              source: f.source ?? "slither",
              schema_version: SCHEMA_VERSION,
              observation_id: `obs-${f.id ?? i}`,
              issue_fingerprint: `issue-${f.id ?? i}`,
              observation_fingerprint: `obs-fp-${f.id ?? i}`,
              reported_by_agent: "sentinel" as const,
            })),
            toolsExecuted: [],
            scope: ["src/Critical.sol"],
          }),
          tool_coverage_policy: "skip",
        },
        createContext(),
      )
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }

    expect(thrown).toContain("severity-justification.missing-impact")
  })

  test("strict mode fails when High finding uses generic recommendation", async () => {
    const findings: Finding[] = [
      makeFinding({
        id: "high-generic-rec",
        check: "generic-remediation",
        severity: "High",
        impact: "User funds can be griefed through stale price usage.",
        recommendation:
          "Prioritize remediation before production deployment and validate with focused regression tests.",
        exploitReference: "PoC: stale oracle fork replay",
      }),
    ]

    let thrown = ""
    try {
      await executeReportGeneration(
        {
          project_name: "StrictRecommendation",
          scope: ["src/Oracle.sol"],
          quality_gate_policy: "strict-fail",
          report_input: JSON.stringify({
            run_id: "test-run-1",
            seq: findings.length,
            session_id: "session-1",
            tool_call_id: "tc-report",
            source: "test",
            schema_version: SCHEMA_VERSION,
            projectDir: "/tmp/project",
            findings: findings.map((f, i) => ({
              ...f,
              run_id: "test-run-1",
              seq: i + 1,
              session_id: "session-1",
              tool_call_id: "tc-1",
              source: f.source ?? "slither",
              schema_version: SCHEMA_VERSION,
              observation_id: `obs-${f.id ?? i}`,
              issue_fingerprint: `issue-${f.id ?? i}`,
              observation_fingerprint: `obs-fp-${f.id ?? i}`,
              reported_by_agent: "sentinel" as const,
            })),
            toolsExecuted: [],
            scope: ["src/Oracle.sol"],
          }),
          tool_coverage_policy: "skip",
        },
        createContext(),
      )
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }

    expect(thrown).toContain("severity-justification.missing-recommendation")
  })

  test("warn mode continues and emits machine-readable violations", async () => {
    const findings: Finding[] = [
      makeFinding({
        id: "warn-high",
        check: "warn-case",
        severity: "High",
        impact: "",
        recommendation: "",
      }),
    ]

    const result = await executeReportGeneration(
      {
        project_name: "WarnMode",
        scope: ["src/Warn.sol"],
        quality_gate_policy: "warn",
        report_input: JSON.stringify({
          run_id: "test-run-1",
          seq: findings.length,
          session_id: "session-1",
          tool_call_id: "tc-report",
          source: "test",
          schema_version: SCHEMA_VERSION,
          projectDir: "/tmp/project",
          findings: findings.map((f, i) => ({
            ...f,
            run_id: "test-run-1",
            seq: i + 1,
            session_id: "session-1",
            tool_call_id: "tc-1",
            source: f.source ?? "slither",
            schema_version: SCHEMA_VERSION,
            observation_id: `obs-${f.id ?? i}`,
            issue_fingerprint: `issue-${f.id ?? i}`,
            observation_fingerprint: `obs-fp-${f.id ?? i}`,
            reported_by_agent: "sentinel" as const,
          })),
          toolsExecuted: [],
          scope: ["src/Warn.sol"],
        }),
        tool_coverage_policy: "skip",
      },
      createContext(),
    )

    expect(result.report).toContain("# Security Audit Report — WarnMode")
    expect(result.qualityGates.passed).toBe(false)
    expect(result.qualityGates.violations.length).toBeGreaterThanOrEqual(3)
    expect(result.qualityGates.violations[0]).toHaveProperty("findingId")
    expect(result.qualityGates.violations[0]).toHaveProperty("code")
    expect(result.qualityGates.violations[0]).toHaveProperty("message")
  })

  test("findings are sorted deterministically by severity, file, and line", async () => {
    const findings: Finding[] = [
      makeFinding({
        id: "h-z-20",
        check: "high-z-20",
        severity: "High",
        file: "src/Zeta.sol",
        lines: [20, 21],
        impact: "High impact A",
        recommendation: "Recommendation A",
        exploitReference: "PoC A",
      }),
      makeFinding({
        id: "c-a-8",
        check: "critical-a-8",
        severity: "Critical",
        file: "src/Alpha.sol",
        lines: [8, 9],
        impact: "Critical impact",
        recommendation: "Critical recommendation",
        exploitReference: "PoC C",
      }),
      makeFinding({
        id: "h-a-5",
        check: "high-a-5",
        severity: "High",
        file: "src/Alpha.sol",
        lines: [5, 5],
        impact: "High impact B",
        recommendation: "Recommendation B",
        exploitReference: "PoC B",
      }),
      makeFinding({
        id: "h-a-10",
        check: "high-a-10",
        severity: "High",
        file: "src/Alpha.sol",
        lines: [10, 10],
        impact: "High impact C",
        recommendation: "Recommendation C",
        exploitReference: "PoC D",
      }),
      makeFinding({
        id: "m-a-1",
        check: "medium-a-1",
        severity: "Medium",
        file: "src/Alpha.sol",
        lines: [1, 1],
      }),
    ]

    const result = await executeReportGeneration(
      {
        project_name: "SortOrder",
        scope: ["src/Alpha.sol", "src/Zeta.sol"],
        severity_threshold: "informational",
        quality_gate_policy: "warn",
        report_input: JSON.stringify({
          run_id: "test-run-1",
          seq: findings.length,
          session_id: "session-1",
          tool_call_id: "tc-report",
          source: "test",
          schema_version: SCHEMA_VERSION,
          projectDir: "/tmp/project",
          findings: findings.map((f, i) => ({
            ...f,
            run_id: "test-run-1",
            seq: i + 1,
            session_id: "session-1",
            tool_call_id: "tc-1",
            source: f.source ?? "slither",
            schema_version: SCHEMA_VERSION,
            observation_id: `obs-${f.id ?? i}`,
            issue_fingerprint: `issue-${f.id ?? i}`,
            observation_fingerprint: `obs-fp-${f.id ?? i}`,
            reported_by_agent: "sentinel" as const,
          })),
          toolsExecuted: [],
          scope: ["src/Alpha.sol", "src/Zeta.sol"],
        }),
        tool_coverage_policy: "skip",
      },
      createContext(),
    )

    const critPos = result.report.indexOf("### [CRIT-1] Critical A 8")
    const highAPos = result.report.indexOf("### [HIGH-1] High A 5")
    const highA10Pos = result.report.indexOf("### [HIGH-2] High A 10")
    const highZPos = result.report.indexOf("### [HIGH-3] High Z 20")
    const medPos = result.report.indexOf("### [MED-1] Medium A 1")

    expect(critPos).toBeGreaterThan(-1)
    expect(highAPos).toBeGreaterThan(critPos)
    expect(highA10Pos).toBeGreaterThan(highAPos)
    expect(highZPos).toBeGreaterThan(highA10Pos)
    expect(medPos).toBeGreaterThan(highZPos)
  })
})
