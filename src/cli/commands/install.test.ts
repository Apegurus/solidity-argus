import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findOpencodeConfig, installCommand } from "./install"

describe("installCommand", () => {
  const tempDirs: string[] = []
  const originalCwd = process.cwd
  let originalHome: string | undefined
  let originalUserProfile: string | undefined

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "argus-install-test-"))
    tempDirs.push(dir)
    return dir
  }

  beforeEach(() => {
    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.env.HOME = originalHome
    process.env.USERPROFILE = originalUserProfile
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

  it("refuses to silently write global config when no local opencode.json exists (Task 5 / Bug #5)", async () => {
    const cwd = makeTempDir()
    const home = makeTempDir()
    process.cwd = () => cwd
    process.env.HOME = home
    process.env.USERPROFILE = home

    const exitCode = await installCommand.execute([])

    expect(exitCode).toBe(0)
    const globalPath = join(home, ".config", "opencode", "opencode.json")
    expect(existsSync(globalPath)).toBe(false)
  })

  it("--global writes ~/.config/opencode/opencode.json without prompt", async () => {
    const cwd = makeTempDir()
    const home = makeTempDir()
    process.cwd = () => cwd
    process.env.HOME = home
    process.env.USERPROFILE = home

    const exitCode = await installCommand.execute(["--global"])

    expect(exitCode).toBe(0)
    const globalPath = join(home, ".config", "opencode", "opencode.json")
    expect(existsSync(globalPath)).toBe(true)
    const config = JSON.parse(readFileSync(globalPath, "utf-8"))
    expect(config.plugin).toContain("solidity-argus")
  })

  it("--global is idempotent against existing global config", async () => {
    const cwd = makeTempDir()
    const home = makeTempDir()
    const globalDir = join(home, ".config", "opencode")
    const globalPath = join(globalDir, "opencode.json")
    require("node:fs").mkdirSync(globalDir, { recursive: true })
    writeFileSync(globalPath, JSON.stringify({ plugin: ["solidity-argus"] }))
    process.cwd = () => cwd
    process.env.HOME = home
    process.env.USERPROFILE = home

    const exitCode = await installCommand.execute(["--global"])

    expect(exitCode).toBe(0)
    const config = JSON.parse(readFileSync(globalPath, "utf-8"))
    expect(config.plugin.filter((p: string) => p === "solidity-argus")).toHaveLength(1)
  })

  it("prefers local opencode.json over global when no flag is given", async () => {
    const cwd = makeTempDir()
    const home = makeTempDir()
    writeFileSync(join(cwd, "opencode.json"), JSON.stringify({ plugin: [] }))
    process.cwd = () => cwd
    process.env.HOME = home
    process.env.USERPROFILE = home

    const exitCode = await installCommand.execute([])

    expect(exitCode).toBe(0)
    const localConfig = JSON.parse(readFileSync(join(cwd, "opencode.json"), "utf-8"))
    expect(localConfig.plugin).toContain("solidity-argus")
    const globalPath = join(home, ".config", "opencode", "opencode.json")
    expect(existsSync(globalPath)).toBe(false)
  })
})
