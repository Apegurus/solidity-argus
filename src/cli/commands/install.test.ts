import { describe, expect, it, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { installCommand, findOpencodeConfig } from "./install"

describe("installCommand", () => {
  const tempDirs: string[] = []
  const originalCwd = process.cwd

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "argus-install-test-"))
    tempDirs.push(dir)
    return dir
  }

  afterEach(() => {
    process.cwd = originalCwd
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  it("adds plugin to opencode.json", async () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, "opencode.json"), JSON.stringify({ plugin: [] }))
    process.cwd = () => dir

    const exitCode = await installCommand.execute([])

    expect(exitCode).toBe(0)
    const config = JSON.parse(readFileSync(join(dir, "opencode.json"), "utf-8"))
    expect(config.plugin).toContain("opencode-argus")
  })

  it("is idempotent", async () => {
    const dir = makeTempDir()
    writeFileSync(
      join(dir, "opencode.json"),
      JSON.stringify({ plugin: ["opencode-argus"] }),
    )
    process.cwd = () => dir

    const exitCode = await installCommand.execute([])

    expect(exitCode).toBe(0)
    const config = JSON.parse(readFileSync(join(dir, "opencode.json"), "utf-8"))
    expect(config.plugin.filter((p: string) => p === "opencode-argus")).toHaveLength(1)
  })

  it("returns null when no config exists", () => {
    const dir = makeTempDir()
    process.cwd = () => dir

    expect(findOpencodeConfig(dir)).toBeNull()
  })
})
