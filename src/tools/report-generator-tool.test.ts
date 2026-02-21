import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import type {
  AuditState,
  Finding,
  FuzzCounterexample,
  SoloditResult,
  ToolExecution,
} from "../state/types"
import {
  executeReportGeneration,
  parseAuditState,
  type ReportGenerationResult,
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
    remediation: overrides.remediation,
    exploitReference: overrides.exploitReference,
  }
}

test("reportGeneratorTool uses tool() helper contract", () => {
  expect(reportGeneratorTool.description.length).toBeGreaterThan(0)
  expect(reportGeneratorTool.args).toBeDefined()
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
      audit_state: JSON.stringify({ findings }),
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
  expect(result.report).toContain("### Critical")
  expect(result.report).toContain("### High")
  expect(result.report).toContain("### Medium")
  expect(result.report).toContain("### Low")
  expect(result.report).toContain("### Informational")
  expect(result.report).toContain("### [CRIT-1] Critical Bug")
  expect(result.report).toContain("### [HIGH-1] Reentrancy Eth")
  expect(result.report).toContain("### [MED-1] Unsafe Cast")
  expect(result.report).toContain("### [LOW-1] Missing Event")
  expect(result.report).toContain("### [INFO-1] Naming")
  expect(result.report).toContain("**Location**: src/Core.sol:4-9")
  expect(result.report).toContain("| Critical | 1 |")
  expect(result.report).toContain("| High | 1 |")
  expect(result.report).toContain("| Medium | 1 |")
  expect(result.report).toContain("| Low | 1 |")
  expect(result.report).toContain("| Informational | 1 |")

  const today = new Date().toISOString().slice(0, 10)
  expect(result.filename).toBe(`TestVault-audit-report-${today}.md`)
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
      audit_state: JSON.stringify(findings),
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

  expect(result.report).toContain("### High")
  expect(result.report).toContain("### Medium")
  expect(result.report).not.toContain("### Low")
  expect(result.report).not.toContain("### Informational")
  expect(result.report).toContain("### [HIGH-1] Reentrancy Eth")
  expect(result.report).toContain("### [MED-1] Unsafe Cast")
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
      audit_state: JSON.stringify({ findings }),
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
      audit_state: JSON.stringify({ findings }),
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
  expect(result.report).toContain("No findings meet the configured severity threshold.")
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
      audit_state: JSON.stringify(findings),
    },
    createContext(),
  )

  const parsed = JSON.parse(payload) as ReportGenerationResult
  expect(typeof parsed.report).toBe("string")
  expect(parsed.report).toContain("# Security Audit Report — ToolExecuteProject")
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
      audit_state: JSON.stringify(state),
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
      audit_state: JSON.stringify(state),
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
      audit_state: JSON.stringify(state),
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
      audit_state: JSON.stringify(state),
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
      audit_state: JSON.stringify(state),
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
      audit_state: JSON.stringify(state),
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

test("parseAuditState handles raw Finding[] array with backward compatibility", () => {
  const findings = [makeFinding({ id: "bc-1" })]
  const state = parseAuditState(JSON.stringify(findings))
  expect(state.findings).toHaveLength(1)
  expect(state.findings[0]?.id).toBe("bc-1")
  expect(state.toolsExecuted).toEqual([])
})

test("parseAuditState returns full AuditState when given complete object", () => {
  const full = makeAuditState({
    findings: [makeFinding({})],
    toolsExecuted: [
      { tool: "slither", startTime: 0, endTime: 100, success: true, findingsCount: 1 },
    ],
    patternVersion: "1.2.3",
  })
  const state = parseAuditState(JSON.stringify(full))
  expect(state.toolsExecuted).toHaveLength(1)
  expect(state.patternVersion).toBe("1.2.3")
})

test("provenance appendix shows data freshness with pattern version", async () => {
  const state = makeAuditState({ patternVersion: "2.5.0" })

  const result = await executeReportGeneration(
    {
      project_name: "FreshnessTest",
      scope: ["Vault.sol"],
      audit_state: JSON.stringify(state),
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
      audit_state: JSON.stringify(state),
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
      audit_state: JSON.stringify(state),
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
        audit_state: JSON.stringify({ findings }),
      },
      context,
      {
        loadConfig: () => ({
          agents: { argus: {}, sentinel: {}, pythia: {}, scribe: {} },
          tools: {},
          knowledge: {
            scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
            autoSync: true,
            skillPrecedence: "bundled-first" as const,
          },
          reporting: {
            format: "markdown" as const,
            severityThreshold: "low" as const,
            gasAnalysis: false,
            output_dir: outputDir,
          },
          solodit: { enabled: true, port: 3000 },
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
    expect(content).toContain("### [HIGH-1] Disk Write Test")
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("executeReportGeneration returns result without filePath when write fails", async () => {
  const findings: Finding[] = [
    makeFinding({ id: "f-fail", check: "write-fail-test", severity: "Low" }),
  ]

  const result = await executeReportGeneration(
    {
      project_name: "WriteFailTest",
      scope: ["Vault.sol"],
      audit_state: JSON.stringify({ findings }),
    },
    createContext(),
    {
      loadConfig: () => {
        throw new Error("Simulated config load failure")
      },
    },
  )

  expect(result.filePath).toBeUndefined()
  expect(result.report).toContain("# Security Audit Report — WriteFailTest")
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
        audit_state: JSON.stringify({ findings: [] }),
      },
      context,
      {
        loadConfig: () => ({
          agents: { argus: {}, sentinel: {}, pythia: {}, scribe: {} },
          tools: {},
          knowledge: {
            scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
            autoSync: true,
            skillPrecedence: "bundled-first" as const,
          },
          reporting: {
            format: "markdown" as const,
            severityThreshold: "low" as const,
            gasAnalysis: false,
            output_dir: outputDir,
          },
          solodit: { enabled: true, port: 3000 },
          disabled_hooks: [],
          hooks: {},
          cli: {},
          background: { max_concurrent: 3 },
        }),
      },
    )

    expect(result.filePath).toBeDefined()
    const filename = path.basename(result.filePath ?? "")
    expect(filename).toMatch(/^My-Cool-Project-----.+\.md$/)
    expect(filename).not.toMatch(/[!@#$]/)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
