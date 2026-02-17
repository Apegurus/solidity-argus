import { test, expect } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import type { Finding } from "../state/types";
import {
  reportGeneratorTool,
  executeReportGeneration,
  type ReportGenerationResult,
} from "./report-generator-tool";

function createContext(): ToolContext {
  return {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "argus",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: new AbortController().signal,
    metadata() {
      return;
    },
    async ask() {
      return;
    },
  };
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
  };
}

test("reportGeneratorTool uses tool() helper contract", () => {
  expect(reportGeneratorTool.description.length).toBeGreaterThan(0);
  expect(reportGeneratorTool.args).toBeDefined();
  expect(typeof reportGeneratorTool.execute).toBe("function");
});

test("executeReportGeneration creates complete markdown report with findings by severity", async () => {
  const findings: Finding[] = [
    makeFinding({ id: "f-crit", check: "critical-bug", severity: "Critical", confidence: "High", description: "Critical exploit path", file: "src/Core.sol", lines: [4, 9], remediation: "Patch access controls" }),
    makeFinding({ id: "f-high", check: "reentrancy-eth", severity: "High", confidence: "Medium", description: "Potential reentrancy vulnerability", file: "src/Vault.sol", lines: [10, 15], remediation: "Use checks-effects-interactions" }),
    makeFinding({ id: "f-medium", check: "unsafe-cast", severity: "Medium", confidence: "High", description: "Unsafe type conversion", file: "src/Math.sol", lines: [20, 22] }),
    makeFinding({ id: "f-low", check: "missing-event", severity: "Low", confidence: "Low", description: "Missing event emission", file: "src/Vault.sol", lines: [44, 44] }),
    makeFinding({ id: "f-info", check: "naming", severity: "Informational", confidence: "Low", description: "Naming suggestion", file: "src/Token.sol", lines: [2, 2] }),
  ];

  const result = await executeReportGeneration(
    {
      project_name: "TestVault",
      scope: ["Vault.sol", "Token.sol"],
      severity_threshold: "informational",
      audit_state: JSON.stringify({ findings }),
    },
    createContext()
  );

  expect(result.findingsCount).toEqual({
    critical: 1,
    high: 1,
    medium: 1,
    low: 1,
    informational: 1,
  });

  expect(result.report).toContain("# Security Audit Report — TestVault");
  expect(result.report).toContain("## Executive Summary");
  expect(result.report).toContain("## Scope");
  expect(result.report).toContain("## Methodology");
  expect(result.report).toContain("## Findings");
  expect(result.report).toContain("## Recommendations");
  expect(result.report).toContain("## Appendix");
  expect(result.report).toContain("### Critical");
  expect(result.report).toContain("### High");
  expect(result.report).toContain("### Medium");
  expect(result.report).toContain("### Low");
  expect(result.report).toContain("### Informational");
  expect(result.report).toContain("### [CRIT-1] Critical Bug");
  expect(result.report).toContain("### [HIGH-1] Reentrancy Eth");
  expect(result.report).toContain("### [MED-1] Unsafe Cast");
  expect(result.report).toContain("### [LOW-1] Missing Event");
  expect(result.report).toContain("### [INFO-1] Naming");
  expect(result.report).toContain("**Location**: src/Core.sol:4-9");
  expect(result.report).toContain("| Critical | 1 |");
  expect(result.report).toContain("| High | 1 |");
  expect(result.report).toContain("| Medium | 1 |");
  expect(result.report).toContain("| Low | 1 |");
  expect(result.report).toContain("| Informational | 1 |");

  const today = new Date().toISOString().slice(0, 10);
  expect(result.filename).toBe(`TestVault-audit-report-${today}.md`);
});

test("executeReportGeneration applies medium severity threshold", async () => {
  const findings: Finding[] = [
    makeFinding({ id: "f-high", check: "reentrancy-eth", severity: "High" }),
    makeFinding({ id: "f-medium", check: "unsafe-cast", severity: "Medium" }),
    makeFinding({ id: "f-low", check: "missing-event", severity: "Low" }),
    makeFinding({ id: "f-info", check: "naming", severity: "Informational" }),
  ];

  const result = await executeReportGeneration(
    {
      project_name: "ThresholdProject",
      scope: ["Vault.sol"],
      severity_threshold: "medium",
      audit_state: JSON.stringify(findings),
    },
    createContext()
  );

  expect(result.findingsCount).toEqual({
    critical: 0,
    high: 1,
    medium: 1,
    low: 0,
    informational: 0,
  });

  expect(result.report).toContain("### High");
  expect(result.report).toContain("### Medium");
  expect(result.report).not.toContain("### Low");
  expect(result.report).not.toContain("### Informational");
  expect(result.report).toContain("### [HIGH-1] Reentrancy Eth");
  expect(result.report).toContain("### [MED-1] Unsafe Cast");
});

test("executeReportGeneration supports disabling executive summary", async () => {
  const findings: Finding[] = [
    makeFinding({ id: "f-high", check: "reentrancy-eth", severity: "High" }),
  ];

  const result = await executeReportGeneration(
    {
      project_name: "NoSummary",
      scope: ["Vault.sol"],
      include_executive_summary: false,
      audit_state: JSON.stringify({ findings }),
    },
    createContext()
  );

  expect(result.report).not.toContain("## Executive Summary");
  expect(result.report).toContain("## Scope");
  expect(result.report).toContain("## Findings");
});

test("executeReportGeneration handles empty findings after threshold filtering", async () => {
  const findings: Finding[] = [
    makeFinding({ id: "f-low", check: "missing-event", severity: "Low" }),
    makeFinding({ id: "f-info", check: "naming", severity: "Informational" }),
  ];

  const result = await executeReportGeneration(
    {
      project_name: "EmptyReport",
      scope: ["Vault.sol"],
      severity_threshold: "high",
      audit_state: JSON.stringify({ findings }),
    },
    createContext()
  );

  expect(result.findingsCount).toEqual({
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
  });
  expect(result.report).toContain("No findings meet the configured severity threshold.");
  expect(result.report).toContain("| Critical | 0 |");
});

test("reportGeneratorTool execute returns stringified ReportGenerationResult", async () => {
  const findings: Finding[] = [
    makeFinding({ id: "f-high", check: "reentrancy-eth", severity: "High" }),
  ];

  const payload = await reportGeneratorTool.execute(
    {
      project_name: "ToolExecuteProject",
      scope: ["Vault.sol"],
      include_executive_summary: true,
      severity_threshold: "low",
      audit_state: JSON.stringify(findings),
    },
    createContext()
  );

  const parsed = JSON.parse(payload) as ReportGenerationResult;
  expect(typeof parsed.report).toBe("string");
  expect(parsed.report).toContain("# Security Audit Report — ToolExecuteProject");
  expect(parsed.findingsCount.high).toBe(1);
});
