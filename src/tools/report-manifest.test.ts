import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildReportMetadataComment, scanRunReports } from "./report-manifest"

describe("scanRunReports", () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("finds a report with matching embedded run metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "argus-scan-reports-"))
    dirs.push(dir)
    writeFileSync(
      join(dir, "report.md"),
      `${buildReportMetadataComment("run-1")}\n# Report\nbody\n`,
    )

    expect(scanRunReports(dir, "run-1", "hash")).toHaveLength(1)
  })

  test("does not fully buffer an oversized report; metadata past the scan cap is unread (adj_22)", () => {
    const dir = mkdtempSync(join(tmpdir(), "argus-scan-reports-big-"))
    dirs.push(dir)
    const fillerPastCap = "x".repeat(5 * 1024 * 1024)
    writeFileSync(
      join(dir, "huge.md"),
      `${fillerPastCap}\n${buildReportMetadataComment("run-1")}\n`,
    )

    expect(scanRunReports(dir, "run-1", "hash")).toHaveLength(0)
  })
})
