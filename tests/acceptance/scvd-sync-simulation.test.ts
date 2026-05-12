import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { ScvdFinding } from "../../src/knowledge/scvd-client"
import { ScvdApiError, ScvdClient, ScvdNetworkError } from "../../src/knowledge/scvd-client"
import type { ScvdIndex } from "../../src/knowledge/scvd-index"
import { loadIndex, releaseSyncLock } from "../../src/knowledge/scvd-index"
import { isSyncStale, syncAll } from "../../src/knowledge/scvd-sync"

const TEMP_DIR = "/tmp/argus-acceptance-scvd-sync"

function makeFinding(id: string, severity: ScvdFinding["severity"] = "High"): ScvdFinding {
  return {
    scvd_id: id,
    doc_id: `doc-${id}`,
    title: `Finding ${id}`,
    description_md: `Description for finding ${id}`,
    severity,
    taxonomy: { swc: ["SWC-107"], cwe: ["CWE-841"] },
    repo: { url: "https://github.com/example/repo" },
    sections: {},
  }
}

function mockClient(): ScvdClient {
  return new ScvdClient("https://mock.scvd.test")
}

beforeEach(() => {
  releaseSyncLock()
  mkdirSync(TEMP_DIR, { recursive: true })
})

afterEach(() => {
  releaseSyncLock()
  rmSync(TEMP_DIR, { recursive: true, force: true })
})

describe("failure mode: network timeout", () => {
  test("network timeout triggers retries then returns error result", async () => {
    const indexPath = join(TEMP_DIR, "net-timeout.json")
    const client = mockClient()
    let attempts = 0

    client.fetchAllFindings = async () => {
      attempts++
      throw new ScvdNetworkError("Connection timed out")
    }

    const result = await syncAll(client, indexPath)

    expect(attempts).toBe(3)
    expect(result.success).toBe(false)
    expect(result.status).toBe("error")
    if (result.status === "error") {
      expect(result.reason).toBe("network")
      expect(result.message).toContain("timed out")
    }
  }, 15_000)
})

describe("failure mode: API server error", () => {
  test("API 500 error returns error result with reason 'api'", async () => {
    const indexPath = join(TEMP_DIR, "api-500.json")
    const client = mockClient()
    let attempts = 0

    client.fetchAllFindings = async () => {
      attempts++
      throw new ScvdApiError(500, "Internal Server Error")
    }

    const result = await syncAll(client, indexPath)

    expect(attempts).toBe(1)
    expect(result.success).toBe(false)
    expect(result.status).toBe("error")
    if (result.status === "error") {
      expect(result.reason).toBe("api")
      expect(result.httpStatus).toBe(500)
    }
  })
})

describe("failure mode: partial response", () => {
  test("truncated response triggers parse error classification", async () => {
    const indexPath = join(TEMP_DIR, "parse-err.json")
    const client = mockClient()

    client.fetchAllFindings = async () => {
      throw new Error("Unexpected end of JSON input")
    }

    const result = await syncAll(client, indexPath)

    expect(result.success).toBe(false)
    expect(result.status).toBe("error")
    if (result.status === "error") {
      expect(result.reason).toBe("parse")
      expect(result.message).toContain("Unexpected end of JSON input")
    }
  })

  test("undefined payload from fetchAllFindings classified as parse error", async () => {
    const indexPath = join(TEMP_DIR, "parse-undef.json")
    const client = mockClient()

    client.fetchAllFindings = (async () => undefined) as unknown as typeof client.fetchAllFindings

    const result = await syncAll(client, indexPath)

    expect(result.success).toBe(false)
    expect(result.status).toBe("error")
    if (result.status === "error") {
      expect(result.reason).toBe("parse")
      expect(result.message).toContain("no findings payload")
    }
  })
})

describe("failure mode: concurrent sync", () => {
  test("concurrent sync attempts — only one actual execution", async () => {
    const indexPath = join(TEMP_DIR, "concurrent.json")
    const client = mockClient()
    let fetchCount = 0

    client.fetchAllFindings = async () => {
      fetchCount++
      await new Promise((r) => setTimeout(r, 100))
      return [makeFinding("SCVD-1")]
    }

    const [r1, r2] = await Promise.all([syncAll(client, indexPath), syncAll(client, indexPath)])

    const results = [r1, r2]
    const successes = results.filter((r) => r.success === true)
    const blocked = results.filter(
      (r) =>
        r.success === false &&
        r.status === "error" &&
        r.reason === "lock" &&
        r.message.includes("already in progress"),
    )

    expect(successes).toHaveLength(1)
    expect(blocked).toHaveLength(1)
    expect(fetchCount).toBe(1)
  })
})

describe("staleness detection", () => {
  test("isSyncStale returns true for index older than 7 days", () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()

    const index: ScvdIndex = {
      version: 1,
      lastSync: eightDaysAgo,
      totalFindings: 5,
      entries: [],
    }

    expect(isSyncStale(index)).toBe(true)
  })

  test("isSyncStale returns false for fresh index", () => {
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()

    const index: ScvdIndex = {
      version: 1,
      lastSync: oneDayAgo,
      totalFindings: 5,
      entries: [],
    }

    expect(isSyncStale(index)).toBe(false)
  })

  test("isSyncStale returns true for null index", () => {
    expect(isSyncStale(null)).toBe(true)
  })
})

describe("failure recovery", () => {
  test("recovery after failure — next sync succeeds with clean metadata", async () => {
    const indexPath = join(TEMP_DIR, "recovery.json")
    const client = mockClient()

    client.fetchAllFindings = async () => [makeFinding("SCVD-1")]
    const bootstrapResult = await syncAll(client, indexPath)
    expect(bootstrapResult.success).toBe(true)

    client.fetchAllFindings = async () => {
      throw new ScvdApiError(503, "Service Unavailable")
    }
    const failResult = await syncAll(client, indexPath)
    expect(failResult.success).toBe(false)

    const postFailIndex = await loadIndex(indexPath)
    expect(postFailIndex?.metadata?.errorCount).toBe(1)
    expect(postFailIndex?.metadata?.lastError).toContain("Service Unavailable")

    client.fetchAllFindings = async () => [
      makeFinding("SCVD-1"),
      makeFinding("SCVD-2"),
      makeFinding("SCVD-3"),
    ]
    const recoveryResult = await syncAll(client, indexPath)
    expect(recoveryResult.success).toBe(true)
    expect(recoveryResult.newFindings).toBe(3)
    expect(recoveryResult.totalIndexed).toBe(3)

    const postRecoveryIndex = await loadIndex(indexPath)
    expect(postRecoveryIndex).not.toBeNull()
    expect(postRecoveryIndex?.totalFindings).toBe(3)
    expect(postRecoveryIndex?.metadata?.errorCount).toBe(0)
    expect(postRecoveryIndex?.metadata?.lastError).toBeNull()
    expect(postRecoveryIndex?.metadata?.lastSuccess).not.toBeNull()
  })
})

describe("happy path", () => {
  test("successful sync returns correct counts and persists metadata", async () => {
    const indexPath = join(TEMP_DIR, "happy.json")
    const client = mockClient()

    const findings = [
      makeFinding("SCVD-1", "Critical"),
      makeFinding("SCVD-2", "High"),
      makeFinding("SCVD-3", "Medium"),
      makeFinding("SCVD-4", "Low"),
      makeFinding("SCVD-5", "Informational"),
    ]
    client.fetchAllFindings = async () => findings

    const result = await syncAll(client, indexPath)

    expect(result.success).toBe(true)
    expect(result.status).toBe("success")
    expect(result.newFindings).toBe(5)
    expect(result.totalIndexed).toBe(5)
    expect(typeof result.lastSync).toBe("string")
    expect(result.lastSync.length).toBeGreaterThan(0)

    const index = await loadIndex(indexPath)
    expect(index).not.toBeNull()
    expect(index?.version).toBe(1)
    expect(index?.totalFindings).toBe(5)
    expect(index?.entries).toHaveLength(5)

    expect(index?.metadata?.errorCount).toBe(0)
    expect(index?.metadata?.lastSuccess).not.toBeNull()
    expect(index?.metadata?.lastAttempt).not.toBeNull()
    expect(index?.metadata?.lastError).toBeNull()
    expect(index?.metadata?.lastErrorReason).toBeNull()

    const first = index?.entries.at(0)
    expect(first).toBeDefined()
    expect(first?.id).toBe("SCVD-1")
    expect(first?.severity).toBe("Critical")
    expect(first?.swc).toContain("SWC-107")
    expect(first?.keywords.length).toBeGreaterThan(0)
  })
})

describe("edge case: empty findings", () => {
  test("sync with empty findings returns success with zero count", async () => {
    const indexPath = join(TEMP_DIR, "empty.json")
    const client = mockClient()

    client.fetchAllFindings = async () => []

    const result = await syncAll(client, indexPath)

    expect(result.success).toBe(true)
    expect(result.status).toBe("success")
    expect(result.newFindings).toBe(0)
    expect(result.totalIndexed).toBe(0)

    const index = await loadIndex(indexPath)
    expect(index).not.toBeNull()
    expect(index?.totalFindings).toBe(0)
    expect(index?.entries).toHaveLength(0)
    expect(index?.metadata?.errorCount).toBe(0)
  })
})

describe("failure accumulation", () => {
  test("error count increments across consecutive failures and resets on success", async () => {
    const indexPath = join(TEMP_DIR, "accum.json")
    const client = mockClient()

    client.fetchAllFindings = async () => [makeFinding("SCVD-1")]
    await syncAll(client, indexPath)

    client.fetchAllFindings = async () => {
      throw new ScvdApiError(400, "Bad Request")
    }
    await syncAll(client, indexPath)
    let index = await loadIndex(indexPath)
    expect(index?.metadata?.errorCount).toBe(1)

    client.fetchAllFindings = async () => {
      throw new ScvdApiError(422, "Unprocessable Entity")
    }
    await syncAll(client, indexPath)
    index = await loadIndex(indexPath)
    expect(index?.metadata?.errorCount).toBe(2)
    expect(index?.metadata?.lastError).toContain("Unprocessable Entity")
    expect(index?.metadata?.lastErrorReason).toBe("api")

    client.fetchAllFindings = async () => [makeFinding("SCVD-1"), makeFinding("SCVD-2")]
    await syncAll(client, indexPath)
    index = await loadIndex(indexPath)
    expect(index?.metadata?.errorCount).toBe(0)
    expect(index?.metadata?.lastError).toBeNull()
    expect(index?.metadata?.lastErrorReason).toBeNull()
  })
})
