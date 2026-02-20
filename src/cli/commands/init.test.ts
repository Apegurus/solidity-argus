import { describe, expect, it, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { initCommand } from "./init"

describe("initCommand", () => {
  const tempDirs: string[] = []
  const originalCwd = process.cwd

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "argus-init-test-"))
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

  it("creates config file in new project", async () => {
    const dir = makeTempDir()
    process.cwd = () => dir

    const exitCode = await initCommand.execute([])

    expect(exitCode).toBe(0)
    expect(existsSync(join(dir, ".opencode", "solidity-argus.json"))).toBe(true)
  })

  it("refuses to overwrite existing config", async () => {
    const dir = makeTempDir()
    const configDir = join(dir, ".opencode")
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, "solidity-argus.json"), "{}")
    process.cwd = () => dir

    const exitCode = await initCommand.execute([])

    expect(exitCode).toBe(1)
  })

  it("creates valid JSON config", async () => {
    const dir = makeTempDir()
    process.cwd = () => dir

    await initCommand.execute([])

    const content = require("fs").readFileSync(
      join(dir, ".opencode", "solidity-argus.json"),
      "utf-8",
    )
    const parsed = JSON.parse(content)
    expect(parsed.knowledge.scvd.enabled).toBe(true)
    expect(parsed.reporting.format).toBe("markdown")
  })
})
