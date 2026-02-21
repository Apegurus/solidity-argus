import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { ArgusConfig } from "../config/types"
import type { ScvdClient, ScvdFinding } from "../knowledge/scvd-client"
import { releaseSyncLock, type ScvdIndex, saveIndex } from "../knowledge/scvd-index"
import { getSyncStatus, syncAll } from "../knowledge/scvd-sync"
import { resetLoggerSink } from "../shared/logger"
import { createKnowledgeSyncHook, type KnowledgeSyncDependencies } from "./knowledge-sync-hook"
import { safeCreateHook } from "./safe-create-hook"

let stderrOutput: string[]
let origStderrWrite: typeof process.stderr.write

beforeEach(() => {
  stderrOutput = []
  process.env.ARGUS_LOG = "stderr"
  resetLoggerSink()
  origStderrWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: string | Uint8Array, ..._rest: unknown[]) => {
    stderrOutput.push(typeof chunk === "string" ? chunk : chunk.toString())
    return true
  }) as typeof process.stderr.write
})

afterEach(() => {
  process.stderr.write = origStderrWrite
  delete process.env.ARGUS_LOG
  resetLoggerSink()
})

function createArgusConfig(enabled: boolean): ArgusConfig {
  return {
    agents: { argus: {}, sentinel: {}, pythia: {}, scribe: {} },
    tools: {},
    knowledge: {
      scvd: { enabled, apiUrl: "https://api.scvd.dev" },
      autoSync: true,
      skillPrecedence: "bundled-first" as const,
    },
    reporting: { format: "markdown", severityThreshold: "low", gasAnalysis: false, output_dir: ".opencode/reports/" },
    solodit: { enabled: true, port: 3000 },
    disabled_hooks: [],
    hooks: {},
    cli: {},
    background: { max_concurrent: 3 },
  }
}

function createFinding(id: string): ScvdFinding {
  return {
    scvd_id: id,
    doc_id: `doc-${id}`,
    title: `Title ${id}`,
    description_md: "Description text",
    severity: "High",
    taxonomy: { swc: ["SWC-107"], cwe: ["CWE-841"] },
    repo: { url: "https://github.com/example/repo" },
    sections: {},
  }
}

describe("safe-create-hook observability", () => {
  test("logs error through logger on factory failure", () => {
    const result = safeCreateHook(() => {
      throw new Error("boom")
    }, "test-hook")

    expect(result).toBeUndefined()
    const logLine = stderrOutput.find((line) => line.includes("[ERROR]"))
    expect(logLine).toBeDefined()
    expect(logLine).toContain('Failed to create hook "test-hook"')
    expect(logLine).toContain("boom")
  })

  test("does not log when factory succeeds", () => {
    const result = safeCreateHook(() => 42, "ok-hook")

    expect(result).toBe(42)
    const logLine = stderrOutput.find((line) => line.includes("Failed to create hook"))
    expect(logLine).toBeUndefined()
  })
})

describe("knowledge-sync-hook observability", () => {
  test("default log dependency uses logger for sync output", async () => {
    const deps: KnowledgeSyncDependencies = {
      createClient: () => ({ kind: "client" }),
      syncIncrementalFn: async () => ({
        status: "success" as const,
        success: true,
        newFindings: 5,
        totalIndexed: 100,
        lastSync: "2026-02-17T00:00:00.000Z",
      }),
    }

    const hook = createKnowledgeSyncHook(createArgusConfig(true), deps)
    hook()

    await new Promise((resolve) => setTimeout(resolve, 50))

    const logLine = stderrOutput.find((line) => line.includes("[INFO]"))
    expect(logLine).toBeDefined()
    expect(logLine).toContain("SCVD index updated")
    expect(logLine).toContain("5 new findings")
  })
})

describe("syncAll observability", () => {
  const tempDir = "/tmp/argus-observability-tests"

  beforeEach(() => {
    releaseSyncLock()
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("logs [sync] starting debug message on syncAll", async () => {
    const indexPath = join(tempDir, "sync-start.json")
    const client = {
      fetchAllFindings: async () => [createFinding("SCVD-1")],
    } as unknown as ScvdClient

    const result = await syncAll(client, indexPath)

    expect(result.success).toBe(true)
    expect(result.newFindings).toBe(1)
  })

  test("logs [sync] complete on successful syncAll", async () => {
    const indexPath = join(tempDir, "sync-complete.json")
    const client = {
      fetchAllFindings: async () => [createFinding("SCVD-1"), createFinding("SCVD-2")],
    } as unknown as ScvdClient

    const result = await syncAll(client, indexPath)

    expect(result.success).toBe(true)
    expect(result.newFindings).toBe(2)
    expect(result.totalIndexed).toBe(2)
  })

  test("logs [sync] failed on error syncAll", async () => {
    const indexPath = join(tempDir, "sync-fail.json")
    const client = {
      fetchAllFindings: async () => {
        throw new Error("network timeout")
      },
    } as unknown as ScvdClient

    const result = await syncAll(client, indexPath)

    expect(result.success).toBe(false)
    if (result.status === "error") {
      expect(result.reason).toBeDefined()
    }
  })
})

describe("getSyncStatus staleness hint", () => {
  const tempDir = "/tmp/argus-staleness-tests"

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("returns hint when data is stale", async () => {
    const indexPath = join(tempDir, "stale-hint.json")
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const oldIndex: ScvdIndex = {
      version: 1,
      lastSync: eightDaysAgo,
      totalFindings: 10,
      entries: [
        {
          id: "SCVD-1",
          title: "Test",
          severity: "High",
          swc: ["SWC-107"],
          cwe: ["CWE-841"],
          keywords: ["test"],
          repoUrl: "https://github.com/example/repo",
        },
      ],
    }
    await saveIndex(oldIndex, indexPath)

    const status = await getSyncStatus(indexPath)

    expect(status.stale).toBe(true)
    expect(status.hint).toBeDefined()
    expect(status.hint).toContain("SCVD data is stale")
    expect(status.hint).toContain("argus_sync_knowledge")
  })

  test("returns hint when index is missing", async () => {
    const status = await getSyncStatus(join(tempDir, "nonexistent.json"))

    expect(status.stale).toBe(true)
    expect(status.healthy).toBe(false)
    expect(status.hint).toBeDefined()
    expect(status.hint).toContain("SCVD data is missing")
  })

  test("does not return hint when data is fresh", async () => {
    const indexPath = join(tempDir, "fresh-hint.json")
    const now = new Date().toISOString()
    const freshIndex: ScvdIndex = {
      version: 1,
      lastSync: now,
      totalFindings: 5,
      entries: [
        {
          id: "SCVD-1",
          title: "Test",
          severity: "High",
          swc: ["SWC-107"],
          cwe: ["CWE-841"],
          keywords: ["test"],
          repoUrl: "https://github.com/example/repo",
        },
      ],
    }
    await saveIndex(freshIndex, indexPath)

    const status = await getSyncStatus(indexPath)

    expect(status.stale).toBe(false)
    expect(status.hint).toBeUndefined()
  })
})
