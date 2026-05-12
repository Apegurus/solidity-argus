import { describe, expect, test } from "bun:test"

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
