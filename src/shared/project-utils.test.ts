import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findFoundryProjectDir, resolveProjectDir } from "./project-utils"

describe("resolveProjectDir", () => {
  it("returns context.directory when present", () => {
    const result = resolveProjectDir({ directory: "/proj/a", worktree: "/proj/b" })
    expect(result).toBe("/proj/a")
  })

  it("falls back to context.worktree when directory is missing", () => {
    const result = resolveProjectDir({ worktree: "/proj/b" })
    expect(result).toBe("/proj/b")
  })

  it("falls back to process.cwd() when both are missing", () => {
    const result = resolveProjectDir({})
    expect(result).toBe(process.cwd())
  })

  it("falls back to process.cwd() when both are undefined", () => {
    const result = resolveProjectDir({ directory: undefined, worktree: undefined })
    expect(result).toBe(process.cwd())
  })
})

describe("findFoundryProjectDir", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  it("finds foundry.toml in the parent directory", () => {
    const root = mkdtempSync(join(tmpdir(), "argus-proj-utils-"))
    tempDirs.push(root)

    writeFileSync(join(root, "foundry.toml"), "[profile.default]\n")
    const nested = join(root, "src", "contracts")
    mkdirSync(nested, { recursive: true })
    const filePath = join(nested, "Vault.sol")
    writeFileSync(filePath, "contract Vault {}")

    expect(findFoundryProjectDir(filePath)).toBe(root)
  })

  it("returns file parent directory when no foundry.toml found", () => {
    const root = mkdtempSync(join(tmpdir(), "argus-proj-utils-"))
    tempDirs.push(root)

    const nested = join(root, "contracts")
    mkdirSync(nested, { recursive: true })
    const filePath = join(nested, "Vault.sol")
    writeFileSync(filePath, "contract Vault {}")

    expect(findFoundryProjectDir(filePath)).toBe(nested)
  })

  it("finds foundry.toml in the same directory as the file", () => {
    const root = mkdtempSync(join(tmpdir(), "argus-proj-utils-"))
    tempDirs.push(root)

    writeFileSync(join(root, "foundry.toml"), "[profile.default]\n")
    const filePath = join(root, "Vault.sol")
    writeFileSync(filePath, "contract Vault {}")

    expect(findFoundryProjectDir(filePath)).toBe(root)
  })
})
