import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { createAuditArtifactResolver } from "../shared/audit-artifact-resolver"
import { type ReportInput, SCHEMA_VERSION } from "../state/schemas"
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

test("reads materialized report-input.json and returns it", async () => {
  const dir = await makeTempDir()
  const runId = "run-read-findings-ok"
  const reportInputPath = createAuditArtifactResolver(runId, dir).paths().reportInputFile
  await mkdir(join(dir, ".argus", "runs", runId), { recursive: true })

  const reportInput: ReportInput = {
    run_id: runId,
    seq: 1,
    session_id: "ses-test",
    tool_call_id: "tc-1",
    source: "argus",
    schema_version: SCHEMA_VERSION,
    projectDir: dir,
    findings: [],
    toolsExecuted: [],
    scope: ["src/Vault.sol"],
  }
  await writeFile(reportInputPath, JSON.stringify(reportInput, null, 2))

  const payload = await executeReadFindings({ run_id: runId }, createContext(dir))
  const parsed = JSON.parse(payload) as {
    success: boolean
    source: string
    reportInput: ReportInput
  }

  expect(parsed.success).toBe(true)
  expect(parsed.source).toBe("report-input.json")
  expect(parsed.reportInput.run_id).toBe(runId)
  expect(parsed.reportInput.schema_version).toBe(SCHEMA_VERSION)
  expect(Array.isArray(parsed.reportInput.findings)).toBe(true)
  expect(Array.isArray(parsed.reportInput.toolsExecuted)).toBe(true)
  expect(Array.isArray(parsed.reportInput.scope)).toBe(true)
  expect(parsed.reportInput.projectDir).toBe(dir)
})

test("throws when report-input.json does not exist", async () => {
  const dir = await makeTempDir()
  const runId = "run-read-findings-missing"

  await expect(executeReadFindings({ run_id: runId }, createContext(dir))).rejects.toThrow(
    "No materialized report-input.json",
  )
})

test("throws when run_id is empty", async () => {
  const dir = await makeTempDir()

  await expect(executeReadFindings({ run_id: "" }, createContext(dir))).rejects.toThrow(
    "run_id is required",
  )
})

test("throws on invalid JSON in report-input.json", async () => {
  const dir = await makeTempDir()
  const runId = "run-read-findings-corrupt"
  const reportInputPath = createAuditArtifactResolver(runId, dir).paths().reportInputFile
  await mkdir(join(dir, ".argus", "runs", runId), { recursive: true })
  await writeFile(reportInputPath, "{this is not json")

  await expect(executeReadFindings({ run_id: runId }, createContext(dir))).rejects.toThrow(
    /Corrupted|invalid JSON/,
  )
})
