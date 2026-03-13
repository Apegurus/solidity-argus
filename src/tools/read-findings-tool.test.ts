import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { SCHEMA_VERSION } from "../state/schemas"
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

test("reads findings via on-demand materialization and returns them", async () => {
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
  const parsed = JSON.parse(payload) as {
    success: boolean
    source: string
    reportInput: {
      run_id: string
      findings: unknown[]
      toolsExecuted: unknown[]
      scope: unknown[]
    }
  }

  expect(parsed.success).toBe(true)
  expect(parsed.source).toBe("report-input.json")
  expect(parsed.reportInput.run_id).toBe(runId)
  expect(Array.isArray(parsed.reportInput.findings)).toBe(true)
  expect(Array.isArray(parsed.reportInput.toolsExecuted)).toBe(true)
  expect(Array.isArray(parsed.reportInput.scope)).toBe(true)
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
