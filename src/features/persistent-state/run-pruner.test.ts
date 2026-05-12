import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AuditEvent } from "../../state/schemas"
import { SCHEMA_VERSION } from "../../state/schemas"
import { pruneStaleRuns } from "./run-pruner"

describe("pruneStaleRuns", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "argus-pruner-"))
    tempDirs.push(dir)
    return dir
  }

  function writeJournal(projectDir: string, runId: string, events: Partial<AuditEvent>[]): string {
    const runDir = join(projectDir, ".argus", "runs", runId)
    mkdirSync(runDir, { recursive: true })
    const journalPath = join(runDir, "events.jsonl")
    const lines = events.map((e) => {
      const full: AuditEvent = {
        type: "tool.started",
        run_id: runId,
        seq: 0,
        session_id: "s1",
        source: "test",
        schema_version: SCHEMA_VERSION,
        timestamp: Date.now(),
        payload: {},
        ...e,
      }
      return JSON.stringify(full)
    })
    writeFileSync(journalPath, `${lines.join("\n")}\n`)
    return runDir
  }

  function setMtime(path: string, ageMs: number): void {
    const past = new Date(Date.now() - ageMs)
    const { utimesSync } = require("node:fs") as typeof import("node:fs")
    utimesSync(path, past, past)
  }

  test("prunes stale non-finalized run older than TTL", async () => {
    const projectDir = makeTempDir()
    const runDir = writeJournal(projectDir, "stale-run", [{ type: "session.created" }])
    const journalPath = join(runDir, "events.jsonl")
    setMtime(journalPath, 25 * 60 * 60 * 1000)

    const result = await pruneStaleRuns(projectDir, { staleTtlMs: 24 * 60 * 60 * 1000 })

    expect(result.pruned).toContain("stale-run")
    expect(existsSync(runDir)).toBe(false)
  })

  test("keeps recent non-finalized run", async () => {
    const projectDir = makeTempDir()
    const runDir = writeJournal(projectDir, "active-run", [{ type: "session.created" }])

    const result = await pruneStaleRuns(projectDir, { staleTtlMs: 24 * 60 * 60 * 1000 })

    expect(result.kept).toContain("active-run")
    expect(existsSync(runDir)).toBe(true)
  })

  test("prunes finalized run older than retention period", async () => {
    const projectDir = makeTempDir()
    const runDir = writeJournal(projectDir, "old-finalized", [
      { type: "session.created" },
      { type: "run.finalized" },
    ])
    const journalPath = join(runDir, "events.jsonl")
    setMtime(journalPath, 8 * 24 * 60 * 60 * 1000)

    const result = await pruneStaleRuns(projectDir, {
      finalizedRetentionMs: 7 * 24 * 60 * 60 * 1000,
    })

    expect(result.pruned).toContain("old-finalized")
    expect(existsSync(runDir)).toBe(false)
  })

  test("keeps recently finalized run", async () => {
    const projectDir = makeTempDir()
    const runDir = writeJournal(projectDir, "recent-finalized", [
      { type: "session.created" },
      { type: "run.finalized" },
    ])

    const result = await pruneStaleRuns(projectDir, {
      finalizedRetentionMs: 7 * 24 * 60 * 60 * 1000,
    })

    expect(result.kept).toContain("recent-finalized")
    expect(existsSync(runDir)).toBe(true)
  })

  test("dryRun lists but does not delete", async () => {
    const projectDir = makeTempDir()
    const runDir = writeJournal(projectDir, "dry-run-target", [{ type: "session.created" }])
    const journalPath = join(runDir, "events.jsonl")
    setMtime(journalPath, 25 * 60 * 60 * 1000)

    const result = await pruneStaleRuns(projectDir, {
      staleTtlMs: 24 * 60 * 60 * 1000,
      dryRun: true,
    })

    expect(result.pruned).toContain("dry-run-target")
    expect(existsSync(runDir)).toBe(true)
  })

  test("returns empty result when runs dir does not exist", async () => {
    const projectDir = makeTempDir()
    const result = await pruneStaleRuns(projectDir)
    expect(result.pruned).toHaveLength(0)
    expect(result.kept).toHaveLength(0)
  })
})
