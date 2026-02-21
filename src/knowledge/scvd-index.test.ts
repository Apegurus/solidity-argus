import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { mkdirSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { ScvdFinding } from "./scvd-client"
import { ScvdClient } from "./scvd-client"
import {
  acquireSyncLock,
  buildIndex,
  isSyncLocked,
  loadIndex,
  releaseSyncLock,
  saveIndex,
  searchIndex,
} from "./scvd-index"
import { syncAll } from "./scvd-sync"

function createFinding(
  id: string,
  severity: "Critical" | "High" | "Medium" | "Low" | "Informational",
  title: string,
  description: string,
  swc: string[],
): ScvdFinding {
  return {
    scvd_id: id,
    doc_id: `doc-${id}`,
    title,
    description_md: description,
    severity,
    taxonomy: {
      swc,
      cwe: ["CWE-703"],
    },
    repo: {
      url: "https://github.com/example/repo",
    },
    sections: {},
  }
}

const tempDir = "/tmp/argus-scvd-index-tests"

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
  releaseSyncLock()
})

describe("buildIndex", () => {
  test("builds compact entries and metadata", () => {
    const findings = [
      createFinding(
        "SCVD-1",
        "High",
        "Reentrancy in withdraw",
        "External call before state update allows repeated withdrawals.",
        ["SWC-107"],
      ),
      createFinding(
        "SCVD-2",
        "Medium",
        "Unchecked transfer result",
        "ERC20 transfer return value ignored.",
        ["SWC-104"],
      ),
    ]

    const index = buildIndex(findings)

    expect(index.version).toBe(1)
    expect(index.totalFindings).toBe(2)
    expect(index.entries).toHaveLength(2)
    expect(index.entries[0]?.id).toBe("SCVD-1")
    expect(index.entries[0]?.swc).toEqual(["SWC-107"])
    expect(index.entries[0]?.keywords).toContain("reentrancy")
    expect(index.entries[0]?.keywords).toContain("withdraw")
  })
})

describe("searchIndex", () => {
  const index = buildIndex([
    createFinding(
      "SCVD-1",
      "High",
      "Reentrancy in withdraw",
      "External call before state update allows repeated withdrawals.",
      ["SWC-107"],
    ),
    createFinding(
      "SCVD-2",
      "Critical",
      "Access control bypass",
      "Missing onlyOwner check allows admin theft.",
      ["SWC-105"],
    ),
    createFinding(
      "SCVD-3",
      "Low",
      "Missing event",
      "State-changing operations should emit events.",
      ["SWC-132"],
    ),
  ])

  test("filters by exact SWC", () => {
    const results = searchIndex(index, { swc: "SWC-107" })
    expect(results).toHaveLength(1)
    expect(results[0]?.id).toBe("SCVD-1")
  })

  test("filters by exact severity", () => {
    const results = searchIndex(index, { severity: "Critical" })
    expect(results).toHaveLength(1)
    expect(results[0]?.id).toBe("SCVD-2")
  })

  test("filters by keyword substring", () => {
    const results = searchIndex(index, { keyword: "withdr" })
    expect(results).toHaveLength(1)
    expect(results[0]?.id).toBe("SCVD-1")
  })

  test("combines filters with AND logic", () => {
    const results = searchIndex(index, {
      swc: "SWC-107",
      severity: "High",
      keyword: "reentrancy",
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.id).toBe("SCVD-1")
  })

  test("applies default limit of 10 and custom limit", () => {
    const many = buildIndex(
      Array.from({ length: 20 }).map((_, idx) =>
        createFinding(`SCVD-${idx + 1}`, "High", `Issue ${idx + 1}`, "keyword shared text", [
          "SWC-107",
        ]),
      ),
    )

    const defaultLimited = searchIndex(many, { keyword: "keyword" })
    const customLimited = searchIndex(many, { keyword: "keyword", limit: 3 })

    expect(defaultLimited).toHaveLength(10)
    expect(customLimited).toHaveLength(3)
  })
})

describe("saveIndex/loadIndex", () => {
  test("saves and loads index JSON", async () => {
    mkdirSync(tempDir, { recursive: true })
    const filePath = join(tempDir, "scvd-index.json")
    const index = buildIndex([
      createFinding(
        "SCVD-1",
        "High",
        "Reentrancy in withdraw",
        "External call before state update allows repeated withdrawals.",
        ["SWC-107"],
      ),
    ])

    await saveIndex(index, filePath)
    const loaded = await loadIndex(filePath)

    expect(loaded).not.toBeNull()
    expect(loaded?.totalFindings).toBe(1)
    expect(loaded?.entries[0]?.id).toBe("SCVD-1")
  })

  test("loadIndex returns null when file does not exist", async () => {
    const missingPath = join(tempDir, "missing.json")
    const loaded = await loadIndex(missingPath)
    expect(loaded).toBeNull()
  })

  test("uses atomic write with temp file then rename", async () => {
    mkdirSync(tempDir, { recursive: true })
    const filePath = join(tempDir, "atomic-index.json")
    const index = buildIndex([createFinding("SCVD-1", "High", "A", "B", ["SWC-107"])])

    const writeSpy = spyOn(Bun, "write")
    const nodeFs = await import("node:fs")
    const renameSpy = spyOn(nodeFs, "renameSync")

    try {
      await saveIndex(index, filePath)

      expect(writeSpy).toHaveBeenCalledTimes(1)
      expect(renameSpy).toHaveBeenCalledTimes(1)

      const tmpPathArg = String((writeSpy.mock.calls[0] as unknown[])[0])
      const renameFrom = String((renameSpy.mock.calls[0] as unknown[])[0])
      const renameTo = String((renameSpy.mock.calls[0] as unknown[])[1])

      expect(tmpPathArg.startsWith(`${filePath}.tmp.`)).toBe(true)
      expect(renameFrom).toBe(tmpPathArg)
      expect(renameTo).toBe(filePath)

      const leftovers = readdirSync(tempDir).filter((name) => name.includes(".tmp."))
      expect(leftovers).toHaveLength(0)
    } finally {
      writeSpy.mockRestore()
      renameSpy.mockRestore()
    }
  })

  test("does not corrupt existing target when temp write fails", async () => {
    mkdirSync(tempDir, { recursive: true })
    const filePath = join(tempDir, "atomic-failure.json")
    const original = buildIndex([createFinding("SCVD-1", "High", "A", "B", ["SWC-107"])])
    const next = buildIndex([createFinding("SCVD-2", "Critical", "C", "D", ["SWC-105"])])

    await saveIndex(original, filePath)
    const before = await Bun.file(filePath).text()

    const writeSpy = spyOn(Bun, "write").mockImplementation(async (path) => {
      if (typeof path === "string" && path.startsWith(`${filePath}.tmp.`)) {
        throw new Error("disk full")
      }

      return Promise.resolve(0)
    })

    let errorMessage = ""

    try {
      await saveIndex(next, filePath)
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error)
    }

    expect(errorMessage).toContain("disk full")

    writeSpy.mockRestore()

    const after = await Bun.file(filePath).text()
    expect(after).toBe(before)
  })

  test("loadIndex still works after atomic save", async () => {
    mkdirSync(tempDir, { recursive: true })
    const filePath = join(tempDir, "post-atomic-load.json")
    const index = buildIndex([
      createFinding("SCVD-99", "Medium", "Unchecked return", "Token call ignored", ["SWC-104"]),
    ])

    await saveIndex(index, filePath)
    const loaded = await loadIndex(filePath)

    expect(loaded?.entries[0]?.id).toBe("SCVD-99")
    expect(loaded?.totalFindings).toBe(1)
  })
})

describe("sync lock", () => {
  test("second sync is skipped while first is in progress", async () => {
    mkdirSync(tempDir, { recursive: true })
    const indexPath = join(tempDir, "sync-lock-index.json")
    const client = new ScvdClient("https://api.scvd.dev")

    let resolveFetch!: (value: ScvdFinding[]) => void
    const firstFetch = new Promise<ScvdFinding[]>((resolve) => {
      resolveFetch = resolve
    })

    client.fetchAllFindings = async () => firstFetch

    const firstSync = syncAll(client, indexPath)
    await Promise.resolve()

    const secondSync = await syncAll(client, indexPath)
    expect(secondSync.success).toBe(false)
    expect(secondSync.error).toContain("Sync already in progress")

    resolveFetch([createFinding("SCVD-1", "High", "A", "B", ["SWC-107"])])
    await firstSync
  })

  test("lock is released after successful sync", async () => {
    mkdirSync(tempDir, { recursive: true })
    const indexPath = join(tempDir, "sync-release-success.json")
    const client = new ScvdClient("https://api.scvd.dev")
    client.fetchAllFindings = async () => [createFinding("SCVD-1", "High", "A", "B", ["SWC-107"])]

    expect(isSyncLocked()).toBe(false)
    const result = await syncAll(client, indexPath)

    expect(result.success).toBe(true)
    expect(isSyncLocked()).toBe(false)
  })

  test("lock is released after sync failure and write crash", async () => {
    mkdirSync(tempDir, { recursive: true })
    const indexPath = join(tempDir, "sync-release-failure.json")
    const client = new ScvdClient("https://api.scvd.dev")
    client.fetchAllFindings = async () => [createFinding("SCVD-1", "High", "A", "B", ["SWC-107"])]

    const writeSpy = spyOn(Bun, "write").mockImplementation(async (path) => {
      if (typeof path === "string" && path.startsWith(`${indexPath}.tmp.`)) {
        throw new Error("forced write crash")
      }

      return Promise.resolve(0)
    })

    const result = await syncAll(client, indexPath)

    writeSpy.mockRestore()

    expect(result.success).toBe(false)
    expect(result.error).toContain("forced write crash")
    expect(isSyncLocked()).toBe(false)
  })

  test("acquireSyncLock prevents concurrent acquisition and release unlocks", () => {
    expect(isSyncLocked()).toBe(false)
    expect(acquireSyncLock()).toBe(true)
    expect(isSyncLocked()).toBe(true)
    expect(acquireSyncLock()).toBe(false)
    releaseSyncLock()
    expect(isSyncLocked()).toBe(false)
  })
})
