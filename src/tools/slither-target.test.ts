import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Finding } from "../state/types"
import {
  filterSlitherFindings,
  resolveSlitherInvocation,
  validateFoundryCompilerConfig,
  validateFoundrySourceClosure,
  validateSlitherTarget,
} from "./slither-target"

describe("validateSlitherTarget", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
    tempDirs.length = 0
  })

  function project(): { root: string; target: string } {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "argus-slither-target-")))
    tempDirs.push(root)
    const sourceDir = join(root, "src")
    const target = join(sourceDir, "Vault.sol")
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(target, "contract Vault {}")
    return { root, target }
  }

  it("accepts an existing target inside the project", () => {
    const { root, target } = project()

    expect(validateSlitherTarget(target, root)).toEqual({ ok: true, target })
  })

  it("rejects a nonexistent target", () => {
    const { root } = project()

    expect(validateSlitherTarget(join(root, "src", "Vualt.sol"), root)).toEqual({
      ok: false,
      code: "SLITHER_TARGET_NOT_FOUND",
      message: "Slither target does not exist: src/Vualt.sol",
    })
  })

  it("rejects a target outside the active project", () => {
    const { root } = project()
    const outside = mkdtempSync(join(tmpdir(), "argus-slither-outside-"))
    tempDirs.push(outside)
    const outsideTarget = join(outside, "Other.sol")
    writeFileSync(outsideTarget, "contract Other {}")

    expect(validateSlitherTarget(outsideTarget, root).ok).toBe(false)
  })

  it("rejects a symlink that escapes the active project", () => {
    const { root } = project()
    const outside = mkdtempSync(join(tmpdir(), "argus-slither-outside-"))
    tempDirs.push(outside)
    const outsideTarget = join(outside, "Other.sol")
    const linkedTarget = join(root, "src", "Linked.sol")
    writeFileSync(outsideTarget, "contract Other {}")
    symlinkSync(outsideTarget, linkedTarget)

    expect(validateSlitherTarget(linkedTarget, root).ok).toBe(false)
  })
})

describe("resolveSlitherInvocation", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
    tempDirs.length = 0
  })

  function foundryProject(): { root: string; sourceDir: string; sourceFile: string } {
    const root = mkdtempSync(join(tmpdir(), "argus-slither-invocation-"))
    tempDirs.push(root)
    const sourceDir = join(root, "src")
    const sourceFile = join(sourceDir, "Vault.sol")
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(root, "foundry.toml"), "[profile.default]\n")
    writeFileSync(sourceFile, "contract Vault {}")
    return { root, sourceDir, sourceFile }
  }

  it("compiles a Foundry root and preserves the root reporting scope", () => {
    const { root } = foundryProject()

    expect(resolveSlitherInvocation(root, root)).toEqual({
      commandTarget: root,
      cwd: root,
      reportTarget: root,
    })
  })

  it("compiles a source directory from the Foundry root and reports only that directory", () => {
    const { root, sourceDir } = foundryProject()

    expect(resolveSlitherInvocation(sourceDir, root)).toEqual({
      commandTarget: root,
      cwd: root,
      reportTarget: sourceDir,
    })
  })

  it("compiles a source file from the Foundry root and reports only that file", () => {
    const { root, sourceFile } = foundryProject()

    expect(resolveSlitherInvocation(sourceFile, root)).toEqual({
      commandTarget: root,
      cwd: root,
      reportTarget: sourceFile,
    })
  })

  it("does not compile a Foundry root above the active project", () => {
    const parent = mkdtempSync(join(tmpdir(), "argus-slither-parent-root-"))
    tempDirs.push(parent)
    writeFileSync(join(parent, "foundry.toml"), "[profile.default]\n")
    const projectRoot = join(parent, "workspace")
    const sourceDir = join(projectRoot, "src")
    const sourceFile = join(sourceDir, "Vault.sol")
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(sourceFile, "contract Vault {}")

    expect(resolveSlitherInvocation(sourceFile, projectRoot)).toEqual({
      commandTarget: sourceFile,
      cwd: projectRoot,
      reportTarget: sourceFile,
    })
    const finding: Finding = {
      id: "finding-standalone",
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Standalone finding",
      file: "src/Vault.sol",
      lines: [1, 1],
      source: "slither",
    }
    expect(filterSlitherFindings([finding], sourceFile, projectRoot, projectRoot)).toEqual([
      finding,
    ])
  })

  it("normalizes nested Foundry findings relative to the active project", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "argus-slither-monorepo-"))
    tempDirs.push(projectRoot)
    const foundryRoot = join(projectRoot, "packages", "inner")
    const sourceDir = join(foundryRoot, "src")
    const sourceFile = join(sourceDir, "Inner.sol")
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(foundryRoot, "foundry.toml"), "[profile.default]\n")
    writeFileSync(sourceFile, "contract Inner {}")
    const finding: Finding = {
      id: "finding-1",
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Nested finding",
      file: "src/Inner.sol",
      lines: [1, 1],
      source: "slither",
    }

    expect(resolveSlitherInvocation(sourceFile, projectRoot)).toEqual({
      commandTarget: foundryRoot,
      cwd: foundryRoot,
      reportTarget: sourceFile,
    })
    expect(filterSlitherFindings([finding], sourceFile, foundryRoot, projectRoot)).toEqual([
      { ...finding, file: "packages/inner/src/Inner.sol" },
    ])
  })

  it("rejects a path-valued Foundry compiler", () => {
    const { root } = foundryProject()
    writeFileSync(join(root, "foundry.toml"), '[profile.default]\nsolc = "./tools/solc"\n')

    expect(validateFoundryCompilerConfig(root)).toEqual({
      ok: false,
      message: "Foundry config must select a version-pinned compiler",
    })
  })

  it("accepts a version-pinned Foundry compiler", () => {
    const { root } = foundryProject()
    writeFileSync(join(root, "foundry.toml"), '[profile.default]\nsolc = "0.8.24"\n')

    expect(validateFoundryCompilerConfig(root)).toEqual({ ok: true })
  })

  it("rejects semantic compiler-path variants and environment overrides", () => {
    const { root } = foundryProject()
    const unsafeConfigs = [
      '[profile.default]\n"solc" = "./tools/solc"\n',
      'profile.default.solc = "./tools/solc"\n',
      '[profile]\ndefault = { solc = "./tools/solc" }\n',
    ]

    for (const config of unsafeConfigs) {
      writeFileSync(join(root, "foundry.toml"), config)
      expect(validateFoundryCompilerConfig(root).ok).toBe(false)
    }

    writeFileSync(join(root, "foundry.toml"), "[profile.default]\n")
    writeFileSync(join(root, ".env"), "FOUNDRY_SOLC_VERSION=./tools/solc\n")
    expect(validateFoundryCompilerConfig(root).ok).toBe(false)
    rmSync(join(root, ".env"))
    writeFileSync(join(root, "slither.config.json"), '{"solc":"./tools/solc"}')
    expect(validateFoundryCompilerConfig(root).ok).toBe(true)
  })

  it("rejects compiler aliases and Foundry config indirection", () => {
    const { root } = foundryProject()

    writeFileSync(join(root, "foundry.toml"), '[profile.default]\nsolcVersion = "./tools/solc"\n')
    expect(validateFoundryCompilerConfig(root).ok).toBe(false)

    writeFileSync(join(root, "foundry.toml"), '[profile.default]\nextends = "unsafe.toml"\n')
    expect(validateFoundryCompilerConfig(root).ok).toBe(false)

    writeFileSync(join(root, "foundry.toml"), "[profile.default]\n")
    writeFileSync(join(root, ".env"), "FOUNDRY_CONFIG=unsafe.toml\n")
    expect(validateFoundryCompilerConfig(root).ok).toBe(false)
  })

  it("rejects project-selected Vyper executables", () => {
    const { root } = foundryProject()
    writeFileSync(join(root, "foundry.toml"), '[profile.default.vyper]\npath = "./tools/vyper"\n')

    expect(validateFoundryCompilerConfig(root).ok).toBe(false)
  })

  it("rejects compiler control files that resolve outside the Foundry root", () => {
    const { root } = foundryProject()
    const outside = mkdtempSync(join(tmpdir(), "argus-slither-config-outside-"))
    tempDirs.push(outside)
    const outsideEnv = join(outside, ".env")
    writeFileSync(outsideEnv, "FOUNDRY_SOLC_VERSION=outside-secret-value\n")
    symlinkSync(outsideEnv, join(root, ".env"))

    const result = validateFoundryCompilerConfig(root)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).not.toContain("outside-secret-value")
  })

  it("rejects source symlinks that escape the active project", () => {
    const { root, sourceDir } = foundryProject()
    const outside = mkdtempSync(join(tmpdir(), "argus-slither-source-outside-"))
    tempDirs.push(outside)
    const outsideFile = join(outside, "Outside.sol")
    writeFileSync(outsideFile, "contract Outside {}")
    symlinkSync(outsideFile, join(sourceDir, "Linked.sol"))

    expect(validateFoundrySourceClosure(root, root).ok).toBe(false)
  })

  it("rejects library and configured profile roots that escape the active project", () => {
    const { root } = foundryProject()
    const outside = mkdtempSync(join(tmpdir(), "argus-slither-library-outside-"))
    tempDirs.push(outside)
    const outsideFile = join(outside, "Outside.sol")
    writeFileSync(outsideFile, "contract Outside {}")

    const libraryDir = join(root, "vendor")
    mkdirSync(libraryDir)
    symlinkSync(outsideFile, join(libraryDir, "Linked.sol"))
    writeFileSync(
      join(root, "foundry.toml"),
      '[profile.default]\nlibs = ["vendor"]\n[profile.ci]\nsrc = "contracts"\n',
    )

    expect(validateFoundrySourceClosure(root, root).ok).toBe(false)
  })

  it("rejects remappings.txt targets outside the active project", () => {
    const { root } = foundryProject()
    const outside = mkdtempSync(join(tmpdir(), "argus-slither-remapping-outside-"))
    tempDirs.push(outside)
    writeFileSync(join(root, "remappings.txt"), `outside/=${outside}/\n`)

    expect(validateFoundrySourceClosure(root, root).ok).toBe(false)
  })
})
