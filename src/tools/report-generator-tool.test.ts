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
  parseAuditState,
  parseLocationString,
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
  expect(result.filename).toBe(`TestVault-security-audit-${today}.md`)
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
      preflight_policy: "warn",
      audit_state: JSON.stringify(findings),
    },
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

test("parseAuditState accepts findings with title instead of check", () => {
  const findings = [
    {
      title: "Reentrancy in withdraw",
      severity: "Critical",
      confidence: "High",
      description: "CEI violation",
      file: "src/Vault.sol",
      lines: [18, 22],
      source: "manual",
    },
  ]
  const state = parseAuditState(JSON.stringify(findings))
  expect(state.findings).toHaveLength(1)
  expect(state.findings[0]?.check).toBe("Reentrancy in withdraw")
  expect(state.findings[0]?.severity).toBe("Critical")
})

test("parseAuditState accepts findings with location string instead of file+lines", () => {
  const findings = [
    {
      title: "Missing Access Control",
      severity: "high",
      description: "No msg.sender check",
      location: "src/Vault.sol:18-22",
      source: "manual",
    },
  ]
  const state = parseAuditState(JSON.stringify(findings))
  expect(state.findings).toHaveLength(1)
  expect(state.findings[0]?.file).toBe("src/Vault.sol")
  expect(state.findings[0]?.lines).toEqual([18, 22])
  expect(state.findings[0]?.severity).toBe("High")
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

test("parseAuditState preserves findings that have file+location but no explicit lines", () => {
  const findings = [
    {
      title: "Missing Access Control on withdraw()",
      severity: "Critical",
      description: "Any user can force-withdraw",
      file: "src/VulnerableVault.sol",
      location: "VulnerableVault.sol:18-23",
      check: "access-control-missing",
      source: "manual",
    },
    {
      title: "Floating Pragma",
      severity: "Informational",
      description: "Use locked pragma",
      file: "src/VulnerableVault.sol",
      check: "floating-pragma",
      source: "manual",
    },
  ]
  const state = parseAuditState(JSON.stringify(findings))
  expect(state.findings).toHaveLength(2)
  expect(state.findings[0]?.lines).toEqual([18, 23])
  expect(state.findings[1]?.lines).toEqual([0, 0])
})

test("parseAuditState with audit_state object preserves findings without lines", () => {
  const auditState = {
    findings: [
      {
        title: "Reentrancy",
        severity: "High",
        description: "CEI violation",
        file: "src/Vault.sol",
        check: "reentrancy-eth",
        source: "manual",
      },
    ],
    tools_used: [],
  }
  const state = parseAuditState(JSON.stringify(auditState))
  expect(state.findings).toHaveLength(1)
  expect(state.findings[0]?.check).toBe("reentrancy-eth")
  expect(state.findings[0]?.lines).toEqual([0, 0])
})

test("parseAuditState accepts findings with only check (no file, no lines)", () => {
  const findings = [
    {
      check: "generic-issue",
      severity: "Low",
      description: "General observation",
      source: "manual",
    },
  ]
  const state = parseAuditState(JSON.stringify(findings))
  expect(state.findings).toHaveLength(1)
  expect(state.findings[0]?.file).toBe("")
  expect(state.findings[0]?.lines).toEqual([0, 0])
})

test("parseAuditState accepts findings with lowercase severity", () => {
  const findings = {
    findings: [
      {
        check: "test-finding",
        severity: "medium",
        confidence: "low",
        description: "Test",
        file: "Vault.sol",
        lines: [1, 5],
        source: "pattern",
      },
    ],
  }
  const state = parseAuditState(JSON.stringify(findings))
  expect(state.findings).toHaveLength(1)
  expect(state.findings[0]?.severity).toBe("Medium")
  expect(state.findings[0]?.confidence).toBe("Low")
})

test("parseAuditState accepts agent-style findings with mixed aliases in AuditState wrapper", () => {
  const auditState = {
    findings: [
      {
        title: "Reentrancy",
        location: "Vault.sol:18-22",
        severity: "critical",
        confidence: "high",
        description: "CEI violation in withdraw",
        source: "manual",
      },
      {
        name: "Oracle Manipulation",
        file: "Oracle.sol",
        line: 14,
        severity: "HIGH",
        description: "Single source oracle",
        source: "manual",
      },
    ],
  }
  const state = parseAuditState(JSON.stringify(auditState))
  expect(state.findings).toHaveLength(2)
  expect(state.findings[0]?.check).toBe("Reentrancy")
  expect(state.findings[0]?.file).toBe("Vault.sol")
  expect(state.findings[0]?.lines).toEqual([18, 22])
  expect(state.findings[0]?.severity).toBe("Critical")
  expect(state.findings[1]?.check).toBe("Oracle Manipulation")
  expect(state.findings[1]?.lines).toEqual([14, 14])
  expect(state.findings[1]?.severity).toBe("High")
})

test("parseAuditState full pipeline: alias findings produce complete report sections", async () => {
  const findings = [
    {
      title: "Reentrancy in withdraw",
      location: "src/Vault.sol:18-22",
      severity: "critical",
      confidence: "high",
      description: "External call before state update",
      source: "manual",
      remediation: "Add nonReentrant modifier",
    },
    {
      name: "Missing Access Control",
      location: "src/Oracle.sol:21-22",
      severity: "high",
      description: "setPool has no authorization",
      source: "manual",
    },
  ]

  const result = await executeReportGeneration(
    {
      project_name: "AliasTest",
      scope: ["Vault.sol", "Oracle.sol"],
      severity_threshold: "low",
      audit_state: JSON.stringify(findings),
    },
    createContext(),
  )

  expect(result.findingsCount.critical).toBe(1)
  expect(result.findingsCount.high).toBe(1)
  expect(result.report).toContain("### Critical")
  expect(result.report).toContain("### High")
  expect(result.report).toContain("[CRIT-1] Reentrancy In Withdraw")
  expect(result.report).toContain("[HIGH-1] Missing Access Control")
  expect(result.report).toContain("**Location**: src/Vault.sol:18-22")
  expect(result.report).toContain("**Location**: src/Oracle.sol:21-22")
  expect(result.report).toContain("Add nonReentrant modifier")
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
    expect(content).toContain("### [HIGH-1] Disk Write Test")
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
  expect(result.error?.code).toBe("WRITE_FAILED")
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
    expect(filename).toMatch(/^My-Cool-Project-security-audit-\d{4}-\d{2}-\d{2}\.md$/)
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
    },
    createContext(),
    {
      readEvents: async () => orphanedEvents,
    },
  )

  expect(result.report).toContain("\u26A0 Completeness Warning")
  expect(result.report).toContain("incomplete orchestration state")
  expect(result.report).toContain("Missing lifecycle")
})

test("executeReportGeneration rejects malformed toolsExecuted in report_input", async () => {
  const malformedReportInput = {
    run_id: "run-malformed-tools",
    seq: 1,
    session_id: "sess-malformed-tools",
    tool_call_id: "tc-report-malformed",
    source: "argus",
    schema_version: SCHEMA_VERSION,
    projectDir: "/tmp/project",
    findings: [],
    toolsExecuted: [
      {
        tool: "argus_forge_test",
        startTime: 100,
        endTime: 120,
        findingsCount: 0,
        run_id: "run-malformed-tools",
        schema_version: SCHEMA_VERSION,
      },
    ],
    scope: ["Vault.sol"],
  }

  expect(
    executeReportGeneration(
      {
        project_name: "MalformedToolsExecuted",
        scope: ["Vault.sol"],
        report_input: JSON.stringify(malformedReportInput),
      },
      createContext(),
    ),
  ).rejects.toThrow("ReportInput contract mismatch")
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
    },
    createContext(),
    {
      readEvents: async () => completeEvents,
    },
  )

  expect(result.report).toContain("# Security Audit Report — DurableOnlyNoSynthesis")
  expect(result.report).toContain("### [HIGH-1] Reentrancy Withdraw")
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

  await expect(
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

test("normalizes legacy audit_state sessionId to canonical run_id from context", async () => {
  const legacyState = {
    ...makeAuditState({
      findings: [makeFinding({ id: "legacy-finding-1" })],
    }),
    sessionId: "ses_legacy_writer",
  }
  const context: ToolContext = {
    ...createContext(),
    sessionID: "ses_parent_writer",
  }

  const result = await executeReportGeneration(
    {
      project_name: "LegacyRunNormalization",
      scope: ["Vault.sol"],
      audit_state: JSON.stringify(legacyState),
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

test("rejects legacy audit_state when only ses_* identity is available", async () => {
  const legacyState = {
    ...makeAuditState({
      findings: [makeFinding({ id: "legacy-finding-2" })],
    }),
    sessionId: "ses_legacy_writer",
  }
  const context: ToolContext = {
    ...createContext(),
    sessionID: "ses_parent_writer",
  }

  await expect(
    executeReportGeneration(
      {
        project_name: "LegacyRunRejection",
        scope: ["Vault.sol"],
        audit_state: JSON.stringify(legacyState),
      },
      context,
      {
        resolveCanonicalRunId: () => undefined,
      },
    ),
  ).rejects.toThrow("run_id/session_id conflation")
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

  await expect(
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

  await expect(
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
      audit_state: JSON.stringify({ findings: [] }),
    },
    createContext(),
  )

  // Extract date from filename: ParityProject-security-audit-YYYY-MM-DD.md
  const filenameMatch = result.filename.match(/-(\d{4}-\d{2}-\d{2})\.md$/)
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
      audit_state: JSON.stringify(state),
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
      audit_state: JSON.stringify(state),
    },
    createContext(),
  )

  // The word "undefined" must NEVER appear in the rendered report
  expect(result.report).not.toContain("undefined")
  // NaN must NEVER appear in the rendered report
  expect(result.report).not.toContain("NaN")

  // Malformed entries should show diagnostic markers, not coerced success
  expect(result.report).toContain("\u26A0 malformed")
  expect(result.report).toContain("N/A")
  expect(result.report).toContain("(unknown tool)")
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
      },
      context,
    )

    expect(result.run_id).toBe(runId)
    expect(result.findingsCount.high).toBe(1)
    expect(result.report).toContain("### [HIGH-1] Disk Fallback Check")
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
