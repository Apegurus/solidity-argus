import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findOpencodeConfig, installCommand } from "./install"

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
    expect(config.plugin).toContain("solidity-argus")
  })

  it("is idempotent", async () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, "opencode.json"), JSON.stringify({ plugin: ["solidity-argus"] }))
    process.cwd = () => dir

    const exitCode = await installCommand.execute([])

    expect(exitCode).toBe(0)
    const config = JSON.parse(readFileSync(join(dir, "opencode.json"), "utf-8"))
    expect(config.plugin.filter((p: string) => p === "solidity-argus")).toHaveLength(1)
  })

  it("returns null when no config exists", () => {
    const dir = makeTempDir()
    process.cwd = () => dir

    expect(findOpencodeConfig(dir)).toBeNull()
  })
})
