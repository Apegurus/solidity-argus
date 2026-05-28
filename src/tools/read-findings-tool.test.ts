import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import type { ReadFindingsResult } from "./read-findings-tool"
import { executeReadFindings } from "./read-findings-tool"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "argus-read-findings-"))
  tempDirs.push(dir)
  return dir
}

function createContext(dir: string): ToolContext {
  return {
    sessionID: "session-test",
    messageID: "message-test",
    agent: "scribe",
    directory: dir,
    worktree: dir,
    abort: new AbortController().signal,
    metadata() {
      return
    },
    async ask() {
      return
    },
  }
}

async function writeAuditState(dir: string, state: Record<string, unknown>): Promise<void> {
  const argusDir = join(dir, ".argus")
  await mkdir(argusDir, { recursive: true })
  await writeFile(join(argusDir, "argus-state.json"), JSON.stringify(state))
}

async function writeRunArtifact(
  dir: string,
  runId: string,
  fileName: string,
  data: Record<string, unknown>,
): Promise<void> {
  const runDir = join(dir, ".argus", "runs", runId)
  await mkdir(runDir, { recursive: true })
  await writeFile(join(runDir, fileName), JSON.stringify(data))
}

function makeAuditState(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "run-test",
    projectDir: "/tmp/project",
    contractsReviewed: [],
    findings: [],
    toolsExecuted: [],
    currentPhase: "reporting",
    scope: ["src/Vault.sol"],
    startTime: Date.now(),
    ...overrides,
  }
}

function makeFinding(index: number, overrides: Record<string, unknown> = {}) {
  const severities = ["Critical", "High", "Medium", "Low", "Informational"] as const
  return {
    id: `FIND-${index}`,
    check: "reentrancy-eth",
    severity: severities[index % 5],
    confidence: "High",
    description: `Finding ${index}: vulnerability description.`,
    file: `src/Contract${index}.sol`,
    lines: [index * 10, index * 10 + 5],
    source: "manual",
    reported_by_agent: "sentinel",
    reported_by_session_id: "ses-test",
    impact: `Impact for finding ${index}`,
    recommendation: `Recommendation for finding ${index}`,
    ...overrides,
  }
}

test("returns inline result with truncated=false for small output", async () => {
  const dir = await makeTempDir()
  await writeAuditState(
    dir,
    makeAuditState({
      findings: [makeFinding(0)],
      toolsExecuted: [{ tool: "slither", startTime: Date.now(), success: true, findingsCount: 1 }],
    }),
  )

  const payload = await executeReadFindings({ run_id: "run-test" }, createContext(dir))
  const parsed = JSON.parse(payload) as ReadFindingsResult

  expect(parsed.success).toBe(true)
  expect(parsed.truncated).toBe(false)
  expect(parsed.source).toBe("report-input.json")
  if (!parsed.truncated) {
    expect(Array.isArray(parsed.reportInput.findings)).toBe(true)
    expect(parsed.reportInput.findings.length).toBe(1)
    expect(Array.isArray(parsed.reportInput.toolsExecuted)).toBe(true)
    expect(Array.isArray(parsed.reportInput.scope)).toBe(true)
  }
})

test("returns file reference with truncated=true when output exceeds threshold", async () => {
  const dir = await makeTempDir()
  const findings = Array.from({ length: 200 }, (_, i) => ({
    ...makeFinding(i),
    description: `Finding ${i}: ${"X".repeat(200)} vulnerability description padding.`,
    recommendation: `Recommendation for finding ${i}. ${"Y".repeat(100)}`,
  }))

  await writeAuditState(dir, makeAuditState({ findings }))

  const payload = await executeReadFindings({ run_id: "run-test" }, createContext(dir))
  const parsed = JSON.parse(payload) as ReadFindingsResult

  expect(parsed.success).toBe(true)
  expect(parsed.truncated).toBe(true)
  expect(parsed.source).toBe("report-input.json")

  if (parsed.truncated) {
    expect(parsed.compactReportInputFile).toContain("compact-report-input.json")
    expect(existsSync(parsed.compactReportInputFile)).toBe(true)
    expect(parsed.summary.findingsCount).toBe(200)
    expect(Object.keys(parsed.summary.severityDistribution).length).toBeGreaterThan(0)
    expect(parsed.summary.topFindings.length).toBeLessThanOrEqual(10)
    expect(parsed.summary.topFindings.length).toBeGreaterThan(0)
    const topFinding = parsed.summary.topFindings[0]
    if (topFinding) expect(topFinding.severity).toBe("Critical")
    expect(parsed.instructions).toContain("read tool")

    const compactFileContent = await readFile(parsed.compactReportInputFile, "utf-8")
    const compactData = JSON.parse(compactFileContent)
    expect(compactData.findings.length).toBe(200)
  }
})

test("returns an inline findings page for large report inputs", async () => {
  const dir = await makeTempDir()
  const findings = Array.from({ length: 200 }, (_, i) => ({
    ...makeFinding(i),
    description: `Finding ${i}: ${"X".repeat(200)} vulnerability description padding.`,
    recommendation: `Recommendation for finding ${i}. ${"Y".repeat(100)}`,
  }))

  await writeAuditState(dir, makeAuditState({ findings }))

  const payload = await executeReadFindings(
    { run_id: "run-test", findings_offset: 20, findings_limit: 5 },
    createContext(dir),
  )
  const parsed = JSON.parse(payload) as ReadFindingsResult

  expect(parsed.success).toBe(true)
  expect(parsed.truncated).toBe(false)
  if (!parsed.truncated) {
    expect(parsed.reportInput.findings).toHaveLength(5)
    expect(parsed.reportInput.findings[0]?.file).toBe("src/Contract20.sol")
    expect(parsed.reportInput.findingsPage).toEqual({ offset: 20, limit: 5, total: 200 })
  }
})

test("throws when no audit state exists", async () => {
  const dir = await makeTempDir()

  try {
    await executeReadFindings({ run_id: "run-missing" }, createContext(dir))
    throw new Error("Expected executeReadFindings to throw")
  } catch (error) {
    expect((error as Error).message).toContain("Cannot read findings from any source")
  }
})

test("throws when run_id is empty", async () => {
  const dir = await makeTempDir()

  try {
    await executeReadFindings({ run_id: "" }, createContext(dir))
    throw new Error("Expected executeReadFindings to throw")
  } catch (error) {
    expect((error as Error).message).toContain("run_id is required")
  }
})

test("prefers flat report-input.json over audit state", async () => {
  const dir = await makeTempDir()
  const argusDir = join(dir, ".argus")
  await mkdir(argusDir, { recursive: true })

  const flatInput = {
    run_id: "flat-run",
    findings: [
      {
        check: "from-flat",
        severity: "High",
        file: "src/A.sol",
        lines: [1, 2],
        description: "flat",
        source: "manual",
        confidence: "High",
      },
    ],
    toolsExecuted: [],
    scope: ["src/A.sol"],
    projectDir: dir,
  }
  await writeFile(join(argusDir, "report-input.json"), JSON.stringify(flatInput))
  await writeAuditState(dir, makeAuditState({ findings: [makeFinding(0)] }))

  const payload = await executeReadFindings({ run_id: "any" }, createContext(dir))
  const parsed = JSON.parse(payload) as ReadFindingsResult

  expect(parsed.success).toBe(true)
  if (!parsed.truncated) {
    expect(parsed.reportInput.findings[0]?.check).toBe("from-flat")
  }
})

test("derives scope from findings when state scope is empty", async () => {
  const dir = await makeTempDir()
  await writeAuditState(
    dir,
    makeAuditState({
      scope: [],
      findings: [
        makeFinding(0, { file: "src/Vault.sol" }),
        makeFinding(1, { file: "src/Token.sol" }),
      ],
    }),
  )

  const payload = await executeReadFindings({ run_id: "run-test" }, createContext(dir))
  const parsed = JSON.parse(payload) as ReadFindingsResult

  if (!parsed.truncated) {
    expect(parsed.reportInput.scope).toContain("src/Vault.sol")
    expect(parsed.reportInput.scope).toContain("src/Token.sol")
  }
})

test("prefers deduped-findings.json over per-run report-input and state", async () => {
  const dir = await makeTempDir()
  const runId = "run-test"

  await writeRunArtifact(dir, runId, "report-input.json", {
    run_id: runId,
    findings: [
      {
        check: "from-per-run-report-input",
        severity: "High",
        file: "src/PerRun.sol",
        lines: [1, 2],
        description: "per-run",
        source: "manual",
        confidence: "High",
      },
    ],
    toolsExecuted: [],
    scope: ["src/PerRun.sol"],
    projectDir: dir,
  })

  await writeRunArtifact(dir, runId, "findings.json", {
    findings: [
      {
        ...makeFinding(1, {
          id: "RAW-1",
          observation_id: "obs-raw-1",
          issue_fingerprint: "issue-raw-1",
          observation_fingerprint: "obs-fingerprint-raw-1",
        }),
      },
    ],
  })

  await writeRunArtifact(dir, runId, "deduped-findings.json", {
    run_id: runId,
    findings: [
      {
        id: "DEDUPED-1",
        check: "from-deduped",
        severity: "Critical",
        file: "src/Deduped.sol",
        lines: [10, 12],
        description: "deduped finding",
        source: "manual",
        confidence: "High",
        impact: "deduped impact",
        recommendation: "deduped recommendation",
        observation_ids: ["obs-raw-1"],
        observation_count: 1,
      },
    ],
  })

  await writeAuditState(
    dir,
    makeAuditState({
      findings: [makeFinding(0, { check: "from-state" })],
      scope: ["src/State.sol"],
    }),
  )

  const payload = await executeReadFindings({ run_id: runId }, createContext(dir))
  const parsed = JSON.parse(payload) as ReadFindingsResult

  expect(parsed.success).toBe(true)
  if (!parsed.truncated) {
    const finding = parsed.reportInput.findings[0]
    expect(finding?.check).toBe("from-deduped")
    expect(finding?.impact).toBe("deduped impact")
    expect(finding?.recommendation).toBe("deduped recommendation")
    expect(parsed.reportInput.scope).toEqual(["src/PerRun.sol"])
  }
})

test("rejects invalid deduped-findings lineage instead of returning stale data", async () => {
  const dir = await makeTempDir()
  const runId = "run-test"

  await writeRunArtifact(dir, runId, "findings.json", {
    findings: [
      {
        ...makeFinding(1, {
          id: "RAW-1",
          observation_id: "obs-raw-1",
          issue_fingerprint: "issue-raw-1",
          observation_fingerprint: "obs-fingerprint-raw-1",
        }),
      },
    ],
  })
  await writeRunArtifact(dir, runId, "deduped-findings.json", {
    run_id: runId,
    findings: [
      {
        ...makeFinding(2, { id: "DEDUPED-1", check: "from-deduped" }),
        observation_ids: ["obs-missing"],
        observation_count: 1,
      },
    ],
  })

  expect(executeReadFindings({ run_id: runId }, createContext(dir))).rejects.toThrow(
    "Invalid deduped findings lineage",
  )
})
