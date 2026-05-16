import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import type { CanonicalFinding, ReportInput } from "../../src/state/schemas"
import { executeReportGeneration, renderReportMarkdown } from "../../src/tools/report-generator-tool"

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

function f(overrides: Partial<CanonicalFinding>): CanonicalFinding {
  const id = overrides.id ?? "f-1"
  return {
    id: "f-1",
    check: "reentrancy",
    description: "Unsafe external call",
    file: "Vault.sol",
    lines: [10, 20],
    severity: "High",
    confidence: "Medium",
    source: "manual",
    run_id: "r-1",
    seq: 0,
    schema_version: "2.0.0",
    observation_id: "o-1",
    issue_fingerprint: id,
    observation_fingerprint: `obs-${id}`,
    reported_by_agent: "sentinel",
    ...overrides,
  } as CanonicalFinding
}

function reportInput(findings: CanonicalFinding[]): ReportInput {
  return {
    run_id: "r-1",
    seq: 0,
    session_id: "session-1",
    tool_call_id: "tool-1",
    source: "test",
    schema_version: "2.0.0",
    projectDir: "/tmp/project",
    findings,
    toolsExecuted: [],
    scope: ["Vault.sol"],
  }
}

describe("report-generator tier splitting", () => {
  test("all unscored findings render under ## Findings, no Leads section", () => {
    const report = renderReportMarkdown(reportInput([f({ id: "f-1" }), f({ id: "f-2" })]), {
      projectName: "Tier Test",
      threshold: 80,
    })

    expect(report).toContain("## Findings")
    expect(report).not.toContain("## Leads")
  })

  test("scored findings split: confidence>=80 in Findings, <80 in Leads", () => {
    const report = renderReportMarkdown(
      reportInput([
        f({ id: "high-1", confidence_score: 95, description: "High-confidence bug" }),
        f({ id: "low-1", confidence_score: 60, description: "Lower-confidence trail" }),
      ]),
      { projectName: "Tier Test", threshold: 80 },
    )

    const findingsIdx = report.indexOf("## Findings")
    const leadsIdx = report.indexOf("## Leads")
    expect(findingsIdx).toBeGreaterThan(-1)
    expect(leadsIdx).toBeGreaterThan(findingsIdx)
    expect(report.indexOf("High-confidence bug")).toBeLessThan(leadsIdx)
    expect(report.indexOf("Lower-confidence trail")).toBeGreaterThan(leadsIdx)
  })

  test("findings sorted by confidence_score descending within each section", () => {
    const report = renderReportMarkdown(
      reportInput([
        f({ id: "a", confidence_score: 80, description: "DESC-80" }),
        f({ id: "b", confidence_score: 95, description: "DESC-95" }),
        f({ id: "c", confidence_score: 88, description: "DESC-88" }),
      ]),
      { projectName: "Tier Test", threshold: 80 },
    )

    const idx95 = report.indexOf("DESC-95")
    const idx88 = report.indexOf("DESC-88")
    const idx80 = report.indexOf("DESC-80")
    expect(idx95).toBeLessThan(idx88)
    expect(idx88).toBeLessThan(idx80)
  })

  test("unscored findings render after scored ones in the same section", () => {
    const report = renderReportMarkdown(
      reportInput([
        f({ id: "unscored", description: "UNSCORED-NO-SCORE" }),
        f({ id: "scored", confidence_score: 90, description: "SCORED-90" }),
      ]),
      { projectName: "Tier Test", threshold: 80 },
    )

    expect(report.indexOf("SCORED-90")).toBeLessThan(report.indexOf("UNSCORED-NO-SCORE"))
  })

  test("scored finding header includes [confidence] prefix", () => {
    const report = renderReportMarkdown(
      reportInput([f({ confidence_score: 85, description: "Header test" })]),
      { projectName: "Tier Test", threshold: 80 },
    )

    expect(report).toMatch(/\[85\]/)
  })

  test("unscored finding header omits the [confidence] prefix", () => {
    const report = renderReportMarkdown(reportInput([f({ description: "No-score header test" })]), {
      projectName: "Tier Test",
      threshold: 80,
    })

    expect(report).not.toMatch(/\[\d{1,3}\]/)
  })

  test("Leads section header omits the [NN] prefix even when confidence_score is present (pashov D1)", () => {
    const report = renderReportMarkdown(
      reportInput([f({ confidence_score: 60, description: "Below-threshold lead" })]),
      { projectName: "Tier Test", threshold: 80 },
    )

    const leadsIdx = report.indexOf("## Leads")
    expect(leadsIdx).toBeGreaterThan(-1)
    const leadsSection = report.slice(leadsIdx)
    expect(leadsSection).toContain("Below-threshold lead")
    expect(leadsSection).not.toMatch(/\[60\]/)
  })

  test("D3: footer shows rubric adoption when all findings have trace", () => {
    const withTrace1 = f({
      id: "trace-1",
      confidence_score: 90,
      description: "**Rubric Trace** · Confidence: 90\n\n- Refutation: cleared\n\n---\n\nbug",
    })
    const withTrace2 = f({
      id: "trace-2",
      confidence_score: 90,
      description: "**Rubric Trace** · Confidence: 90\n\n- Refutation: cleared\n\n---\n\nbug2",
    })
    const report = renderReportMarkdown({
      findings: [withTrace1, withTrace2],
    } as any, { threshold: 80 })
    expect(report).toMatch(/Rubric: 2\/2 findings include 4-gate trace/)
  })

  test("D3: footer counts mixed adoption correctly", () => {
    const withTrace = f({
      id: "with",
      confidence_score: 90,
      description: "**Rubric Trace** · Confidence: 90\n\n---\n\nbug",
    })
    const withoutTrace1 = f({
      id: "without-1",
      confidence_score: 90,
      description: "plain finding, no rubric trace prefix",
    })
    const withoutTrace2 = f({
      id: "without-2",
      confidence_score: 90,
      description: "another plain finding without trace",
    })
    const report = renderReportMarkdown({
      findings: [withTrace, withoutTrace1, withoutTrace2],
    } as any, { threshold: 80 })
    expect(report).toMatch(/Rubric: 1\/3 findings include 4-gate trace/)
  })

  test("D3: footer renders 0/0 (or is omitted) when there are no findings", () => {
    const report = renderReportMarkdown({
      findings: [],
    } as any, { threshold: 80 })
    expect(report).not.toMatch(/Rubric: \d+\/\d+ findings/)
  })

  test("executeReportGeneration honors reporting.confidenceThreshold from config", async () => {
    const result = await executeReportGeneration(
      {
        project_name: "Config Threshold Test",
        scope: ["Vault.sol"],
        report_input: JSON.stringify(
          reportInput([f({ id: "config-70", confidence_score: 70, description: "CONFIG-70" })]),
        ),
        tool_coverage_policy: "skip",
      },
      createContext(),
      {
        loadConfig: () => ({
          agents: { argus: {}, sentinel: {}, pythia: {}, scribe: {}, themis: {} },
          tools: {},
          knowledge: {
            scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
            autoSync: true,
            skillPrecedence: "bundled-first" as const,
          },
          reporting: {
            confidenceThreshold: 60,
            format: "markdown" as const,
            severityThreshold: "low" as const,
            gasAnalysis: false,
            output_dir: "/tmp/argus-report-generator-tiers/",
          },
          solodit: { enabled: true, port: 54173 },
          disabled_hooks: [],
          hooks: {},
          cli: {},
          background: { max_concurrent: 3 },
        }),
      },
    )

    const findingsIdx = result.report.indexOf("## Findings")
    const leadsIdx = result.report.indexOf("## Leads")
    expect(findingsIdx).toBeGreaterThan(-1)
    expect(result.report.indexOf("CONFIG-70")).toBeGreaterThan(findingsIdx)
    expect(leadsIdx === -1 || result.report.indexOf("CONFIG-70") < leadsIdx).toBe(true)
  })
})
