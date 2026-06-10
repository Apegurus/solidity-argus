import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import type { ArgusConfig } from "../../src/config/types"
import type { CanonicalFinding, ReportInput } from "../../src/state/schemas"
import { SCHEMA_VERSION } from "../../src/state/schemas"
import {
  executeReportGeneration,
  renderReportMarkdown,
} from "../../src/tools/report-generator-tool"

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

function completeTrace(
  verdict: "CONFIRMED" | "DEMOTED" | "REJECTED_DEMOTED",
  conf: number,
  body: string,
): string {
  return (
    `**Rubric Trace** · Verdict: ${verdict} · Confidence: ${conf}\n\n` +
    "- Refutation: cleared — no guard in the call path\n" +
    "- Reachability: cleared — reachable in normal operation\n" +
    "- Trigger: cleared — unprivileged caller\n" +
    "- Impact: confirmed — material loss to depositors\n\n" +
    "**Refutation quote:** `function claim() external {}` — no guard blocks the step\n\n" +
    `---\n\n${body}`
  )
}

function makeConfig(confidenceThreshold: number): ArgusConfig {
  return {
    agents: { argus: {}, sentinel: {}, pythia: {}, auditSpecialist: {}, scribe: {}, themis: {} },
    tools: {},
    knowledge: {
      scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
      autoSync: true,
      skillPrecedence: "bundled-first",
    },
    reporting: {
      confidenceThreshold,
      format: "markdown",
      severityThreshold: "low",
      gasAnalysis: false,
      output_dir: "/tmp/argus-report-generator-tiers/",
    },
    solodit: { enabled: true, port: 54173 },
    disabled_hooks: [],
    hooks: {},
    cli: {},
    background: { max_concurrent: 3 },
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

  test("Leads section header includes the [NN] prefix when confidence_score is present", () => {
    const report = renderReportMarkdown(
      reportInput([f({ confidence_score: 60, description: "Below-threshold lead" })]),
      { projectName: "Tier Test", threshold: 80 },
    )

    const leadsIdx = report.indexOf("## Leads")
    expect(leadsIdx).toBeGreaterThan(-1)
    const leadsSection = report.slice(leadsIdx)
    expect(leadsSection).toContain("Below-threshold lead")
    expect(leadsSection).toMatch(/\[60\]/)
  })

  test("D3: footer shows rubric adoption when all findings have trace", () => {
    const withTrace1 = f({
      id: "trace-1",
      confidence_score: 90,
      description: completeTrace("CONFIRMED", 90, "bug"),
    })
    const withTrace2 = f({
      id: "trace-2",
      confidence_score: 90,
      description: completeTrace("CONFIRMED", 90, "bug2"),
    })
    const report = renderReportMarkdown(reportInput([withTrace1, withTrace2]), { threshold: 80 })
    expect(report).toMatch(/Rubric: 2\/2 findings include 4-gate trace/)
  })

  test("D3: footer counts mixed adoption correctly", () => {
    const withTrace = f({
      id: "with",
      confidence_score: 90,
      description: completeTrace("CONFIRMED", 90, "bug"),
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
    const report = renderReportMarkdown(reportInput([withTrace, withoutTrace1, withoutTrace2]), {
      threshold: 80,
    })
    expect(report).toMatch(/Rubric: 1\/3 findings include 4-gate trace/)
  })

  test("D3: footer renders 0/0 (or is omitted) when there are no findings", () => {
    const report = renderReportMarkdown(reportInput([]), { threshold: 80 })
    expect(report).not.toMatch(/Rubric: \d+\/\d+ findings/)
  })

  test("D4: finding WITH rubric trace renders without warning", () => {
    const report = renderReportMarkdown(
      reportInput([
        f({
          confidence_score: 90,
          description: completeTrace("CONFIRMED", 90, "legit bug"),
        }),
      ]),
      { threshold: 80 },
    )
    expect(report).not.toContain("no rubric trace")
  })

  test("D4: finding WITHOUT rubric trace renders the warning annotation", () => {
    const report = renderReportMarkdown(
      reportInput([
        f({
          confidence_score: 90,
          description: "plain finding without the trace prefix",
        }),
      ]),
      { threshold: 80 },
    )
    expect(report).toMatch(/⚠️ no rubric trace/)
  })

  test("D4: annotation also appears on Leads missing the trace", () => {
    const report = renderReportMarkdown(
      reportInput([
        f({
          confidence_score: 60,
          description: "low-confidence trail without rubric trace",
        }),
      ]),
      { threshold: 80 },
    )
    const leadsIdx = report.indexOf("## Leads")
    expect(leadsIdx).toBeGreaterThan(-1)
    expect(report.slice(leadsIdx)).toMatch(/⚠️ no rubric trace/)
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
        loadConfig: () => makeConfig(60),
      },
    )

    const findingsIdx = result.report.indexOf("## Findings")
    const leadsIdx = result.report.indexOf("## Leads")
    expect(findingsIdx).toBeGreaterThan(-1)
    expect(result.report.indexOf("CONFIG-70")).toBeGreaterThan(findingsIdx)
    expect(leadsIdx === -1 || result.report.indexOf("CONFIG-70") < leadsIdx).toBe(true)
  })

  test("verdict-first: CONFIRMED with below-threshold score still lands in Findings (adj_1)", () => {
    const report = renderReportMarkdown(
      reportInput([
        f({
          id: "confirmed-low",
          confidence_score: 10,
          rubric_verdict: "CONFIRMED",
          description: "CONFIRMED-LOW-SCORE",
        }),
      ]),
      { projectName: "Verdict Routing", threshold: 80 },
    )
    const findingsIdx = report.indexOf("## Findings")
    const leadsIdx = report.indexOf("## Leads")
    expect(findingsIdx).toBeGreaterThan(-1)
    expect(report.indexOf("CONFIRMED-LOW-SCORE")).toBeGreaterThan(findingsIdx)
    expect(leadsIdx === -1 || report.indexOf("CONFIRMED-LOW-SCORE") < leadsIdx).toBe(true)
  })

  test("verdict-first: REJECTED_DEMOTED with high or missing score stays in Leads (adj_1)", () => {
    const report = renderReportMarkdown(
      reportInput([
        f({
          id: "rej-high",
          confidence_score: 95,
          rubric_verdict: "REJECTED_DEMOTED",
          description: "REJECTED-HIGH-SCORE",
        }),
        f({
          id: "rej-unscored",
          rubric_verdict: "REJECTED_DEMOTED",
          description: "REJECTED-NO-SCORE",
        }),
      ]),
      { projectName: "Verdict Routing", threshold: 80 },
    )
    const leadsIdx = report.indexOf("## Leads")
    expect(leadsIdx).toBeGreaterThan(-1)
    expect(report.indexOf("REJECTED-HIGH-SCORE")).toBeGreaterThan(leadsIdx)
    expect(report.indexOf("REJECTED-NO-SCORE")).toBeGreaterThan(leadsIdx)
  })

  test("boundary: score === threshold stays in Findings; threshold-1 is a Lead (adj_16)", () => {
    const report = renderReportMarkdown(
      reportInput([
        f({ id: "at", confidence_score: 80, description: "AT-THRESHOLD" }),
        f({ id: "below", confidence_score: 79, description: "BELOW-THRESHOLD" }),
      ]),
      { projectName: "Boundary", threshold: 80 },
    )
    const findingsIdx = report.indexOf("## Findings")
    const leadsIdx = report.indexOf("## Leads")
    expect(findingsIdx).toBeGreaterThan(-1)
    expect(leadsIdx).toBeGreaterThan(findingsIdx)
    expect(report.indexOf("AT-THRESHOLD")).toBeLessThan(leadsIdx)
    expect(report.indexOf("BELOW-THRESHOLD")).toBeGreaterThan(leadsIdx)
  })

  test("provenance appendix counts both Findings and Leads (adj_2)", () => {
    const report = renderReportMarkdown(
      reportInput([
        f({ id: "prov-conf", confidence_score: 90, source: "slither", description: "PROV-CONF" }),
        f({ id: "prov-lead", confidence_score: 20, source: "manual", description: "PROV-LEAD" }),
      ]),
      { projectName: "Provenance", threshold: 80 },
    )
    const appendixIdx = report.indexOf("## Appendix: Data Provenance")
    expect(appendixIdx).toBeGreaterThan(-1)
    const appendix = report.slice(appendixIdx)
    expect(appendix).toContain("Findings included in report: 2")
    expect(appendix).toContain("| slither | 1 |")
    expect(appendix).toContain("| manual | 1 |")
  })

  test("parity: returned tier counts agree with the rendered executive summary (adj_4 guard)", async () => {
    const result = await executeReportGeneration(
      {
        project_name: "Parity",
        scope: ["Vault.sol"],
        report_input: JSON.stringify(
          reportInput([
            f({ id: "par-conf", severity: "High", confidence_score: 90, description: "PAR-CONF" }),
            f({
              id: "par-lead",
              severity: "Critical",
              confidence_score: 20,
              description: "PAR-LEAD",
            }),
          ]),
        ),
        tool_coverage_policy: "skip",
      },
      createContext(),
      { loadConfig: () => makeConfig(80) },
    )

    expect(result.findingsCount.high).toBe(1)
    expect(result.findingsCount.critical).toBe(0)
    expect(result.leadsTierCount.critical).toBe(1)
    expect(result.leadsTierCount.high).toBe(0)
    expect(result.totalCount.high).toBe(1)
    expect(result.totalCount.critical).toBe(1)
    expect(result.report).toMatch(/\| Critical \| 0 \| 1 \| 1 \|/)
    expect(result.report).toMatch(/\| High \| 1 \| 0 \| 1 \|/)
  })

  test("verdict-first: DEMOTED with above-threshold score still lands in Leads (adj_7)", () => {
    const report = renderReportMarkdown(
      reportInput([
        f({
          id: "demoted-high",
          confidence_score: 95,
          rubric_verdict: "DEMOTED",
          description: "DEMOTED-HIGH-SCORE",
        }),
      ]),
      { projectName: "Verdict Routing", threshold: 80 },
    )
    const leadsIdx = report.indexOf("## Leads")
    expect(leadsIdx).toBeGreaterThan(-1)
    expect(report.indexOf("DEMOTED-HIGH-SCORE")).toBeGreaterThan(leadsIdx)
  })

  test("Leads section includes a sanitized Location line (adj_10/adj_1)", () => {
    const report = renderReportMarkdown(
      reportInput([
        f({
          id: "lead-loc",
          confidence_score: 20,
          file: "src/A.sol\n## Forged Heading",
          lines: [1, 2],
          description: "lead body",
        }),
      ]),
      { projectName: "Leads Location", threshold: 80 },
    )
    const leadsIdx = report.indexOf("## Leads")
    expect(leadsIdx).toBeGreaterThan(-1)
    expect(report.slice(leadsIdx)).toContain("**Location**:")
    expect(report).not.toMatch(/^## Forged Heading/m)
  })

  test("hasRubricTrace rejects a trace missing a gate label (adj_12)", () => {
    const partialTrace =
      "**Rubric Trace** · Verdict: CONFIRMED · Confidence: 90\n\n" +
      "- Refutation: cleared\n- Reachability: cleared\n- Impact: confirmed\n\n" +
      "**Refutation quote:** `require(x)` — y\n\n---\n\nbody"
    const report = renderReportMarkdown(
      reportInput([f({ confidence_score: 90, description: partialTrace })]),
      { threshold: 80 },
    )
    expect(report).toMatch(/⚠️ no rubric trace/)
  })
})

describe("renderer — [NN] prefix in Leads tier", () => {
  const baseFinding = (overrides: Partial<CanonicalFinding> = {}): CanonicalFinding =>
    ({
      id: "obs:1",
      check: "test-finding",
      description: completeTrace("REJECTED_DEMOTED", 25, "body"),
      file: "src/A.sol",
      lines: [1, 2],
      severity: "Low",
      confidence: "Low",
      source: "manual",
      run_id: "run-1",
      seq: 1,
      schema_version: SCHEMA_VERSION,
      observation_id: "obs:1",
      issue_fingerprint: "fp1",
      observation_fingerprint: "ofp1",
      reported_by_agent: "sentinel",
      confidence_score: 25,
      rubric_verdict: "REJECTED_DEMOTED",
      ...overrides,
    }) as CanonicalFinding

  const baseInput = (findings: CanonicalFinding[]): ReportInput => ({
    run_id: "run-1",
    seq: 0,
    session_id: "ses_test",
    tool_call_id: "call-1",
    source: "test",
    schema_version: SCHEMA_VERSION,
    projectDir: "/tmp",
    findings,
    toolsExecuted: [],
    scope: ["src/"],
  })

  test("[NN] prefix appears in Leads-tier header for findings with confidence_score", () => {
    const findings = [baseFinding({ confidence_score: 25 })]
    const md = renderReportMarkdown(baseInput(findings))
    expect(md).toContain("## Leads")
    expect(md).toMatch(/### \[25\]/)
  })

  test("[NN] prefix appears in Findings-tier header (regression)", () => {
    const findings = [baseFinding({ confidence_score: 90, rubric_verdict: "CONFIRMED" })]
    const md = renderReportMarkdown(baseInput(findings))
    expect(md).toContain("## Findings")
    expect(md).toMatch(/### \[90\]/)
  })

  test("Leads section renders REJECTED_DEMOTED findings (no drop)", () => {
    const findings = [
      baseFinding({
        check: "rejected-finding",
        rubric_verdict: "REJECTED_DEMOTED",
        confidence_score: 10,
      }),
    ]
    const md = renderReportMarkdown(baseInput(findings))
    expect(md).toContain("Rejected Finding")
    expect(md).toContain("## Leads")
  })

  test("adoption footer counts include both CONFIRMED and DEMOTED traces", () => {
    const findings = [
      baseFinding({
        rubric_verdict: "CONFIRMED",
        confidence_score: 95,
      }),
      baseFinding({
        id: "obs:2",
        observation_id: "obs:2",
        issue_fingerprint: "fp2",
        observation_fingerprint: "ofp2",
        rubric_verdict: "REJECTED_DEMOTED",
        confidence_score: 20,
      }),
    ]
    const md = renderReportMarkdown(baseInput(findings))
    expect(md).toMatch(/Rubric: 2\/2 findings include 4-gate trace/)
  })
})

describe("executive summary — Findings/Leads breakdown (adj_5)", () => {
  const makeFinding = (overrides: Partial<CanonicalFinding> & { id: string }): CanonicalFinding =>
    ({
      check: "test-check",
      description: "desc",
      file: "src/A.sol",
      lines: [1, 2],
      severity: "High",
      confidence: "Medium",
      source: "manual",
      run_id: "run-1",
      seq: 1,
      schema_version: SCHEMA_VERSION,
      observation_id: overrides.id,
      issue_fingerprint: `fp-${overrides.id}`,
      observation_fingerprint: `ofp-${overrides.id}`,
      reported_by_agent: "sentinel",
      ...overrides,
    }) as CanonicalFinding

  const baseInput = (findings: CanonicalFinding[]): ReportInput => ({
    run_id: "run-1",
    seq: 0,
    session_id: "ses_test",
    tool_call_id: "call-1",
    source: "test",
    schema_version: SCHEMA_VERSION,
    projectDir: "/tmp",
    findings,
    toolsExecuted: [],
    scope: ["src/"],
  })

  test("High Lead is counted in Total column, not lost from exec summary", () => {
    const findings = [
      makeFinding({ id: "high-confirmed", severity: "High", confidence_score: 90 }),
      makeFinding({ id: "high-demoted", severity: "High", confidence_score: 25 }),
    ]
    const md = renderReportMarkdown(baseInput(findings))
    // 3-column layout: | Severity | Findings | Leads | Total |
    expect(md).toMatch(/\| High \| 1 \| 1 \| 2 \|/)
  })

  test("Critical Lead surfaces in exec summary Total even with zero Findings tier", () => {
    const findings = [makeFinding({ id: "crit-lead", severity: "Critical", confidence_score: 20 })]
    const md = renderReportMarkdown(baseInput(findings))
    expect(md).toMatch(/\| Critical \| 0 \| 1 \| 1 \|/)
  })

  test("exec summary header reflects 3-column layout", () => {
    const findings = [makeFinding({ id: "f1", severity: "High", confidence_score: 90 })]
    const md = renderReportMarkdown(baseInput(findings))
    expect(md).toContain("| Severity | Findings | Leads | Total |")
  })
})

describe("renderFindingHeader — heading sanitization (adj_10)", () => {
  const makeFinding = (check: string): CanonicalFinding =>
    ({
      id: "obs:1",
      check,
      description: "desc",
      file: "src/A.sol",
      lines: [1, 2],
      severity: "High",
      confidence: "Medium",
      source: "manual",
      run_id: "run-1",
      seq: 1,
      schema_version: SCHEMA_VERSION,
      observation_id: "obs:1",
      issue_fingerprint: "fp1",
      observation_fingerprint: "ofp1",
      reported_by_agent: "sentinel",
    }) as CanonicalFinding

  const baseInput = (findings: CanonicalFinding[]): ReportInput => ({
    run_id: "run-1",
    seq: 0,
    session_id: "ses_test",
    tool_call_id: "call-1",
    source: "test",
    schema_version: SCHEMA_VERSION,
    projectDir: "/tmp",
    findings,
    toolsExecuted: [],
    scope: ["src/"],
  })

  test("strips backticks from check field (no inline code in heading)", () => {
    const md = renderReportMarkdown(baseInput([makeFinding("foo`evil`bar")]))
    expect(md).not.toContain("`evil`")
  })

  test("strips HTML brackets from check field (no inline HTML injection)", () => {
    const md = renderReportMarkdown(
      baseInput([makeFinding("safe <img src=x onerror=alert(1)> name")]),
    )
    expect(md).not.toContain("<img")
    expect(md).not.toContain("onerror")
  })

  test("strips Markdown link syntax from check field", () => {
    const md = renderReportMarkdown(baseInput([makeFinding("name [click](http://evil.com) more")]))
    expect(md).not.toContain("[click]")
    expect(md).not.toContain("](http://evil.com)")
  })

  test("strips heading marker chars from check field (no forged headings)", () => {
    const md = renderReportMarkdown(baseInput([makeFinding("foo ## Forged Header bar")]))
    expect(md).not.toMatch(/^## Forged Header/m)
  })

  test("strips CRLF from check field (heading stays on one line)", () => {
    const md = renderReportMarkdown(baseInput([makeFinding("foo\n## evil\nbar")]))
    const findingHeadings = md
      .split("\n")
      .filter((l) => l.startsWith("### ") && l.includes("· severity:"))
    expect(findingHeadings.length).toBe(1)
    // Strip the leading `### ` so we don't false-match on the heading marker itself
    expect(findingHeadings[0]?.slice(4)).not.toContain("##")
  })

  test("strips table pipe from check field (no row break)", () => {
    const md = renderReportMarkdown(baseInput([makeFinding("foo|bar")]))
    expect(md).toContain("### Foo Bar")
  })

  test("preserves normal kebab-case check names", () => {
    const md = renderReportMarkdown(baseInput([makeFinding("reentrancy-eth")]))
    expect(md).toContain("### Reentrancy Eth")
  })
})

describe("body markdown sanitization (adj_2/adj_8)", () => {
  test("strips ATX heading markers from a description body", () => {
    const report = renderReportMarkdown(
      reportInput([
        f({ confidence_score: 90, description: "intro line\n## Forged Findings\nmore" }),
      ]),
      { threshold: 80 },
    )
    expect(report).not.toMatch(/^## Forged Findings/m)
  })

  test("neutralizes Setext underline headings in a body", () => {
    const report = renderReportMarkdown(
      reportInput([
        f({
          confidence_score: 90,
          description: "real body\n\nForged Section\n=============\n\ntail",
        }),
      ]),
      { threshold: 80 },
    )
    expect(report).not.toMatch(/^=+\s*$/m)
    expect(report).toContain("tail")
  })

  test("balances an unclosed code fence in a body so it cannot swallow the report", () => {
    const report = renderReportMarkdown(
      reportInput([
        f({ confidence_score: 90, description: "body text\n```\nopener never closed" }),
      ]),
      { threshold: 80 },
    )
    const fenceLines = report.split("\n").filter((line) => /^ {0,3}`{3,}/.test(line)).length
    expect(fenceLines % 2).toBe(0)
  })
})
