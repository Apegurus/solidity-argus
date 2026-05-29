import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path, { dirname } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { checkRemoteVersion } from "../../src/cli/commands/doctor"
import { createAuditArtifactResolver } from "../../src/shared/audit-artifact-resolver"
import { type CanonicalFinding, SCHEMA_VERSION } from "../../src/state/schemas"
import type { Finding } from "../../src/state/types"
import { executePersistDeduped } from "../../src/tools/persist-deduped-tool"
import { executeRecordFinding } from "../../src/tools/record-finding-tool"
import { executeReportGeneration, renderReportMarkdown } from "../../src/tools/report-generator-tool"
import type { ReportInput } from "../../src/state/schemas"

function writeRawFindings(projectDir: string, runId: string, findings: Finding[]): void {
  const findingsFile = createAuditArtifactResolver(runId, projectDir).paths().findingsFile
  mkdirSync(dirname(findingsFile), { recursive: true })
  writeFileSync(
    findingsFile,
    JSON.stringify({ findings: findings as unknown as CanonicalFinding[] }, null, 2),
  )
}

const RUBRIC_TRACE = `**Rubric Trace** · Confidence: 90

- Refutation: cleared — no guard found in the call path
- Reachability: cleared — any unprivileged caller can reach via claim()
- Trigger: cleared — no access control on entry point
- Impact: confirmed — drains the entire reward pool

**Refutation quote:** \`function claim() external nonReentrant { _distribute(msg.sender); }\` — the modifier doesn't extend to the internal _distribute callback.

---

Reentrancy via reward token callback in claim().`

function createMockContext(projectDir: string, runId: string, agent = "scribe"): ToolContext {
  const controller = new AbortController()
  return {
    sessionID: `${runId}-session`,
    messageID: `${runId}-message`,
    agent,
    directory: projectDir,
    worktree: projectDir,
    abort: controller.signal,
    metadata: (_: { title: string }) => {},
    ask: async () => undefined,
  } as ToolContext
}

async function withProject<T>(runId: string, fn: (projectDir: string) => Promise<T>): Promise<T> {
  const projectDir = await mkdtemp(path.join(tmpdir(), `${runId}-`))
  try {
    return await fn(projectDir)
  } finally {
    await rm(projectDir, { recursive: true, force: true })
  }
}

function uniqueRunId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function recordFinding(
  projectDir: string,
  runId: string,
  finding: Record<string, unknown>,
): Promise<Finding> {
  const payload = await executeRecordFinding(
    { finding: JSON.stringify(finding) },
    createMockContext(projectDir, runId, "sentinel"),
  )
  const result = JSON.parse(payload) as { success: boolean; findings: Finding[]; error?: string }

  expect(result.success).toBe(true)
  expect(result.error).toBeUndefined()
  expect(result.findings).toHaveLength(1)

  return result.findings[0] as Finding
}

async function recordFindings(
  projectDir: string,
  runId: string,
  findings: Record<string, unknown>[],
): Promise<Finding[]> {
  const payload = await executeRecordFinding(
    { findings: JSON.stringify(findings) },
    createMockContext(projectDir, runId, "sentinel"),
  )
  const result = JSON.parse(payload) as { success: boolean; findings: Finding[]; error?: string }

  expect(result.success).toBe(true)
  expect(result.error).toBeUndefined()
  expect(result.findings).toHaveLength(findings.length)

  return result.findings as Finding[]
}

async function renderRecordedFindings(
  projectDir: string,
  runId: string,
  findings: Finding[],
): Promise<string> {
  writeRawFindings(projectDir, runId, findings)

  const dedupedFindings = findings.map((f) => {
    const canonical = f as unknown as CanonicalFinding
    return {
      ...f,
      observation_ids: [canonical.observation_id],
      observation_count: 1,
    }
  })

  const persistPayload = await executePersistDeduped(
    { run_id: runId, deduped_findings: JSON.stringify(dedupedFindings) },
    createMockContext(projectDir, runId, "scribe"),
  )
  const persistResult = JSON.parse(persistPayload) as { success: boolean; error?: string }
  expect(persistResult.success).toBe(true)
  expect(persistResult.error).toBeUndefined()

  const report = await executeReportGeneration(
    {
      project_name: "RubricE2E",
      scope: ["Vault.sol", "Router.sol", "Loose.sol"],
      include_executive_summary: true,
      severity_threshold: "informational",
      preflight_policy: "warn",
      tool_coverage_policy: "warn",
      run_id: runId,
    },
    createMockContext(projectDir, runId, "scribe"),
  )

  expect(report.error).toBeUndefined()
  return report.report
}

describe("end-to-end: rubric and confidence_score through full pipeline", () => {
  test("scored finding round-trips through record → persist → render with tier split", async () => {
    const runId = uniqueRunId("e2e-rubric")
    await withProject(runId, async (projectDir) => {
      const recorded = await recordFindings(projectDir, runId, [
        {
          check: "reentrancy-high",
          description: RUBRIC_TRACE,
          file: "Vault.sol",
          lines: [42, 50],
          severity: "High",
          confidence: "High",
          source: "manual",
          confidence_score: 90,
        },
        {
          check: "reentrancy-low",
          description: RUBRIC_TRACE.replace("Confidence: 90", "Confidence: 60"),
          file: "Router.sol",
          lines: [10, 20],
          severity: "Medium",
          confidence: "Low",
          source: "manual",
          confidence_score: 60,
        },
      ])

      const markdown = await renderRecordedFindings(projectDir, runId, recorded)

      expect(markdown).toContain("## Findings")
      expect(markdown).toContain("## Leads")
      expect(markdown).toMatch(/\[90\]/)
      expect(markdown.indexOf("[90]")).toBeLessThan(markdown.indexOf("## Leads"))
      expect(markdown.slice(markdown.indexOf("## Leads"))).toMatch(/\[60\]/)
      expect(markdown).toMatch(/Rubric: 2\/2 findings include 4-gate trace/)
      expect(markdown).not.toContain("no rubric trace")
    })
  })

  test("rubric trace text round-trips verbatim through persist → render", async () => {
    const runId = uniqueRunId("e2e-trace")
    await withProject(runId, async (projectDir) => {
      const finding = await recordFinding(projectDir, runId, {
        check: "trace-roundtrip",
        description: RUBRIC_TRACE,
        file: "Vault.sol",
        lines: [42, 50],
        severity: "High",
        confidence: "High",
        source: "manual",
        confidence_score: 90,
      })

      const markdown = await renderRecordedFindings(projectDir, runId, [finding])

      expect(markdown).toContain("**Rubric Trace** · Confidence: 90")
      expect(markdown).toContain("**Refutation quote:**")
      expect(markdown).toContain("function claim() external nonReentrant")
    })
  })

  test("finding WITHOUT rubric trace renders the D4 warning annotation", async () => {
    const runId = uniqueRunId("e2e-no-trace")
    await withProject(runId, async (projectDir) => {
      const finding = await recordFinding(projectDir, runId, {
        check: "undisciplined",
        description: "Plain finding without any rubric trace prefix.",
        file: "Loose.sol",
        lines: [1, 5],
        severity: "Medium",
        confidence: "Medium",
        source: "manual",
        confidence_score: 85,
      })

      const markdown = await renderRecordedFindings(projectDir, runId, [finding])

      expect(markdown).toContain("⚠️ no rubric trace")
      expect(markdown).toMatch(/Rubric: 0\/1 findings include 4-gate trace/)
    })
  })

  test("SCHEMA_VERSION is still 2.0.0 (no schema bump)", () => {
    expect(SCHEMA_VERSION).toBe("2.0.0")
  })

  function makeFinding(overrides: Partial<CanonicalFinding>): CanonicalFinding {
    const key = overrides.check ?? "x"
    return {
      id: `obs:${key}`,
      check: "x",
      description: "**Rubric Trace** · Verdict: CONFIRMED · Confidence: 90\n\n---\n\nbody",
      file: "src/A.sol",
      lines: [1, 2],
      severity: "Medium",
      confidence: "Medium",
      source: "manual",
      run_id: "run-e2e-1",
      seq: 1,
      schema_version: SCHEMA_VERSION,
      observation_id: `obs:${key}`,
      issue_fingerprint: `fp-${key}`,
      observation_fingerprint: `ofp-${key}`,
      reported_by_agent: "sentinel",
      ...overrides,
    } as CanonicalFinding
  }

  test("no candidate is ever silently dropped — REJECTED_DEMOTED appear in report", () => {
    // Construct a ReportInput with three findings: one CONFIRMED, one DEMOTED, one REJECTED_DEMOTED
    const input: ReportInput = {
      run_id: "run-e2e-1",
      seq: 0,
      session_id: "ses_test",
      tool_call_id: "call-e2e-1",
      source: "test",
      schema_version: SCHEMA_VERSION,
      projectDir: "/tmp",
      scope: ["src/"],
      toolsExecuted: [],
      findings: [
        makeFinding({ check: "real-vuln", rubric_verdict: "CONFIRMED", confidence_score: 90 }),
        makeFinding({ check: "edge-case", rubric_verdict: "DEMOTED", confidence_score: 60 }),
        makeFinding({ check: "guard-found", rubric_verdict: "REJECTED_DEMOTED", confidence_score: 20 }),
      ],
    }

    const md = renderReportMarkdown(input)

    expect(md).toContain("Real Vuln")    // CONFIRMED
    expect(md).toContain("Edge Case")    // DEMOTED
    expect(md).toContain("Guard Found")  // REJECTED_DEMOTED — must NOT be dropped
  })

  test("doctor's checkRemoteVersion integrates without throwing", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ version: "99.99.99" }), {
        status: 200,
      })) as unknown as typeof fetch
    try {
      const r = await checkRemoteVersion({ localVersion: "0.5.8" })
      if (r.status !== "outdated") {
        throw new Error(`Expected outdated version status, received ${r.status}`)
      }
      expect(r.remoteVersion).toBe("99.99.99")
    } finally {
      globalThis.fetch = original
    }
  })
})
