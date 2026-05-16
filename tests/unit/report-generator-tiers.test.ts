import { describe, expect, test } from "bun:test"
import { renderReportMarkdown } from "../../src/tools/report-generator-tool"
import type { CanonicalFinding } from "../../src/state/schemas"

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

function reportInput(findings: CanonicalFinding[], threshold = 80) {
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
    project_name: "Tier Test",
    threshold,
  } as any
}

describe("report-generator tier splitting", () => {
  test("all unscored findings render under ## Findings, no Leads section", () => {
    const report = renderReportMarkdown(reportInput([f({ id: "f-1" }), f({ id: "f-2" })]))

    expect(report).toContain("## Findings")
    expect(report).not.toContain("## Leads")
  })

  test("scored findings split: confidence>=80 in Findings, <80 in Leads", () => {
    const report = renderReportMarkdown(
      reportInput([
        f({ id: "high-1", confidence_score: 95, description: "High-confidence bug" }),
        f({ id: "low-1", confidence_score: 60, description: "Lower-confidence trail" }),
      ]),
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
    )

    expect(report.indexOf("SCORED-90")).toBeLessThan(report.indexOf("UNSCORED-NO-SCORE"))
  })

  test("scored finding header includes [confidence] prefix", () => {
    const report = renderReportMarkdown(
      reportInput([f({ confidence_score: 85, description: "Header test" })]),
    )

    expect(report).toMatch(/\[85\]/)
  })

  test("unscored finding header omits the [confidence] prefix", () => {
    const report = renderReportMarkdown(reportInput([f({ description: "No-score header test" })]))

    expect(report).not.toMatch(/\[\d{1,3}\]/)
  })

  test("Leads section header omits the [NN] prefix even when confidence_score is present (pashov D1)", () => {
    const report = renderReportMarkdown(
      reportInput([f({ confidence_score: 60, description: "Below-threshold lead" })]),
    )

    const leadsIdx = report.indexOf("## Leads")
    expect(leadsIdx).toBeGreaterThan(-1)
    const leadsSection = report.slice(leadsIdx)
    expect(leadsSection).toContain("Below-threshold lead")
    expect(leadsSection).not.toMatch(/\[60\]/)
  })
})
