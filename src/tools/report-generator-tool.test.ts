import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { createAuditArtifactResolver } from "../shared/audit-artifact-resolver"
import { SCHEMA_VERSION } from "../state/schemas"
import type {
  AuditState,
  Finding,
  FuzzCounterexample,
  SoloditResult,
  ToolExecution,
} from "../state/types"
import {
  executeReportGeneration,
  normalizeRawFinding,
  parseLocationString,
  type ReportGenerationResult,
  renderReportMarkdown,
  reportGeneratorTool,
} from "./report-generator-tool"

function createContext(): ToolContext {
  return {
    sessionID: "session-1",
    messageID: "message-1",
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

function makeReportInput(
  findings: Finding[],
  overrides?: Partial<{
    run_id: string
    scope: string[]
    toolsExecuted: ToolExecution[]
    soloditResults: SoloditResult[]
    fuzzCounterexamples: FuzzCounterexample[]
    patternVersion: string
    skillsLoaded: string[]
  }>,
) {
  const runId = overrides?.run_id ?? "test-run-1"
  const normalizeSeverity = (value: unknown): Finding["severity"] => {
    if (typeof value !== "string") return "Informational"
    const lower = value.toLowerCase()
    if (lower === "critical") return "Critical"
    if (lower === "high") return "High"
    if (lower === "medium") return "Medium"
    if (lower === "low") return "Low"
    return "Informational"
  }
  const normalizeConfidence = (value: unknown): Finding["confidence"] => {
    if (typeof value !== "string") return "Low"
    const lower = value.toLowerCase()
    if (lower === "high") return "High"
    if (lower === "medium") return "Medium"
    return "Low"
  }
  const normalizeSource = (value: unknown): Finding["source"] => {
    if (
      value === "slither" ||
      value === "manual" ||
      value === "pattern" ||
      value === "scvd" ||
      value === "solodit" ||
      value === "fuzz"
    ) {
      return value
    }
    return "slither"
  }
  const normalizeAgent = (
    value: unknown,
  ): "argus" | "sentinel" | "pythia" | "scribe" | "unknown" => {
    if (
      value === "argus" ||
      value === "sentinel" ||
      value === "pythia" ||
      value === "scribe" ||
      value === "unknown"
    ) {
      return value
    }
    return "unknown"
  }
  return {
    run_id: runId,
    seq: findings.length,
    session_id: "session-1",
    tool_call_id: "tc-report",
    source: "test",
    schema_version: SCHEMA_VERSION,
    projectDir: "/tmp/project",
    findings: findings.map((f, i) => {
      const raw = normalizeRawFinding(f as unknown as Record<string, unknown>)
      const parsedLocation =
        typeof raw.location === "string" ? parseLocationString(raw.location as string) : undefined
      const check =
        typeof raw.check === "string" && raw.check.trim().length > 0
          ? raw.check
          : `finding-${i + 1}`
      const file =
        typeof raw.file === "string" && raw.file.trim().length > 0
          ? raw.file
          : (parsedLocation?.file ?? "unknown.sol")
      const lines: [number, number] =
        Array.isArray(raw.lines) &&
        raw.lines.length === 2 &&
        typeof raw.lines[0] === "number" &&
        typeof raw.lines[1] === "number"
          ? [raw.lines[0], raw.lines[1]]
          : (parsedLocation?.lines ?? [0, 0])
      const fallbackId = `finding-${i + 1}`
      const id = typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id : fallbackId

      return {
        ...raw,
        id,
        check,
        severity: normalizeSeverity(raw.severity),
        confidence: normalizeConfidence(raw.confidence),
        description:
          typeof raw.description === "string" && raw.description.trim().length > 0
            ? raw.description
            : check,
        file,
        lines,
        source: normalizeSource(raw.source),
        run_id: (raw.run_id as string | undefined) ?? runId,
        seq: typeof raw.seq === "number" && Number.isInteger(raw.seq) ? raw.seq : i + 1,
        session_id: (raw.session_id as string | undefined) ?? "session-1",
        tool_call_id: (raw.tool_call_id as string | undefined) ?? "tc-1",
        schema_version: (raw.schema_version as string | undefined) ?? SCHEMA_VERSION,
        observation_id: (raw.observation_id as string | undefined) ?? `obs-${id}`,
        issue_fingerprint: (raw.issue_fingerprint as string | undefined) ?? `issue-${id}`,
        observation_fingerprint:
          (raw.observation_fingerprint as string | undefined) ?? `observation-${id}`,
        reported_by_agent: normalizeAgent(raw.reported_by_agent),
      }
    }),
    toolsExecuted: (overrides?.toolsExecuted ?? []).map((t) => ({
      ...(t as unknown as Record<string, unknown>),
      tool:
        typeof (t as unknown as Record<string, unknown>).tool === "string" &&
        ((t as unknown as Record<string, unknown>).tool as string).trim().length > 0
          ? ((t as unknown as Record<string, unknown>).tool as string)
          : "(unknown tool)",
      startTime:
        typeof (t as unknown as Record<string, unknown>).startTime === "number" &&
        Number.isInteger((t as unknown as Record<string, unknown>).startTime) &&
        ((t as unknown as Record<string, unknown>).startTime as number) > 0
          ? ((t as unknown as Record<string, unknown>).startTime as number)
          : 1,
      endTime:
        typeof (t as unknown as Record<string, unknown>).endTime === "number" &&
        Number.isInteger((t as unknown as Record<string, unknown>).endTime)
          ? ((t as unknown as Record<string, unknown>).endTime as number)
          : undefined,
      success:
        typeof (t as unknown as Record<string, unknown>).success === "boolean"
          ? ((t as unknown as Record<string, unknown>).success as boolean)
          : false,
      findingsCount:
        typeof (t as unknown as Record<string, unknown>).findingsCount === "number" &&
        Number.isInteger((t as unknown as Record<string, unknown>).findingsCount) &&
        ((t as unknown as Record<string, unknown>).findingsCount as number) >= 0
          ? ((t as unknown as Record<string, unknown>).findingsCount as number)
          : 0,
      run_id: ((t as unknown as Record<string, unknown>).run_id as string | undefined) ?? runId,
      schema_version:
        ((t as unknown as Record<string, unknown>).schema_version as string | undefined) ??
        SCHEMA_VERSION,
    })),
    scope: overrides?.scope ?? ["Vault.sol"],
    soloditResults: overrides?.soloditResults,
    fuzzCounterexamples: overrides?.fuzzCounterexamples,
    patternVersion: overrides?.patternVersion,
    skillsLoaded: overrides?.skillsLoaded,
  }
}

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    id: overrides.id ?? "id-1",
    check: overrides.check ?? "reentrancy-eth",
    severity: overrides.severity ?? "High",
    confidence: overrides.confidence ?? "High",
    description: overrides.description ?? "Potential reentrancy vulnerability",
    file: overrides.file ?? "src/Vault.sol",
    lines: overrides.lines ?? [10, 15],
    source: overrides.source ?? "slither",
    observation_ids: overrides.observation_ids,
    observation_count: overrides.observation_count,
    impact: overrides.impact,
    recommendation: overrides.recommendation,
    proofOfConcept: overrides.proofOfConcept,
    sources: overrides.sources,
    reported_by_agents: overrides.reported_by_agents,
    remediation: overrides.remediation,
    exploitReference: overrides.exploitReference,
  }
}

test("rubric adoption: a verdict-bearing finding is not warned and counts as assessed", () => {
  const confirmed = {
    ...makeFinding({ id: "f-confirmed", description: "Reentrancy in withdraw drains the vault." }),
    rubric_verdict: "CONFIRMED" as const,
  }
  const input = makeReportInput([confirmed], { toolsExecuted: [] })

  const report = renderReportMarkdown(input, { projectName: "Demo" })

  expect(report).not.toContain("no rubric trace")
  expect(report).toContain("1/1 findings assessed via the 4-gate refutation rubric")
})

test("rubric adoption: a finding with neither verdict nor textual trace is flagged and uncounted", () => {
  const bare = makeFinding({
    id: "f-bare",
    description: "Some observation recorded without applying the rubric.",
  })
  const input = makeReportInput([bare], { toolsExecuted: [] })

  const report = renderReportMarkdown(input, { projectName: "Demo" })

  expect(report).toContain("no rubric trace")
  expect(report).toContain("0/1 findings assessed via the 4-gate refutation rubric")
})

test("reportGeneratorTool uses tool() helper contract", () => {
  expect(reportGeneratorTool.description.length).toBeGreaterThan(0)
  expect(reportGeneratorTool.args).toBeDefined()
  expect(Object.keys(reportGeneratorTool.args)).toContain("quality_gate_policy")
  expect(typeof reportGeneratorTool.execute).toBe("function")
})

test("executeReportGeneration creates complete markdown report with findings by severity", async () => {
  const findings: Finding[] = [
    makeFinding({
      id: "f-crit",
      check: "critical-bug",
      severity: "Critical",
      confidence: "High",
      description: "Critical exploit path",
      file: "src/Core.sol",
      lines: [4, 9],
      remediation: "Patch access controls",
    }),
    makeFinding({
      id: "f-high",
      check: "reentrancy-eth",
      severity: "High",
      confidence: "Medium",
      description: "Potential reentrancy vulnerability",
      file: "src/Vault.sol",
      lines: [10, 15],
      remediation: "Use checks-effects-interactions",
    }),
    makeFinding({
      id: "f-medium",
      check: "unsafe-cast",
      severity: "Medium",
      confidence: "High",
      description: "Unsafe type conversion",
      file: "src/Math.sol",
      lines: [20, 22],
    }),
    makeFinding({
      id: "f-low",
      check: "missing-event",
      severity: "Low",
      confidence: "Low",
      description: "Missing event emission",
      file: "src/Vault.sol",
      lines: [44, 44],
    }),
    makeFinding({
      id: "f-info",
      check: "naming",
      severity: "Informational",
      confidence: "Low",
      description: "Naming suggestion",
      file: "src/Token.sol",
      lines: [2, 2],
    }),
  ]

  const result = await executeReportGeneration(
    {
      project_name: "TestVault",
      scope: ["Vault.sol", "Token.sol"],
      severity_threshold: "informational",
      report_input: JSON.stringify(makeReportInput(findings)),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  expect(result.findingsCount).toEqual({
    critical: 1,
    high: 1,
    medium: 1,
    low: 1,
    informational: 1,
  })

  expect(result.report).toContain("# Security Audit Report — TestVault")
  expect(result.report).toContain("## Executive Summary")
  expect(result.report).toContain("## Scope")
  expect(result.report).toContain("## Methodology")
  expect(result.report).toContain("## Findings")
  expect(result.report).toContain("## Recommendations")
  expect(result.report).toContain("## Appendix")
  expect(result.report).toContain("### [CRIT-1] Critical Bug · severity: Critical · evidence: High")
  expect(result.report).toContain("### [HIGH-1] Reentrancy Eth · severity: High · evidence: Medium")
  expect(result.report).toContain("### [MED-1] Unsafe Cast · severity: Medium · evidence: High")
  expect(result.report).toContain("### [LOW-1] Missing Event · severity: Low · evidence: Low")
  expect(result.report).toContain("### [INFO-1] Naming · severity: Informational · evidence: Low")
  expect(result.report).toContain("**Location**: src/Core.sol:4-9")
  expect(result.report).toContain("| Critical | 1 |")
  expect(result.report).toContain("| High | 1 |")
  expect(result.report).toContain("| Medium | 1 |")
  expect(result.report).toContain("| Low | 1 |")
  expect(result.report).toContain("| Informational | 1 |")

  const today = new Date().toISOString().slice(0, 10)
  expect(result.filename).toMatch(new RegExp(`^TestVault-security-audit-${today}(-.{1,8})?\\.md$`))
})

test("executeReportGeneration applies medium severity threshold", async () => {
  const findings: Finding[] = [
    makeFinding({ id: "f-high", check: "reentrancy-eth", severity: "High" }),
    makeFinding({ id: "f-medium", check: "unsafe-cast", severity: "Medium" }),
    makeFinding({ id: "f-low", check: "missing-event", severity: "Low" }),
    makeFinding({ id: "f-info", check: "naming", severity: "Informational" }),
  ]

  const result = await executeReportGeneration(
    {
      project_name: "ThresholdProject",
      scope: ["Vault.sol"],
      severity_threshold: "medium",
      report_input: JSON.stringify(makeReportInput(findings)),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  expect(result.findingsCount).toEqual({
    critical: 0,
    high: 1,
    medium: 1,
    low: 0,
    informational: 0,
  })

  expect(result.report).toContain("### [HIGH-1] Reentrancy Eth · severity: High · evidence: High")
  expect(result.report).toContain("### [MED-1] Unsafe Cast · severity: Medium · evidence: High")
  expect(result.report).not.toContain("severity: Low")
  expect(result.report).not.toContain("severity: Informational")
})

test("executeReportGeneration default threshold includes Informational findings", async () => {
  const findings: Finding[] = [
    makeFinding({ id: "f-low", check: "missing-event", severity: "Low" }),
    makeFinding({ id: "f-info", check: "floating-pragma", severity: "Informational" }),
  ]

  const result = await executeReportGeneration(
    {
      project_name: "DefaultThresholdProject",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(makeReportInput(findings)),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  expect(result.findingsCount).toEqual({
    critical: 0,
    high: 0,
    medium: 0,
    low: 1,
    informational: 1,
  })
  expect(result.report).toContain("### [LOW-1] Missing Event · severity: Low · evidence: High")
  expect(result.report).toContain(
    "### [INFO-1] Floating Pragma · severity: Informational · evidence: High",
  )
  expect(result.report).toContain("| Informational | 1 |")
})

test("executeReportGeneration renders canonical finding fields exactly", async () => {
  const finding = makeFinding({
    id: "f-deadline",
    check: "missing-deadline-parameter-on-wrap-unwrap",
    severity: "Informational",
    confidence: "Medium",
    description:
      "wrap() and unwrap() already implement slippage protection via minWAlphaOut and minAlphaOut; the remaining gap is that neither function accepts a deadline parameter.",
    file: "src/WAlpha.sol",
    lines: [172, 228],
    source: "manual",
    recommendation:
      "Add deadline parameters while preserving the existing minWAlphaOut and minAlphaOut slippage checks.",
  })

  const result = await executeReportGeneration(
    {
      project_name: "FidelityFixture",
      scope: ["src/WAlpha.sol"],
      report_input: JSON.stringify(makeReportInput([finding], { toolsExecuted: [] })),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  expect(result.findingsCount.informational).toBe(1)
  expect(result.findingsCount.low).toBe(0)
  expect(result.report).toContain("**Severity**: Informational")
  expect(result.report).toContain(finding.description)
  expect(result.report).toContain(finding.recommendation as string)
  expect(result.report).not.toContain("do not accept a deadline or minSharesOut / minAlphaOut")
  expect(result.report).not.toContain("lack slippage protection")
})

test("executeReportGeneration includes source excerpts for findings when files are readable", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "argus-report-source-"))
  const sourceDir = path.join(tempDir, "src")
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(
    path.join(sourceDir, "WAlpha.sol"),
    [
      "pragma solidity ^0.8.20;",
      "contract WAlpha {",
      "    function setFeeReceiver(address newReceiver) external {",
      "        if (newReceiver == address(0)) revert WAlpha_ZeroAddress();",
      "    }",
      "}",
    ].join("\n"),
  )

  try {
    const finding = makeFinding({
      id: "f-zero",
      check: "no-zero-coldkey-check-on-set-fee-receiver",
      severity: "Informational",
      confidence: "High",
      description: "setFeeReceiver validates address(0); the missing pre-check is coldkey mapping.",
      file: "src/WAlpha.sol",
      lines: [3, 4],
      source: "manual",
    })
    const input = makeReportInput([finding], { toolsExecuted: [] })
    input.projectDir = tempDir

    const result = await executeReportGeneration(
      {
        project_name: "SourceExcerptFixture",
        scope: ["src/WAlpha.sol"],
        report_input: JSON.stringify(input),
        tool_coverage_policy: "skip",
      },
      createContext(),
    )

    expect(result.report).toContain("**Source Excerpt**")
    expect(result.report).toContain("function setFeeReceiver(address newReceiver) external")
    expect(result.report).toContain("if (newReceiver == address(0)) revert WAlpha_ZeroAddress();")
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("executeReportGeneration supports disabling executive summary", async () => {
  const findings: Finding[] = [
    makeFinding({ id: "f-high", check: "reentrancy-eth", severity: "High" }),
  ]

  const result = await executeReportGeneration(
    {
      project_name: "NoSummary",
      scope: ["Vault.sol"],
      include_executive_summary: false,
      report_input: JSON.stringify(makeReportInput(findings)),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  expect(result.report).not.toContain("## Executive Summary")
  expect(result.report).toContain("## Scope")
  expect(result.report).toContain("## Findings")
})

test("executeReportGeneration handles empty findings after threshold filtering", async () => {
  const findings: Finding[] = [
    makeFinding({ id: "f-low", check: "missing-event", severity: "Low" }),
    makeFinding({ id: "f-info", check: "naming", severity: "Informational" }),
  ]

  const result = await executeReportGeneration(
    {
      project_name: "EmptyReport",
      scope: ["Vault.sol"],
      severity_threshold: "high",
      report_input: JSON.stringify(makeReportInput(findings)),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  expect(result.findingsCount).toEqual({
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
  })
  expect(result.report).not.toContain("## Findings")
  expect(result.report).not.toContain("## Leads")
  expect(result.report).toContain("| Critical | 0 |")
})

test("reportGeneratorTool execute returns stringified ReportGenerationResult", async () => {
  const findings: Finding[] = [
    makeFinding({ id: "f-high", check: "reentrancy-eth", severity: "High" }),
  ]

  const payload = await reportGeneratorTool.execute(
    {
      project_name: "ToolExecuteProject",
      scope: ["Vault.sol"],
      include_executive_summary: true,
      severity_threshold: "low",
      preflight_policy: "warn",
      report_input: JSON.stringify(makeReportInput(findings)),
      tool_coverage_policy: "skip",
    } as Parameters<typeof reportGeneratorTool.execute>[0],
    createContext(),
  )

  const parsed = JSON.parse(payload) as Omit<ReportGenerationResult, "report"> & {
    reportSummary: string
  }
  expect(parsed.reportSummary).toMatch(/Report written to disk \(\d+ bytes/)
  expect(parsed.findingsCount.high).toBe(1)
})

function makeAuditState(overrides: Partial<AuditState> = {}): AuditState {
  return {
    sessionId: "test-session",
    projectDir: "/tmp/project",
    contractsReviewed: [],
    findings: overrides.findings ?? [],
    toolsExecuted: overrides.toolsExecuted ?? [],
    currentPhase: "complete",
    scope: [],
    startTime: 0,
    soloditResults: overrides.soloditResults,
    fuzzCounterexamples: overrides.fuzzCounterexamples,
    patternVersion: overrides.patternVersion,
    skillsLoaded: overrides.skillsLoaded,
  }
}

test("report includes provenance appendix section", async () => {
  const state = makeAuditState({
    findings: [makeFinding({ source: "slither" })],
  })

  const result = await executeReportGeneration(
    {
      project_name: "ProvenanceTest",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(
        makeReportInput(state.findings, {
          toolsExecuted: state.toolsExecuted,
          soloditResults: state.soloditResults,
          fuzzCounterexamples: state.fuzzCounterexamples,
          scope: state.scope,
          patternVersion: state.patternVersion,
          skillsLoaded: state.skillsLoaded,
        }),
      ),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  expect(result.report).toContain("## Appendix: Data Provenance")
  expect(result.report).toContain("Severity threshold applied:")
  expect(result.report).toContain("Findings included in report:")
})

test("provenance appendix shows source breakdown by finding source", async () => {
  const state = makeAuditState({
    findings: [
      makeFinding({ id: "f1", source: "slither" }),
      makeFinding({ id: "f2", source: "slither" }),
      makeFinding({ id: "f3", source: "pattern" }),
      makeFinding({ id: "f4", source: "manual" }),
    ],
  })

  const result = await executeReportGeneration(
    {
      project_name: "SourceBreakdown",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(
        makeReportInput(state.findings, {
          toolsExecuted: state.toolsExecuted,
          soloditResults: state.soloditResults,
          fuzzCounterexamples: state.fuzzCounterexamples,
          scope: state.scope,
          patternVersion: state.patternVersion,
          skillsLoaded: state.skillsLoaded,
        }),
      ),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  expect(result.report).toContain("### Source Breakdown")
  expect(result.report).toContain("| slither | 2 |")
  expect(result.report).toContain("| pattern | 1 |")
  expect(result.report).toContain("| manual | 1 |")
})

test("provenance appendix shows tool execution summary", async () => {
  const toolsExecuted: ToolExecution[] = [
    { tool: "slither_analyze", startTime: 1000, endTime: 4500, success: true, findingsCount: 3 },
    { tool: "forge_test", startTime: 5000, endTime: 8200, success: false, findingsCount: 0 },
  ]

  const state = makeAuditState({
    findings: [makeFinding({})],
    toolsExecuted,
  })

  const result = await executeReportGeneration(
    {
      project_name: "ToolExecTest",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(
        makeReportInput(state.findings, {
          toolsExecuted: state.toolsExecuted,
          soloditResults: state.soloditResults,
          fuzzCounterexamples: state.fuzzCounterexamples,
          scope: state.scope,
          patternVersion: state.patternVersion,
          skillsLoaded: state.skillsLoaded,
        }),
      ),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  expect(result.report).toContain("### Tool Execution Summary")
  expect(result.report).toContain("| slither_analyze |")
  expect(result.report).toContain("3.5s")
  expect(result.report).toContain("✅ success")
  expect(result.report).toContain("| forge_test |")
  expect(result.report).toContain("❌ failure")
})

test("provenance appendix shows solodit cross-references when available", async () => {
  const soloditResults: SoloditResult[] = [
    { query: "reentrancy vault", timestamp: Date.now(), resultCount: 12, topResults: [] },
    { query: "flash loan attack", timestamp: Date.now(), resultCount: 5, topResults: [] },
  ]

  const state = makeAuditState({ soloditResults })

  const result = await executeReportGeneration(
    {
      project_name: "SoloditTest",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(
        makeReportInput(state.findings, {
          toolsExecuted: state.toolsExecuted,
          soloditResults: state.soloditResults,
          fuzzCounterexamples: state.fuzzCounterexamples,
          scope: state.scope,
          patternVersion: state.patternVersion,
          skillsLoaded: state.skillsLoaded,
        }),
      ),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  expect(result.report).toContain("### Solodit Cross-References")
  expect(result.report).toContain('"reentrancy vault" — 12 results')
  expect(result.report).toContain('"flash loan attack" — 5 results')
})

test("provenance appendix shows fuzz evidence when counterexamples exist", async () => {
  const fuzzCounterexamples: FuzzCounterexample[] = [
    {
      testName: "testFuzz_withdraw",
      inputs: ["uint256: 999999"],
      revertReason: "Arithmetic overflow",
      runs: 256,
      seed: 42,
      timestamp: Date.now(),
    },
    {
      testName: "testFuzz_deposit",
      inputs: ["uint256: 0", "address: 0x0"],
      runs: 512,
      timestamp: Date.now(),
    },
  ]

  const state = makeAuditState({ fuzzCounterexamples })

  const result = await executeReportGeneration(
    {
      project_name: "FuzzTest",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(
        makeReportInput(state.findings, {
          toolsExecuted: state.toolsExecuted,
          soloditResults: state.soloditResults,
          fuzzCounterexamples: state.fuzzCounterexamples,
          scope: state.scope,
          patternVersion: state.patternVersion,
          skillsLoaded: state.skillsLoaded,
        }),
      ),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  expect(result.report).toContain("### Fuzz Evidence")
  expect(result.report).toContain("| testFuzz_withdraw |")
  expect(result.report).toContain("Arithmetic overflow")
  expect(result.report).toContain("| testFuzz_deposit |")
  expect(result.report).toContain("uint256: 0, address: 0x0")
})

test("provenance appendix omits sections when no data available", async () => {
  const state = makeAuditState()

  const result = await executeReportGeneration(
    {
      project_name: "EmptyProvenance",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(
        makeReportInput(state.findings, {
          toolsExecuted: state.toolsExecuted,
          soloditResults: state.soloditResults,
          fuzzCounterexamples: state.fuzzCounterexamples,
          scope: state.scope,
          patternVersion: state.patternVersion,
          skillsLoaded: state.skillsLoaded,
        }),
      ),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  expect(result.report).toContain("## Appendix: Data Provenance")
  expect(result.report).not.toContain("### Source Breakdown")
  expect(result.report).not.toContain("### Tool Execution Summary")
  expect(result.report).not.toContain("### Data Freshness")
  expect(result.report).not.toContain("### Solodit Cross-References")
  expect(result.report).not.toContain("### Fuzz Evidence")
  expect(result.report).not.toContain("### Knowledge Sources")
})

test("parseLocationString parses range format File.sol:18-22", () => {
  const result = parseLocationString("src/Vault.sol:18-22")
  expect(result).toEqual({ file: "src/Vault.sol", lines: [18, 22] })
})

test("parseLocationString parses single line format File.sol:18", () => {
  const result = parseLocationString("src/Vault.sol:18")
  expect(result).toEqual({ file: "src/Vault.sol", lines: [18, 18] })
})

test("parseLocationString parses L-prefixed format File.sol:L18-L22", () => {
  const result = parseLocationString("src/Vault.sol:L18-L22")
  expect(result).toEqual({ file: "src/Vault.sol", lines: [18, 22] })
})

test("parseLocationString returns undefined for invalid format", () => {
  expect(parseLocationString("just a string")).toBeUndefined()
  expect(parseLocationString("")).toBeUndefined()
})

test("normalizeRawFinding maps title to check", () => {
  const result = normalizeRawFinding({
    title: "Reentrancy in withdraw",
    file: "Vault.sol",
    lines: [10, 15],
    severity: "High",
  })
  expect(result.check).toBe("Reentrancy in withdraw")
})

test("normalizeRawFinding maps name to check", () => {
  const result = normalizeRawFinding({
    name: "Missing Access Control",
    file: "Vault.sol",
    lines: [18, 22],
    severity: "Critical",
  })
  expect(result.check).toBe("Missing Access Control")
})

test("normalizeRawFinding preserves check when already present", () => {
  const result = normalizeRawFinding({
    check: "reentrancy-eth",
    title: "Some Title",
    file: "Vault.sol",
    lines: [10, 15],
  })
  expect(result.check).toBe("reentrancy-eth")
})

test("normalizeRawFinding parses location string into file and lines", () => {
  const result = normalizeRawFinding({
    title: "Some Bug",
    location: "src/Vault.sol:18-22",
    severity: "High",
  })
  expect(result.file).toBe("src/Vault.sol")
  expect(result.lines).toEqual([18, 22])
})

test("normalizeRawFinding normalizes lowercase severity", () => {
  const result = normalizeRawFinding({
    check: "test",
    file: "Vault.sol",
    lines: [1, 1],
    severity: "critical",
  })
  expect(result.severity).toBe("Critical")
})

test("normalizeRawFinding normalizes info severity alias", () => {
  const result = normalizeRawFinding({
    check: "test",
    file: "Vault.sol",
    lines: [1, 1],
    severity: "info",
  })
  expect(result.severity).toBe("Informational")
})

test("normalizeRawFinding handles line_start and line_end", () => {
  const result = normalizeRawFinding({
    title: "Bug",
    file: "Vault.sol",
    line_start: 10,
    line_end: 20,
    severity: "medium",
  })
  expect(result.lines).toEqual([10, 20])
})

test("normalizeRawFinding handles single line field", () => {
  const result = normalizeRawFinding({
    title: "Bug",
    file: "Vault.sol",
    line: 42,
    severity: "low",
  })
  expect(result.lines).toEqual([42, 42])
})

test("normalizeRawFinding normalizes lowercase confidence", () => {
  const result = normalizeRawFinding({
    check: "test",
    file: "Vault.sol",
    lines: [1, 1],
    confidence: "high",
  })
  expect(result.confidence).toBe("High")
})

test("normalizeRawFinding extracts lines from location even when file is already set", () => {
  const result = normalizeRawFinding({
    title: "Missing Access Control",
    file: "src/VulnerableVault.sol",
    location: "VulnerableVault.sol:18-23",
    severity: "Critical",
  })
  expect(result.file).toBe("src/VulnerableVault.sol")
  expect(result.lines).toEqual([18, 23])
})

test("normalizeRawFinding defaults lines to [0,0] when no line info available", () => {
  const result = normalizeRawFinding({
    title: "Floating Pragma",
    file: "src/Token.sol",
    severity: "Informational",
  })
  expect(result.lines).toEqual([0, 0])
})

test("provenance appendix shows data freshness with pattern version", async () => {
  const state = makeAuditState({ patternVersion: "2.5.0" })

  const result = await executeReportGeneration(
    {
      project_name: "FreshnessTest",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(
        makeReportInput(state.findings, {
          toolsExecuted: state.toolsExecuted,
          soloditResults: state.soloditResults,
          fuzzCounterexamples: state.fuzzCounterexamples,
          scope: state.scope,
          patternVersion: state.patternVersion,
          skillsLoaded: state.skillsLoaded,
        }),
      ),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  expect(result.report).toContain("### Data Freshness")
  expect(result.report).toContain("Pattern pack version: `2.5.0`")
})

test("provenance appendix shows knowledge sources when skills loaded", async () => {
  const state = makeAuditState({
    skillsLoaded: ["reentrancy", "flash-loan-attacks", "oracle-manipulation"],
  })

  const result = await executeReportGeneration(
    {
      project_name: "SkillsTest",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(
        makeReportInput(state.findings, {
          toolsExecuted: state.toolsExecuted,
          soloditResults: state.soloditResults,
          fuzzCounterexamples: state.fuzzCounterexamples,
          scope: state.scope,
          patternVersion: state.patternVersion,
          skillsLoaded: state.skillsLoaded,
        }),
      ),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  expect(result.report).toContain("### Knowledge Sources")
  expect(result.report).toContain("- reentrancy")
  expect(result.report).toContain("- flash-loan-attacks")
  expect(result.report).toContain("- oracle-manipulation")
})

test("provenance appendix omits knowledge sources when none loaded", async () => {
  const state = makeAuditState()

  const result = await executeReportGeneration(
    {
      project_name: "NoSkillsTest",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(
        makeReportInput(state.findings, {
          toolsExecuted: state.toolsExecuted,
          soloditResults: state.soloditResults,
          fuzzCounterexamples: state.fuzzCounterexamples,
          scope: state.scope,
          patternVersion: state.patternVersion,
          skillsLoaded: state.skillsLoaded,
        }),
      ),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  expect(result.report).not.toContain("### Knowledge Sources")
})

test("executeReportGeneration writes report to disk and returns filePath", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "argus-report-"))
  const outputDir = "reports"

  try {
    const findings: Finding[] = [
      makeFinding({ id: "f-disk", check: "disk-write-test", severity: "High" }),
    ]

    const context: ToolContext = {
      ...createContext(),
      directory: tempDir,
    }

    const result = await executeReportGeneration(
      {
        project_name: "DiskWriteTest",
        scope: ["Vault.sol"],
        report_input: JSON.stringify(makeReportInput(findings)),
        tool_coverage_policy: "skip",
      },
      context,
      {
        loadConfig: () => ({
          agents: {
            argus: {},
            sentinel: {},
            pythia: {},
            auditSpecialist: {},
            scribe: {},
            themis: {},
          },
          tools: {},
          knowledge: {
            scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
            autoSync: true,
            skillPrecedence: "bundled-first" as const,
          },
          reporting: {
            confidenceThreshold: 80,
            format: "markdown" as const,
            severityThreshold: "low" as const,
            gasAnalysis: false,
            output_dir: outputDir,
          },
          solodit: { enabled: true, port: 54173 },
          disabled_hooks: [],
          hooks: {},
          cli: {},
          background: { max_concurrent: 3 },
        }),
      },
    )

    expect(result.filePath).toBeDefined()
    expect(typeof result.filePath).toBe("string")
    expect(result.filePath?.startsWith(tempDir)).toBe(true)
    expect(existsSync(result.filePath ?? "")).toBe(true)

    const content = await Bun.file(result.filePath ?? "").text()
    expect(content).toContain("# Security Audit Report — DiskWriteTest")
    expect(content).toContain("### [HIGH-1] Disk Write Test · severity: High · evidence: High")
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("executeReportGeneration returns write error when disk write fails", async () => {
  const findings: Finding[] = [
    makeFinding({ id: "f-fail", check: "write-fail-test", severity: "Low" }),
  ]

  const result = await executeReportGeneration(
    {
      project_name: "WriteFailTest",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(makeReportInput(findings)),
      tool_coverage_policy: "skip",
    },
    createContext(),
    {
      loadConfig: () => {
        throw new Error("Simulated config load failure")
      },
    },
  )

  expect(result.filePath).toBeUndefined()
  expect(result.error?.code).toBe("WRITE_FAILED")
  expect(result.report).toContain("# Security Audit Report — WriteFailTest")
  expect(result.report).toContain("Config load failed")
  expect(result.findingsCount.low).toBe(1)
})

test("executeReportGeneration sanitizes project name for disk filename", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "argus-sanitize-"))
  const outputDir = "reports"

  try {
    const context: ToolContext = {
      ...createContext(),
      directory: tempDir,
    }

    const result = await executeReportGeneration(
      {
        project_name: "My Cool Project!@#$",
        scope: ["Vault.sol"],
        report_input: JSON.stringify(makeReportInput([])),
        tool_coverage_policy: "skip",
      },
      context,
      {
        loadConfig: () => ({
          agents: {
            argus: {},
            sentinel: {},
            pythia: {},
            auditSpecialist: {},
            scribe: {},
            themis: {},
          },
          tools: {},
          knowledge: {
            scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
            autoSync: true,
            skillPrecedence: "bundled-first" as const,
          },
          reporting: {
            confidenceThreshold: 80,
            format: "markdown" as const,
            severityThreshold: "low" as const,
            gasAnalysis: false,
            output_dir: outputDir,
          },
          solodit: { enabled: true, port: 54173 },
          disabled_hooks: [],
          hooks: {},
          cli: {},
          background: { max_concurrent: 3 },
        }),
      },
    )

    expect(result.filePath).toBeDefined()
    const filename = path.basename(result.filePath ?? "")
    expect(filename).toMatch(/^My-Cool-Project-security-audit-\d{4}-\d{2}-\d{2}(-.{1,8})?\.md$/)
    expect(filename).not.toMatch(/[!@#$]/)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("preflight strict-fail throws when events have orphaned tool", async () => {
  const orphanedEvents = [
    {
      type: "session.created" as const,
      run_id: "run-1",
      seq: 1,
      session_id: "sess-1",
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: Date.now(),
      payload: {},
    },
    {
      type: "tool.started" as const,
      run_id: "run-1",
      seq: 2,
      session_id: "sess-1",
      tool_call_id: "orphan-call-1",
      source: "sentinel",
      schema_version: SCHEMA_VERSION,
      timestamp: Date.now(),
      payload: { name: "argus_slither_analyze" },
    },
    // No tool.completed for orphan-call-1 → orphaned
  ]

  const reportInput = {
    run_id: "run-1",
    seq: 3,
    session_id: "sess-1",
    tool_call_id: "tc-report",
    source: "argus",
    schema_version: SCHEMA_VERSION,
    projectDir: "/tmp/project",
    findings: [],
    toolsExecuted: [],
    scope: ["Vault.sol"],
  }

  expect(
    executeReportGeneration(
      {
        project_name: "PreflightStrictTest",
        scope: ["Vault.sol"],
        report_input: JSON.stringify(reportInput),
        preflight_policy: "strict-fail",
        tool_coverage_policy: "skip",
      },
      createContext(),
      {
        readEvents: async () => orphanedEvents,
      },
    ),
  ).rejects.toThrow("Preflight failed (strict-fail)")
})

test("preflight warn mode adds Completeness Warning section", async () => {
  const orphanedEvents = [
    {
      type: "session.created" as const,
      run_id: "run-2",
      seq: 1,
      session_id: "sess-2",
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: Date.now(),
      payload: {},
    },
    {
      type: "tool.started" as const,
      run_id: "run-2",
      seq: 2,
      session_id: "sess-2",
      tool_call_id: "orphan-call-2",
      source: "sentinel",
      schema_version: SCHEMA_VERSION,
      timestamp: Date.now(),
      payload: { name: "argus_slither_analyze" },
    },
    // No tool.completed → orphaned
  ]

  const reportInput = {
    run_id: "run-2",
    seq: 3,
    session_id: "sess-2",
    tool_call_id: "tc-report",
    source: "argus",
    schema_version: SCHEMA_VERSION,
    projectDir: "/tmp/project",
    findings: [],
    toolsExecuted: [],
    scope: ["Vault.sol"],
  }

  const result = await executeReportGeneration(
    {
      project_name: "PreflightWarnTest",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(reportInput),
      preflight_policy: "warn",
      tool_coverage_policy: "skip",
    },
    createContext(),
    {
      readEvents: async () => orphanedEvents,
    },
  )

  expect(result.report).toContain("\u26A0 Completeness Warning")
  expect(result.report).toContain("incomplete orchestration state")
  // allowLiveAudit suppresses the expected mid-audit session.deleted gap but must
  // still surface real integrity issues such as orphaned tools.
  expect(result.report).toContain("Orphaned tools: orphan-call-2")
  expect(result.report).not.toContain("Missing lifecycle")
})

test("executeReportGeneration normalizes incomplete toolsExecuted in report_input", async () => {
  const incompleteReportInput = {
    run_id: "run-incomplete-tools",
    seq: 1,
    session_id: "sess-incomplete-tools",
    tool_call_id: "tc-report-incomplete",
    source: "argus",
    schema_version: SCHEMA_VERSION,
    projectDir: "/tmp/project",
    findings: [],
    toolsExecuted: [
      {
        tool: "argus_forge_test",
      },
    ],
    scope: ["Vault.sol"],
  }

  const result = await executeReportGeneration(
    {
      project_name: "IncompleteToolsExecuted",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(incompleteReportInput),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  expect(result.report).toContain("IncompleteToolsExecuted")
})

test("durable-evidence report path renders without undefined when synthesis text is absent", async () => {
  const reportInput = {
    run_id: "run-durable-only",
    seq: 2,
    session_id: "sess-durable-only",
    tool_call_id: "tc-report-durable",
    source: "argus",
    schema_version: SCHEMA_VERSION,
    projectDir: "/tmp/project",
    findings: [
      {
        id: "f-durable-1",
        check: "reentrancy-withdraw",
        severity: "High",
        confidence: "High",
        description: "State update follows external call",
        file: "src/Vault.sol",
        lines: [42, 55],
        source: "manual",
        run_id: "run-durable-only",
        seq: 2,
        schema_version: SCHEMA_VERSION,
        observation_id: "obs-durable-1",
        issue_fingerprint: "issue-durable-1",
        observation_fingerprint: "observation-durable-1",
        reported_by_agent: "argus",
      },
    ],
    toolsExecuted: [
      {
        tool: "argus_forge_test",
        startTime: 100,
        endTime: 200,
        success: true,
        findingsCount: 1,
        run_id: "run-durable-only",
        schema_version: SCHEMA_VERSION,
      },
    ],
    scope: ["src/Vault.sol"],
  }

  const completeEvents = [
    {
      type: "session.created" as const,
      run_id: "run-durable-only",
      seq: 1,
      session_id: "sess-durable-only",
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_401,
      payload: { scope: ["src/Vault.sol"] },
    },
    {
      type: "tool.started" as const,
      run_id: "run-durable-only",
      seq: 2,
      session_id: "sess-durable-only",
      tool_call_id: "tool-call-durable",
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_402,
      payload: { tool: "argus_forge_test" },
    },
    {
      type: "tool.completed" as const,
      run_id: "run-durable-only",
      seq: 3,
      session_id: "sess-durable-only",
      tool_call_id: "tool-call-durable",
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_403,
      payload: { tool: "argus_forge_test", success: true, findingsCount: 1 },
    },
    {
      type: "session.deleted" as const,
      run_id: "run-durable-only",
      seq: 4,
      session_id: "sess-durable-only",
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_404,
      payload: {},
    },
  ]

  const result = await executeReportGeneration(
    {
      project_name: "DurableOnlyNoSynthesis",
      scope: ["src/Vault.sol"],
      report_input: JSON.stringify(reportInput),
      preflight_policy: "warn",
      tool_coverage_policy: "skip",
    },
    createContext(),
    {
      readEvents: async () => completeEvents,
    },
  )

  expect(result.report).toContain("# Security Audit Report — DurableOnlyNoSynthesis")
  expect(result.report).toContain(
    "### [HIGH-1] Reentrancy Withdraw · severity: High · evidence: High",
  )
  expect(result.report).not.toContain("undefined")
})

test("preflight warn mode succeeds when event read fails", async () => {
  const reportInput = {
    run_id: "run-3",
    seq: 1,
    session_id: "sess-3",
    tool_call_id: "tc-report",
    source: "argus",
    schema_version: SCHEMA_VERSION,
    projectDir: "/tmp/project",
    findings: [],
    toolsExecuted: [],
    scope: ["Vault.sol"],
  }

  const result = await executeReportGeneration(
    {
      project_name: "PreflightWarnFallback",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(reportInput),
      preflight_policy: "warn",
      tool_coverage_policy: "skip",
    },
    createContext(),
    {
      readEvents: async () => {
        throw new Error("Event file not found")
      },
    },
  )

  // Should succeed — no throw in warn mode
  expect(result.report).toContain("# Security Audit Report")
  expect(result.report).not.toContain("Completeness Warning")
})

test("preflight warn mode emits lineage warning for semantic dedup without observation ids", async () => {
  const rawReportInput = makeReportInput([
    makeFinding({ id: "raw-1", check: "reentrancy-eth", file: "src/Vault.sol", lines: [10, 15] }),
    makeFinding({
      id: "raw-2",
      check: "reentrancy-cei-violation",
      file: "src/Vault.sol",
      lines: [10, 15],
    }),
  ])

  const dedupedReportInput = makeReportInput([
    makeFinding({
      id: "deduped-1",
      check: "reentrancy-withdraw",
      description: "Scribe merged multiple reentrancy observations into one finding",
      file: "src/Vault.sol",
      lines: [10, 15],
    }),
  ])

  const events = [
    {
      type: "session.created" as const,
      run_id: "test-run-1",
      seq: 1,
      session_id: "session-1",
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_001,
      payload: {},
    },
    ...rawReportInput.findings.map((finding, index) => ({
      type: "finding.added" as const,
      run_id: "test-run-1",
      seq: index + 2,
      session_id: "session-1",
      tool_call_id: `finding-${index + 1}`,
      source: "sentinel",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_002 + index,
      payload: finding,
    })),
    {
      type: "session.deleted" as const,
      run_id: "test-run-1",
      seq: 4,
      session_id: "session-1",
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_004,
      payload: {},
    },
  ]

  const result = await executeReportGeneration(
    {
      project_name: "SemanticDedupNoLineage",
      scope: ["src/Vault.sol"],
      report_input: JSON.stringify(dedupedReportInput),
      preflight_policy: "warn",
      tool_coverage_policy: "skip",
    },
    createContext(),
    {
      readEvents: async () => events,
    },
  )

  expect(result.report).not.toContain("Finding parity mismatch")
  expect(result.report).toContain("Completeness Warning")
  expect(result.report).toContain("Finding parity not verifiable")
  expect(result.report).toContain("observation_ids")
})

test("preflight warn mode emits lineage warning for partial observation ids", async () => {
  const rawReportInput = makeReportInput([
    makeFinding({ id: "raw-1", check: "reentrancy-eth", file: "src/Vault.sol", lines: [10, 15] }),
    makeFinding({ id: "raw-2", check: "unchecked-call", file: "src/Vault.sol", lines: [20, 22] }),
  ])

  const partialReportInput = makeReportInput([
    makeFinding({
      id: "deduped-1",
      check: "reentrancy-withdraw",
      file: "src/Vault.sol",
      lines: [10, 15],
      observation_ids: ["obs-raw-1"],
      observation_count: 1,
    }),
    makeFinding({
      id: "deduped-2",
      check: "unchecked-call",
      file: "src/Vault.sol",
      lines: [20, 22],
    }),
  ])

  const events = [
    {
      type: "session.created" as const,
      run_id: "test-run-1",
      seq: 1,
      session_id: "session-1",
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_001,
      payload: {},
    },
    ...rawReportInput.findings.map((finding, index) => ({
      type: "finding.added" as const,
      run_id: "test-run-1",
      seq: index + 2,
      session_id: "session-1",
      tool_call_id: `finding-${index + 1}`,
      source: "sentinel",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_002 + index,
      payload: finding,
    })),
    {
      type: "session.deleted" as const,
      run_id: "test-run-1",
      seq: 4,
      session_id: "session-1",
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_004,
      payload: {},
    },
  ]

  const result = await executeReportGeneration(
    {
      project_name: "PartialLineage",
      scope: ["src/Vault.sol"],
      report_input: JSON.stringify(partialReportInput),
      preflight_policy: "warn",
      tool_coverage_policy: "skip",
    },
    createContext(),
    { readEvents: async () => events },
  )

  expect(result.report).toContain("Completeness Warning")
  expect(result.report).toContain("partial dedup lineage")
  expect(result.report).toContain("observation_ids")
  expect(result.report).not.toContain("Finding parity mismatch")
})

test("preflight accepts semantic dedup when observation_ids cover raw findings", async () => {
  const rawReportInput = makeReportInput([
    makeFinding({ id: "raw-1", check: "reentrancy-eth", file: "src/Vault.sol", lines: [10, 15] }),
    makeFinding({
      id: "raw-2",
      check: "reentrancy-cei-violation",
      file: "src/Vault.sol",
      lines: [10, 15],
    }),
  ])

  const dedupedReportInput = makeReportInput([
    makeFinding({
      id: "deduped-1",
      check: "reentrancy-withdraw",
      description: "Scribe merged multiple reentrancy observations into one finding",
      file: "src/Vault.sol",
      lines: [10, 15],
      observation_ids: ["obs-raw-1", "obs-raw-2"],
      observation_count: 2,
    }),
  ])

  const events = [
    {
      type: "session.created" as const,
      run_id: "test-run-1",
      seq: 1,
      session_id: "session-1",
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_001,
      payload: {},
    },
    ...rawReportInput.findings.map((finding, index) => ({
      type: "finding.added" as const,
      run_id: "test-run-1",
      seq: index + 2,
      session_id: "session-1",
      tool_call_id: `finding-${index + 1}`,
      source: "sentinel",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_002 + index,
      payload: finding,
    })),
    {
      type: "session.deleted" as const,
      run_id: "test-run-1",
      seq: 4,
      session_id: "session-1",
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_004,
      payload: {},
    },
  ]

  const result = await executeReportGeneration(
    {
      project_name: "SemanticDedupWithLineage",
      scope: ["src/Vault.sol"],
      report_input: JSON.stringify(dedupedReportInput),
      preflight_policy: "warn",
      tool_coverage_policy: "skip",
    },
    createContext(),
    { readEvents: async () => events },
  )

  expect(result.report).not.toContain("Completeness Warning")
  expect(result.report).not.toContain("Finding parity not verifiable")
  expect(result.report).not.toContain("Finding parity mismatch")
})

test("preflight strict-fail throws when event read fails", async () => {
  const reportInput = {
    run_id: "run-4",
    seq: 1,
    session_id: "sess-4",
    tool_call_id: "tc-report",
    source: "argus",
    schema_version: SCHEMA_VERSION,
    projectDir: "/tmp/project",
    findings: [],
    toolsExecuted: [],
    scope: ["Vault.sol"],
  }

  expect(
    executeReportGeneration(
      {
        project_name: "PreflightStrictNoEvents",
        scope: ["Vault.sol"],
        report_input: JSON.stringify(reportInput),
        preflight_policy: "strict-fail",
        tool_coverage_policy: "skip",
      },
      createContext(),
      {
        readEvents: async () => {
          throw new Error("Event file not found")
        },
      },
    ),
  ).rejects.toThrow("unable to read event stream")
})

test("preflight strict-fail rejects findings outside requested scope", async () => {
  const reportInput = makeReportInput([
    makeFinding({ file: "src/Vault.sol", lines: [10, 15] }),
    makeFinding({ id: "out-of-scope", file: "src/Token.sol", lines: [1, 3] }),
  ])
  const events = [
    {
      type: "session.created" as const,
      run_id: "test-run-1",
      seq: 1,
      session_id: "session-1",
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: 1,
      payload: {},
    },
    {
      type: "session.deleted" as const,
      run_id: "test-run-1",
      seq: 2,
      session_id: "session-1",
      source: "argus",
      schema_version: SCHEMA_VERSION,
      timestamp: 2,
      payload: {},
    },
  ]

  expect(
    executeReportGeneration(
      {
        project_name: "StrictScopeTest",
        scope: ["src/Vault.sol"],
        report_input: JSON.stringify(reportInput),
        preflight_policy: "strict-fail",
        tool_coverage_policy: "skip",
      },
      createContext(),
      { readEvents: async () => events },
    ),
  ).rejects.toThrow("findings outside audited scope")
})

test("strict-fail rejects report_input run_id that uses ses_ session identifier", async () => {
  const reportInput = {
    run_id: "ses_abc123",
    seq: 1,
    session_id: "ses_abc123",
    tool_call_id: "tc-report",
    source: "argus",
    schema_version: SCHEMA_VERSION,
    projectDir: "/tmp/project",
    findings: [],
    toolsExecuted: [],
    scope: ["Vault.sol"],
  }

  expect(
    executeReportGeneration(
      {
        project_name: "SessionRunIdMismatch",
        scope: ["Vault.sol"],
        report_input: JSON.stringify(reportInput),
        preflight_policy: "strict-fail",
      },
      createContext(),
    ),
  ).rejects.toThrow("run_id/session_id conflation")
})

test("accepts report_input with canonical run_id from context", async () => {
  const context: ToolContext = {
    ...createContext(),
    sessionID: "ses_parent_writer",
  }

  const result = await executeReportGeneration(
    {
      project_name: "LegacyRunNormalization",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(
        makeReportInput([makeFinding({ id: "legacy-finding-1" })], {
          run_id: "run-canonical-legacy",
        }),
      ),
      tool_coverage_policy: "skip",
    },
    context,
    {
      resolveCanonicalRunId: () => "run-canonical-legacy",
    },
  )

  expect(result.run_id).toBe("run-canonical-legacy")
  expect(result.report).toContain(
    '<!-- argus:report_metadata {"run_id":"run-canonical-legacy","policy_version":"1.0.0"} -->',
  )
})

test("accepts report_input with proper run_id when canonical resolver is unavailable", async () => {
  const context: ToolContext = {
    ...createContext(),
    sessionID: "ses_parent_writer",
  }

  const result = await executeReportGeneration(
    {
      project_name: "LegacyRunRejection",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(
        makeReportInput([makeFinding({ id: "legacy-finding-2" })], {
          run_id: "run-provided-input",
        }),
      ),
      tool_coverage_policy: "skip",
    },
    context,
    {
      resolveCanonicalRunId: () => undefined,
    },
  )

  expect(result.run_id).toBe("run-provided-input")
  expect(result.report).toContain(
    '<!-- argus:report_metadata {"run_id":"run-provided-input","policy_version":"1.0.0"} -->',
  )
})

test("rejects report_input when explicit run_id mismatches report_input run_id", async () => {
  const reportInput = {
    run_id: "run-from-report-input",
    seq: 1,
    session_id: "ses_report_writer",
    tool_call_id: "tc-report",
    source: "argus",
    schema_version: SCHEMA_VERSION,
    projectDir: "/tmp/project",
    findings: [],
    toolsExecuted: [],
    scope: ["Vault.sol"],
  }

  expect(
    executeReportGeneration(
      {
        project_name: "RunIdMismatch",
        scope: ["Vault.sol"],
        run_id: "run-canonical",
        report_input: JSON.stringify(reportInput),
      },
      createContext(),
    ),
  ).rejects.toThrow("canonical run_id")
})

test("rejects report_input when canonical run inferred from session mismatches", async () => {
  const reportInput = {
    run_id: "run-from-report-input",
    seq: 1,
    session_id: "ses_report_writer",
    tool_call_id: "tc-report",
    source: "argus",
    schema_version: SCHEMA_VERSION,
    projectDir: "/tmp/project",
    findings: [],
    toolsExecuted: [],
    scope: ["Vault.sol"],
  }

  const context: ToolContext = {
    ...createContext(),
    sessionID: "ses_subagent_writer",
  }

  expect(
    executeReportGeneration(
      {
        project_name: "InferredRunIdMismatch",
        scope: ["Vault.sol"],
        report_input: JSON.stringify(reportInput),
      },
      context,
      {
        resolveCanonicalRunId: () => "run-canonical",
      },
    ),
  ).rejects.toThrow("canonical run_id")
})

test("filename date matches body audit date (parity)", async () => {
  // The date in the report body ("Audit date: YYYY-MM-DD") must match the date in the filename
  const result = await executeReportGeneration(
    {
      project_name: "ParityProject",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(makeReportInput([])),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  // Extract date from filename: ParityProject-security-audit-YYYY-MM-DD[-runId8].md
  const filenameMatch = result.filename.match(/-(\d{4}-\d{2}-\d{2})(?:-.{1,8})?\.md$/)
  expect(filenameMatch).not.toBeNull()
  if (!filenameMatch) {
    throw new Error("expected filename to contain date suffix")
  }
  const filenameDate = filenameMatch[1]

  // Extract date from report body: "Audit date: YYYY-MM-DD"
  const bodyMatch = result.report.match(/Audit date: (\d{4}-\d{2}-\d{2})/)
  expect(bodyMatch).not.toBeNull()
  if (!bodyMatch) {
    throw new Error("expected report body to contain audit date")
  }
  const bodyDate = bodyMatch[1]

  expect(filenameDate).toBe(bodyDate)
})

test("tool execution summary renders stable values for valid execution rows", async () => {
  const toolsExecuted: ToolExecution[] = [
    { tool: "slither_analyze", startTime: 1000, endTime: 4500, success: true, findingsCount: 3 },
    { tool: "forge_test", startTime: 5000, endTime: 8200, success: false, findingsCount: 0 },
  ]

  const state = makeAuditState({
    findings: [makeFinding({})],
    toolsExecuted,
  })

  const result = await executeReportGeneration(
    {
      project_name: "StableValuesTest",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(
        makeReportInput(state.findings, {
          toolsExecuted: state.toolsExecuted,
          soloditResults: state.soloditResults,
          fuzzCounterexamples: state.fuzzCounterexamples,
          scope: state.scope,
          patternVersion: state.patternVersion,
          skillsLoaded: state.skillsLoaded,
        }),
      ),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  // Valid rows should render their literal values, not N/A or malformed
  expect(result.report).toContain("| slither_analyze | 3.5s | \u2705 success | 3 |")
  expect(result.report).toContain("| forge_test | 3.2s | \u274C failure | 0 |")
})

test("malformed execution row never prints undefined in tool summary", async () => {
  // Construct an AuditState with a deliberately malformed toolsExecuted entry
  // by casting through unknown to bypass TypeScript type checks
  const malformedExec = {
    // tool: missing
    // startTime: missing
    // endTime: missing
    // success: missing (not boolean)
    // findingsCount: missing (not number)
  } as unknown as ToolExecution

  const partialExec = {
    tool: "partial_tool",
    startTime: undefined as unknown as number,
    endTime: undefined as unknown as number,
    success: "yes" as unknown as boolean,
    findingsCount: "three" as unknown as number,
  } as unknown as ToolExecution

  const state = makeAuditState({
    findings: [makeFinding({})],
    toolsExecuted: [malformedExec, partialExec],
  })

  const result = await executeReportGeneration(
    {
      project_name: "MalformedExecTest",
      scope: ["Vault.sol"],
      report_input: JSON.stringify(
        makeReportInput(state.findings, {
          toolsExecuted: state.toolsExecuted,
          soloditResults: state.soloditResults,
          fuzzCounterexamples: state.fuzzCounterexamples,
          scope: state.scope,
          patternVersion: state.patternVersion,
          skillsLoaded: state.skillsLoaded,
        }),
      ),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  // The word "undefined" must NEVER appear in the rendered report
  expect(result.report).not.toContain("undefined")
  // NaN must NEVER appear in the rendered report
  expect(result.report).not.toContain("NaN")

  expect(result.report).toContain("N/A")
  expect(result.report).toContain("(unknown tool)")
  expect(result.report).toContain("\u274C failure")
  expect(result.report).toContain("### Tool Execution Summary")
})

test("executeReportGeneration falls back to run_id disk report-input.json", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "argus-report-run-id-fallback-"))
  const runId = "run-disk-fallback"

  try {
    const reportInputFile = createAuditArtifactResolver(runId, tempDir).paths().reportInputFile
    mkdirSync(path.dirname(reportInputFile), { recursive: true })
    writeFileSync(
      reportInputFile,
      JSON.stringify(
        {
          run_id: runId,
          seq: 2,
          session_id: "sess-disk-fallback",
          tool_call_id: "tc-disk-fallback",
          source: "argus",
          schema_version: SCHEMA_VERSION,
          projectDir: tempDir,
          findings: [
            {
              id: "f-disk-fallback-1",
              check: "disk-fallback-check",
              severity: "High",
              confidence: "High",
              description: "Finding loaded from report-input disk artifact",
              file: "src/Vault.sol",
              lines: [12, 19],
              source: "manual",
              run_id: runId,
              seq: 1,
              schema_version: SCHEMA_VERSION,
              observation_id: "obs-disk-fallback-1",
              issue_fingerprint: "issue-disk-fallback-1",
              observation_fingerprint: "observation-disk-fallback-1",
              reported_by_agent: "argus",
            },
          ],
          toolsExecuted: [],
          scope: ["src/Vault.sol"],
        },
        null,
        2,
      ),
    )

    const context: ToolContext = {
      ...createContext(),
      directory: tempDir,
      worktree: tempDir,
    }

    const result = await executeReportGeneration(
      {
        project_name: "TestProject",
        scope: ["Vault.sol"],
        run_id: runId,
        tool_coverage_policy: "skip",
      },
      context,
    )

    expect(result.run_id).toBe(runId)
    expect(result.findingsCount.high).toBe(1)
    expect(result.report).toContain(
      "### [HIGH-1] Disk Fallback Check · severity: High · evidence: High",
    )
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("executeReportGeneration accepts Scribe-style deduped findings without canonical envelope (Task 3 / Bug #1)", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "argus-report-deduped-task3-"))
  const runId = "run-deduped-task3"

  try {
    const resolver = createAuditArtifactResolver(runId, tempDir)
    const dedupedPath = resolver.paths().dedupedFindingsFile
    mkdirSync(path.dirname(dedupedPath), { recursive: true })
    writeFileSync(
      dedupedPath,
      JSON.stringify({
        run_id: runId,
        schema_version: SCHEMA_VERSION,
        deduped_at: Date.now(),
        deduped_by: "scribe",
        findings_count: 2,
        findings: [
          {
            check: "reentrancy-drain",
            severity: "Critical",
            confidence: "High",
            description: "Cross-function reentrancy enables vault drain",
            file: "src/Vault.sol",
            lines: [42, 58],
            source: "slither",
            impact: "Complete loss of all deposited funds via reentrant withdraw",
            recommendation: "Add nonReentrant modifier and switch to checks-effects-interactions",
            proofOfConcept: "forge test --match-test testReentrancyDrain -vvvv",
          },
          {
            check: "missing-access-control",
            severity: "High",
            confidence: "High",
            description: "withdraw() lacks authorization check",
            file: "src/Vault.sol",
            lines: [60, 65],
            source: "manual",
            impact: "Any address can drain other users' balances",
            recommendation: "Add onlyOwner modifier or require(msg.sender == owner)",
          },
        ],
      }),
    )

    const context: ToolContext = {
      ...createContext(),
      directory: tempDir,
      worktree: tempDir,
    }

    const result = await executeReportGeneration(
      {
        project_name: "DedupedTask3",
        scope: ["src/Vault.sol"],
        run_id: runId,
        tool_coverage_policy: "skip",
      },
      context,
    )

    expect(result.run_id).toBe(runId)
    expect(result.findingsCount.critical).toBe(1)
    expect(result.findingsCount.high).toBe(1)
    expect(result.report).toContain("Complete loss of all deposited funds via reentrant withdraw")
    expect(result.report).toContain("Add nonReentrant modifier")
    expect(result.report).not.toContain("Impact details were not provided")
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("citable finding IDs stay stable across report revisions", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "argus-stable-ids-"))
  const runId = "run-stable-ids"
  const context: ToolContext = { ...createContext(), directory: tempDir, worktree: tempDir }

  const idByTitle = (report: string): Map<string, string> => {
    const map = new Map<string, string>()
    const re = /^### \[([A-Za-z]+-\d+)\] (.+?) · severity:/gm
    for (let m = re.exec(report); m !== null; m = re.exec(report)) {
      map.set(m[2] as string, m[1] as string)
    }
    return map
  }

  const finding = (id: string, check: string, line: number): Finding =>
    ({
      id,
      check,
      severity: "Critical",
      confidence: "High",
      description: `${check} description`,
      file: "src/Vault.sol",
      lines: [line, line],
      source: "manual",
      impact: "impact",
      recommendation: "recommendation",
    }) as Finding

  try {
    const rev1 = await executeReportGeneration(
      {
        project_name: "StableIds",
        scope: ["src/Vault.sol"],
        run_id: runId,
        report_input: JSON.stringify(
          makeReportInput([finding("alpha", "alpha-bug", 10), finding("bravo", "bravo-bug", 20)], {
            run_id: runId,
            scope: ["src/Vault.sol"],
          }),
        ),
        tool_coverage_policy: "skip",
      },
      context,
    )
    const ids1 = idByTitle(rev1.report)
    const alphaId = ids1.get("Alpha Bug")
    const bravoId = ids1.get("Bravo Bug")
    expect(alphaId).toBeDefined()
    expect(bravoId).toBeDefined()
    expect(alphaId).not.toBe(bravoId)

    // Revision 2 inserts "charlie" which sorts FIRST by line number. It must not steal
    // alpha's/bravo's existing IDs — they stay pinned, charlie takes the next free number.
    const rev2 = await executeReportGeneration(
      {
        project_name: "StableIds",
        scope: ["src/Vault.sol"],
        run_id: runId,
        revision: 2,
        report_input: JSON.stringify(
          makeReportInput(
            [
              finding("alpha", "alpha-bug", 10),
              finding("bravo", "bravo-bug", 20),
              finding("charlie", "charlie-bug", 5),
            ],
            { run_id: runId, scope: ["src/Vault.sol"] },
          ),
        ),
        tool_coverage_policy: "skip",
      },
      context,
    )
    const ids2 = idByTitle(rev2.report)
    expect(ids2.get("Alpha Bug")).toBe(alphaId as string)
    expect(ids2.get("Bravo Bug")).toBe(bravoId as string)
    expect(ids2.get("Charlie Bug")).toBeDefined()
    expect(ids2.get("Charlie Bug")).not.toBe(alphaId as string)
    expect(ids2.get("Charlie Bug")).not.toBe(bravoId as string)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
