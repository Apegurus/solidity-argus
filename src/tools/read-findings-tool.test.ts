import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { SCHEMA_VERSION } from "../state/schemas"
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

async function writeEventsJournal(
  dir: string,
  runId: string,
  events: Record<string, unknown>[],
): Promise<void> {
  const journalDir = join(dir, ".argus", "runs", runId)
  await mkdir(journalDir, { recursive: true })
  const lines = `${events.map((e) => JSON.stringify(e)).join("\n")}\n`
  await writeFile(join(journalDir, "events.jsonl"), lines)
}

test("returns inline result with truncated=false for small output", async () => {
  const dir = await makeTempDir()
  const runId = "run-read-findings-ok"

  await writeEventsJournal(dir, runId, [
    {
      type: "session.created",
      run_id: runId,
      seq: 1,
      session_id: "ses-test",
      source: "test",
      schema_version: SCHEMA_VERSION,
      timestamp: Date.now(),
      payload: { scope: ["src/Vault.sol"] },
    },
  ])

  const payload = await executeReadFindings({ run_id: runId }, createContext(dir))
  const parsed = JSON.parse(payload) as ReadFindingsResult

  expect(parsed.success).toBe(true)
  expect(parsed.truncated).toBe(false)
  expect(parsed.source).toBe("report-input.json")
  if (!parsed.truncated) {
    expect(parsed.reportInput.run_id).toBe(runId)
    expect(Array.isArray(parsed.reportInput.findings)).toBe(true)
    expect(Array.isArray(parsed.reportInput.toolsExecuted)).toBe(true)
    expect(Array.isArray(parsed.reportInput.scope)).toBe(true)
  }
})

test("returns file reference with truncated=true when output exceeds threshold", async () => {
  const dir = await makeTempDir()
  const runId = "run-read-findings-large"

  const bulkFindings: Record<string, unknown>[] = []
  const severities = ["Critical", "High", "Medium", "Low", "Informational"] as const
  for (let i = 0; i < 200; i++) {
    bulkFindings.push({
      type: "finding.added",
      run_id: runId,
      seq: i + 2,
      session_id: "ses-test",
      source: "test",
      schema_version: SCHEMA_VERSION,
      timestamp: Date.now(),
      payload: {
        id: `FIND-${i}`,
        check: "reentrancy-eth",
        severity: severities[i % 5],
        confidence: "High",
        description: `Finding ${i}: ${"X".repeat(200)} vulnerability description padding.`,
        file: `src/Contract${i}.sol`,
        lines: [i * 10, i * 10 + 5],
        source: "manual",
        run_id: runId,
        seq: i + 2,
        schema_version: SCHEMA_VERSION,
        observation_id: `obs-${i}`,
        issue_fingerprint: `fp-issue-${i}`,
        observation_fingerprint: `fp-obs-${i}`,
        reported_by_agent: "sentinel",
        impact: `Impact description for finding ${i}`,
        recommendation: `Recommendation for finding ${i}. ${"Y".repeat(100)}`,
      },
    })
  }

  await writeEventsJournal(dir, runId, [
    {
      type: "session.created",
      run_id: runId,
      seq: 1,
      session_id: "ses-test",
      source: "test",
      schema_version: SCHEMA_VERSION,
      timestamp: Date.now(),
      payload: { scope: ["src/Vault.sol"] },
    },
    ...bulkFindings,
  ])

  const payload = await executeReadFindings({ run_id: runId }, createContext(dir))
  const parsed = JSON.parse(payload) as ReadFindingsResult

  expect(parsed.success).toBe(true)
  expect(parsed.truncated).toBe(true)
  expect(parsed.source).toBe("report-input.json")

  if (parsed.truncated) {
    expect(parsed.compactReportInputFile).toContain("compact-report-input.json")
    expect(existsSync(parsed.compactReportInputFile)).toBe(true)
    expect(parsed.summary.run_id).toBe(runId)
    expect(parsed.summary.findingsCount).toBe(200)
    expect(parsed.summary.toolsExecutedCount).toBeGreaterThanOrEqual(0)
    expect(parsed.summary.scope).toEqual(["src/Vault.sol"])
    expect(Object.keys(parsed.summary.severityDistribution).length).toBeGreaterThan(0)
    expect(parsed.summary.topFindings.length).toBeLessThanOrEqual(10)
    expect(parsed.summary.topFindings.length).toBeGreaterThan(0)
    const topFinding = parsed.summary.topFindings[0]
    if (topFinding) expect(topFinding.severity).toBe("Critical")
    expect(parsed.instructions).toContain("read tool")

    const compactFileContent = await readFile(parsed.compactReportInputFile, "utf-8")
    const compactData = JSON.parse(compactFileContent)
    expect(compactData.findings.length).toBe(200)
    expect(compactData.run_id).toBe(runId)
  }
})

test("throws when no events exist for run", async () => {
  const dir = await makeTempDir()
  const runId = "run-read-findings-missing"

  await expect(executeReadFindings({ run_id: runId }, createContext(dir))).rejects.toThrow(
    "No events found for run",
  )
})

test("throws when run_id is empty", async () => {
  const dir = await makeTempDir()

  await expect(executeReadFindings({ run_id: "" }, createContext(dir))).rejects.toThrow(
    "run_id is required",
  )
})

test("throws on malformed events.jsonl", async () => {
  const dir = await makeTempDir()
  const runId = "run-read-findings-corrupt"

  await writeEventsJournal(dir, runId, [])
  await writeFile(join(dir, ".argus", "runs", runId, "events.jsonl"), "not json\nnope\n")

  await expect(executeReadFindings({ run_id: runId }, createContext(dir))).rejects.toThrow(
    "No events found",
  )
})
