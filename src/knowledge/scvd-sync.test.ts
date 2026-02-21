import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { ScvdClient, type ScvdFinding } from "./scvd-client"
import { loadIndex, type ScvdIndex, saveIndex } from "./scvd-index"
import { getSyncStatus, isSyncStale, syncAll, syncIncremental } from "./scvd-sync"

const tempDir = "/tmp/argus-scvd-sync-tests"

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

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

function createMockClient(): ScvdClient {
  return new ScvdClient("https://api.scvd.dev")
}

describe("syncAll", () => {
  test("syncs all findings and writes index", async () => {
    mkdirSync(tempDir, { recursive: true })
    const indexPath = join(tempDir, "scvd-index.json")
    const client = createMockClient()

    client.fetchAllFindings = async () => [createFinding("SCVD-1"), createFinding("SCVD-2")]

    const result = await syncAll(client, indexPath)

    expect(result.success).toBe(true)
    expect(result.newFindings).toBe(2)
    expect(result.totalIndexed).toBe(2)
    expect(result.lastSync.length).toBeGreaterThan(0)

    const fileExists = await Bun.file(indexPath).exists()
    expect(fileExists).toBe(true)
  })

  test("returns error result when client fails", async () => {
    mkdirSync(tempDir, { recursive: true })
    const indexPath = join(tempDir, "scvd-index.json")
    const client = createMockClient()

    client.fetchAllFindings = async () => {
      throw new Error("SCVD unavailable")
    }

    const result = await syncAll(client, indexPath)

    expect(result.success).toBe(false)
    expect(result.newFindings).toBe(0)
    expect(result.totalIndexed).toBe(0)
    expect(result.error).toContain("SCVD unavailable")
  })
})

describe("syncIncremental", () => {
  test("returns early when stats total matches existing index", async () => {
    mkdirSync(tempDir, { recursive: true })
    const indexPath = join(tempDir, "scvd-index.json")
    const client = createMockClient()

    client.fetchAllFindings = async () => [createFinding("SCVD-1")]
    await syncAll(client, indexPath)

    let fetchAllCalled = false
    client.fetchStats = async () => ({
      total: 1,
      by_severity: { High: 1 },
      last_updated: "2026-02-16T00:00:00.000Z",
    })
    client.fetchAllFindings = async () => {
      fetchAllCalled = true
      return [createFinding("SCVD-1")]
    }

    const result = await syncIncremental(client, indexPath)

    expect(result.success).toBe(true)
    expect(result.newFindings).toBe(0)
    expect(result.totalIndexed).toBe(1)
    expect(fetchAllCalled).toBe(false)
  })

  test("runs full sync when totals differ", async () => {
    mkdirSync(tempDir, { recursive: true })
    const indexPath = join(tempDir, "scvd-index.json")
    const client = createMockClient()

    client.fetchStats = async () => ({
      total: 2,
      by_severity: { High: 2 },
      last_updated: "2026-02-16T00:00:00.000Z",
    })
    client.fetchAllFindings = async () => [createFinding("SCVD-1"), createFinding("SCVD-2")]

    const result = await syncIncremental(client, indexPath)

    expect(result.success).toBe(true)
    expect(result.newFindings).toBe(2)
    expect(result.totalIndexed).toBe(2)
  })
})

describe("getSyncStatus", () => {
  test("returns unhealthy status when index missing", async () => {
    const status = await getSyncStatus(join(tempDir, "missing.json"))
    expect(status.healthy).toBe(false)
    expect(status.totalFindings).toBe(0)
    expect(status.lastSync).toBeNull()
  })

  test("returns healthy status from existing index", async () => {
    mkdirSync(tempDir, { recursive: true })
    const indexPath = join(tempDir, "scvd-index.json")
    const client = createMockClient()
    client.fetchAllFindings = async () => [createFinding("SCVD-1")]

    await syncAll(client, indexPath)
    const status = await getSyncStatus(indexPath)

    expect(status.healthy).toBe(true)
    expect(status.totalFindings).toBe(1)
    expect(status.lastSync).not.toBeNull()
  })

  test("returns stale=true for old index", async () => {
    mkdirSync(tempDir, { recursive: true })
    const indexPath = join(tempDir, "stale-index.json")
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const oldIndex: ScvdIndex = {
      version: 1,
      lastSync: eightDaysAgo,
      totalFindings: 1,
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
    expect(status.healthy).toBe(true)
  })

  test("returns metadata when available", async () => {
    mkdirSync(tempDir, { recursive: true })
    const indexPath = join(tempDir, "meta-index.json")
    const now = new Date().toISOString()
    const indexWithMeta: ScvdIndex = {
      version: 1,
      lastSync: now,
      totalFindings: 0,
      entries: [],
      metadata: {
        lastSuccess: now,
        lastAttempt: now,
        errorCount: 0,
        lastError: null,
        lastErrorReason: null,
      },
    }
    await saveIndex(indexWithMeta, indexPath)

    const status = await getSyncStatus(indexPath)
    expect(status.metadata).not.toBeNull()
    expect(status.metadata?.lastSuccess).toBe(now)
    expect(status.metadata?.errorCount).toBe(0)
  })
})

describe("isSyncStale", () => {
  test("returns true when lastSync is 8 days ago", () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const index: ScvdIndex = {
      version: 1,
      lastSync: eightDaysAgo,
      totalFindings: 0,
      entries: [],
    }
    expect(isSyncStale(index)).toBe(true)
  })

  test("returns false when lastSync is 3 days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const index: ScvdIndex = {
      version: 1,
      lastSync: threeDaysAgo,
      totalFindings: 0,
      entries: [],
    }
    expect(isSyncStale(index)).toBe(false)
  })

  test("returns true when index is null", () => {
    expect(isSyncStale(null)).toBe(true)
  })

  test("respects custom threshold", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    const index: ScvdIndex = {
      version: 1,
      lastSync: twoDaysAgo,
      totalFindings: 0,
      entries: [],
    }
    expect(isSyncStale(index, 1)).toBe(true)
    expect(isSyncStale(index, 3)).toBe(false)
  })
})

describe("metadata persistence", () => {
  test("metadata is preserved across save/load cycle", async () => {
    mkdirSync(tempDir, { recursive: true })
    const indexPath = join(tempDir, "meta-persist.json")
    const now = new Date().toISOString()
    const index: ScvdIndex = {
      version: 1,
      lastSync: now,
      totalFindings: 0,
      entries: [],
      metadata: {
        lastSuccess: now,
        lastAttempt: now,
        errorCount: 3,
        lastError: "Connection timeout",
        lastErrorReason: "network",
      },
    }
    await saveIndex(index, indexPath)
    const loaded = await loadIndex(indexPath)

    expect(loaded).not.toBeNull()
    expect(loaded?.metadata).toBeDefined()
    expect(loaded?.metadata?.errorCount).toBe(3)
    expect(loaded?.metadata?.lastError).toBe("Connection timeout")
    expect(loaded?.metadata?.lastErrorReason).toBe("network")
    expect(loaded?.metadata?.lastSuccess).toBe(now)
  })

  test("loadIndex handles indexes without metadata", async () => {
    mkdirSync(tempDir, { recursive: true })
    const indexPath = join(tempDir, "no-meta.json")
    await Bun.write(
      indexPath,
      JSON.stringify({
        version: 1,
        lastSync: new Date().toISOString(),
        totalFindings: 0,
        entries: [],
      }),
    )
    const loaded = await loadIndex(indexPath)

    expect(loaded).not.toBeNull()
    expect(loaded?.metadata).toBeUndefined()
  })

  test("syncAll persists success metadata", async () => {
    mkdirSync(tempDir, { recursive: true })
    const indexPath = join(tempDir, "sync-meta-success.json")
    const client = createMockClient()
    client.fetchAllFindings = async () => [createFinding("SCVD-1")]

    const result = await syncAll(client, indexPath)
    expect(result.success).toBe(true)

    const loaded = await loadIndex(indexPath)
    expect(loaded?.metadata).toBeDefined()
    expect(loaded?.metadata?.errorCount).toBe(0)
    expect(loaded?.metadata?.lastSuccess).not.toBeNull()
    expect(loaded?.metadata?.lastError).toBeNull()
  })

  test("syncAll propagates attempt count on success", async () => {
    mkdirSync(tempDir, { recursive: true })
    const indexPath = join(tempDir, "attempts-success.json")
    const client = createMockClient()
    client.fetchAllFindings = async () => [createFinding("SCVD-1")]

    const result = await syncAll(client, indexPath)
    expect(result.success).toBe(true)
    expect(result.attempts).toBe(1)
  })

  test("syncAll propagates attempt count on failure", async () => {
    mkdirSync(tempDir, { recursive: true })
    const indexPath = join(tempDir, "attempts-failure.json")
    const client = createMockClient()
    client.fetchAllFindings = async () => {
      throw new Error("SCVD unavailable")
    }

    const result = await syncAll(client, indexPath)
    expect(result.success).toBe(false)
    expect(result.attempts).toBeDefined()
    expect(typeof result.attempts).toBe("number")
  })

  test("error count increments on consecutive failures", async () => {
    mkdirSync(tempDir, { recursive: true })
    const indexPath = join(tempDir, "error-accum.json")
    const client = createMockClient()

    // First: successful sync to create the index
    client.fetchAllFindings = async () => [createFinding("SCVD-1")]
    await syncAll(client, indexPath)

    // Second: failing sync
    client.fetchAllFindings = async () => {
      throw new Error("API down")
    }
    await syncAll(client, indexPath)

    let loaded = await loadIndex(indexPath)
    expect(loaded?.metadata?.errorCount).toBe(1)
    expect(loaded?.metadata?.lastError).toContain("API down")

    // Third: another failure
    client.fetchAllFindings = async () => {
      throw new Error("Still down")
    }
    await syncAll(client, indexPath)

    loaded = await loadIndex(indexPath)
    expect(loaded?.metadata?.errorCount).toBe(2)
    expect(loaded?.metadata?.lastError).toContain("Still down")
  })
})
