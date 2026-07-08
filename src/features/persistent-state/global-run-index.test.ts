import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getGlobalRunIndexFile } from "../../shared/cache-paths"
import { compactRunIndex, resolveRunIdFromOpencodeSession } from "./global-run-index"

function resolveFromLines(
  lines: string[],
  opencodeSessionId: string,
  projectDir?: string,
): string | null {
  const now = Date.now()
  const STALE_TTL = 24 * 60 * 60 * 1000
  const terminatedRunIds = new Set<string>()

  for (let idx = lines.length - 1; idx >= 0; idx--) {
    const line = lines[idx]
    if (!line || line.trim().length === 0) continue

    const parsed = JSON.parse(line)

    if (parsed.status === "finalized" || parsed.status === "failed") {
      if (typeof parsed.runId === "string") {
        terminatedRunIds.add(parsed.runId)
      }
      continue
    }

    if (
      parsed.opencodeSessionId === opencodeSessionId &&
      typeof parsed.runId === "string" &&
      parsed.runId.length > 0 &&
      (!projectDir || parsed.projectDir === projectDir)
    ) {
      if (terminatedRunIds.has(parsed.runId)) continue
      if (typeof parsed.startedAt === "number" && now - parsed.startedAt > STALE_TTL) continue
      return parsed.runId
    }
  }
  return null
}

describe("resolveRunIdFromOpencodeSession filtering", () => {
  test("returns active run matching session", () => {
    const lines = [
      JSON.stringify({
        runId: "run-1",
        opencodeSessionId: "ses-1",
        projectDir: "/proj",
        startedAt: Date.now() - 1000,
      }),
    ]
    expect(resolveFromLines(lines, "ses-1")).toBe("run-1")
  })

  test("skips finalized runs", () => {
    const lines = [
      JSON.stringify({
        runId: "run-1",
        opencodeSessionId: "ses-1",
        projectDir: "/proj",
        startedAt: Date.now() - 1000,
      }),
      JSON.stringify({ runId: "run-1", status: "finalized", finalizedAt: Date.now() }),
    ]
    expect(resolveFromLines(lines, "ses-1")).toBeNull()
  })

  test("skips failed runs", () => {
    const lines = [
      JSON.stringify({
        runId: "run-1",
        opencodeSessionId: "ses-1",
        projectDir: "/proj",
        startedAt: Date.now() - 1000,
      }),
      JSON.stringify({ runId: "run-1", status: "failed" }),
    ]
    expect(resolveFromLines(lines, "ses-1")).toBeNull()
  })

  test("skips stale runs older than 24h", () => {
    const lines = [
      JSON.stringify({
        runId: "run-old",
        opencodeSessionId: "ses-1",
        projectDir: "/proj",
        startedAt: Date.now() - 25 * 60 * 60 * 1000,
      }),
    ]
    expect(resolveFromLines(lines, "ses-1")).toBeNull()
  })

  test("returns fresh run when stale run exists for same session", () => {
    const lines = [
      JSON.stringify({
        runId: "run-old",
        opencodeSessionId: "ses-1",
        projectDir: "/proj",
        startedAt: Date.now() - 25 * 60 * 60 * 1000,
      }),
      JSON.stringify({
        runId: "run-new",
        opencodeSessionId: "ses-1",
        projectDir: "/proj",
        startedAt: Date.now() - 1000,
      }),
    ]
    expect(resolveFromLines(lines, "ses-1")).toBe("run-new")
  })

  test("returns second run when first is finalized", () => {
    const lines = [
      JSON.stringify({
        runId: "run-1",
        opencodeSessionId: "ses-1",
        projectDir: "/proj",
        startedAt: Date.now() - 3600000,
      }),
      JSON.stringify({ runId: "run-1", status: "finalized" }),
      JSON.stringify({
        runId: "run-2",
        opencodeSessionId: "ses-1",
        projectDir: "/proj",
        startedAt: Date.now() - 1000,
      }),
    ]
    expect(resolveFromLines(lines, "ses-1")).toBe("run-2")
  })

  test("filters by projectDir when provided", () => {
    const lines = [
      JSON.stringify({
        runId: "run-other",
        opencodeSessionId: "ses-1",
        projectDir: "/other-proj",
        startedAt: Date.now() - 1000,
      }),
      JSON.stringify({
        runId: "run-match",
        opencodeSessionId: "ses-1",
        projectDir: "/my-proj",
        startedAt: Date.now() - 1000,
      }),
    ]
    expect(resolveFromLines(lines, "ses-1", "/my-proj")).toBe("run-match")
  })

  test("returns null for empty session id", () => {
    expect(resolveFromLines([], "")).toBeNull()
  })
})

describe("compactRunIndex", () => {
  test("keeps only the last N entries and drops older ones (WS-6)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "argus-runindex-"))
    const prev = process.env.ARGUS_CACHE_DIR
    process.env.ARGUS_CACHE_DIR = dir
    try {
      mkdirSync(join(dir, "runs"), { recursive: true })
      const file = getGlobalRunIndexFile()
      const lines = Array.from({ length: 20 }, (_, i) => JSON.stringify({ runId: `run-${i}` }))
      writeFileSync(file, `${lines.join("\n")}\n`)

      await compactRunIndex(5)

      const kept = readFileSync(file, "utf-8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
      expect(kept).toHaveLength(5)
      expect(JSON.parse(kept[0] as string).runId).toBe("run-15")
      expect(JSON.parse(kept[4] as string).runId).toBe("run-19")
    } finally {
      if (prev === undefined) {
        delete process.env.ARGUS_CACHE_DIR
      } else {
        process.env.ARGUS_CACHE_DIR = prev
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("preserves a still-active run's mapping while dropping terminated runs (adj_10)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "argus-runindex-adj10-"))
    const prev = process.env.ARGUS_CACHE_DIR
    process.env.ARGUS_CACHE_DIR = dir
    try {
      mkdirSync(join(dir, "runs"), { recursive: true })
      const file = getGlobalRunIndexFile()

      const lines: string[] = [
        JSON.stringify({
          runId: "run-active",
          opencodeSessionId: "ses-active",
          projectDir: "/proj",
          startedAt: Date.now() - 1000,
          status: "active",
        }),
      ]
      for (let i = 0; i < 10; i++) {
        lines.push(
          JSON.stringify({
            runId: `run-term-${i}`,
            opencodeSessionId: `ses-term-${i}`,
            projectDir: "/proj",
            startedAt: Date.now() - 500,
            status: "active",
          }),
        )
        lines.push(JSON.stringify({ runId: `run-term-${i}`, status: "finalized" }))
      }
      writeFileSync(file, `${lines.join("\n")}\n`)

      await compactRunIndex(5)

      expect(resolveRunIdFromOpencodeSession("ses-active", "/proj")).toBe("run-active")
    } finally {
      if (prev === undefined) {
        delete process.env.ARGUS_CACHE_DIR
      } else {
        process.env.ARGUS_CACHE_DIR = prev
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
