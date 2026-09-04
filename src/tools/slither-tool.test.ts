import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import {
  defaultSpawnFn,
  detectViaIr,
  executeSlitherAnalyze,
  type FlattenFallbackDeps,
  flattenFallback,
  type SlitherRunResult,
  slitherTool,
} from "./slither-tool"

test("defaultSpawnFn drains stderr without deadlocking and returns stdout (adj_3 / Oracle blocker)", async () => {
  const result = await defaultSpawnFn(["sh", "-c", "yes x | head -c 200000 >&2; printf done"])
  expect(result.stdout).toBe("done")
  expect(result.exitCode).toBe(0)
})

function createContext(overrides?: Partial<ToolContext>): {
  context: ToolContext
  metadataCalls: Array<{ title?: string }>
} {
  const metadataCalls: Array<{ title?: string }> = []
  const abortController = new AbortController()

  const context: ToolContext = {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "argus",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: abortController.signal,
    metadata(input) {
      metadataCalls.push({ title: input.title })
    },
    async ask() {
      return
    },
    ...overrides,
  }

  return { context, metadataCalls }
}

test("slitherTool uses tool() helper contract", () => {
  expect(slitherTool.description.length).toBeGreaterThan(0)
  expect(slitherTool.args).toBeDefined()
  expect(typeof slitherTool.execute).toBe("function")
})

test("executeSlitherAnalyze parses detector JSON and maps findings", async () => {
  const slitherJSON = JSON.stringify({
    success: true,
    error: null,
    results: {
      detectors: [
        {
          check: "reentrancy-eth",
          impact: "High",
          confidence: "Medium",
          description: "Reentrancy vulnerability",
          elements: [
            {
              source_mapping: {
                filename_relative: "src/Vault.sol",
                lines: [10, 15],
              },
            },
          ],
        },
      ],
    },
  })
  const { context, metadataCalls } = createContext()

  const result = await executeSlitherAnalyze(
    { target: "." },
    context,
    async (_command, _signal, _cwd) => ({
      stdout: slitherJSON,
      stderr: "",
      exitCode: 0,
    }),
  )

  expect(result.success).toBe(true)
  expect(result.findingsCount).toBe(1)
  expect(result.findings[0]?.check).toBe("reentrancy-eth")
  expect(result.findings[0]?.severity).toBe("High")
  expect(result.findings[0]?.confidence).toBe("Medium")
  expect(result.findings[0]?.file).toBe("src/Vault.sol")
  expect(result.findings[0]?.lines).toEqual([10, 15])
  expect(result.findings[0]?.source).toBe("slither")
  expect(result.findings[0]?.id.length).toBeGreaterThan(0)
  expect(metadataCalls.length).toBe(1)
  expect(metadataCalls[0]?.title).toContain("Slither")
})

test("executeSlitherAnalyze handles ENOENT when slither is missing", async () => {
  const { context } = createContext()

  const result = await executeSlitherAnalyze(
    { target: "." },
    context,
    async (_command, _signal, _cwd) => {
      const error = new Error("slither not found") as Error & { code?: string }
      error.code = "ENOENT"
      throw error
    },
  )

  expect(result.success).toBe(false)
  expect(result.error).toBe("Slither not found. Install with: pip install slither-analyzer")
  expect(result.hint).toBeUndefined()
})

test("executeSlitherAnalyze returns mixed-pragma narrowing hint with safe src suggestion", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "argus-slither-mixed-"))
  try {
    mkdirSync(join(tempDir, "src"), { recursive: true })
    writeFileSync(join(tempDir, "src", "Vault.sol"), "pragma solidity ^0.8.20; contract Vault {}")
    const { context } = createContext({ directory: tempDir, worktree: tempDir })
    const stderr =
      "CryticCompileError: Source file requires different compiler version; found pragmas 0.5.17 and 0.8.20"

    const result = await executeSlitherAnalyze(
      { target: tempDir },
      context,
      async () => ({ stdout: "not-json", stderr, exitCode: 1 }),
      tempDir,
    )

    expect(result.success).toBe(false)
    expect(result.hint).toContain("Try narrowing target to a single-pragma subdirectory")
    expect(result.hint).toContain("foundry.toml/remappings")
    expect(result.suggested_command).toContain(
      `slither ${join(tempDir, "src")} --json - --filter-paths node_modules --config-file`,
    )
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("executeSlitherAnalyze omits mixed-pragma suggested command when no safe src target exists", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "argus-slither-no-src-"))
  try {
    const { context } = createContext({ directory: tempDir, worktree: tempDir })
    const stderr = "Slither exited with code 1: solc pragma requires different compiler version"

    const result = await executeSlitherAnalyze(
      { target: tempDir },
      context,
      async () => ({ stdout: "not-json", stderr, exitCode: 1 }),
      tempDir,
    )

    expect(result.success).toBe(false)
    expect(result.hint).toContain("Try narrowing target to a single-pragma subdirectory")
    expect(result.suggested_command).toBeUndefined()
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("executeSlitherAnalyze parses partial findings from non-zero exit JSON", async () => {
  const slitherJSON = JSON.stringify({
    success: false,
    error: "Compilation failed",
    results: {
      detectors: [
        {
          check: "unchecked-transfer",
          impact: "Low",
          confidence: "High",
          description: "Return value not checked",
          elements: [
            {
              source_mapping: {
                filename_relative: "src/Token.sol",
                lines: [22],
              },
            },
          ],
        },
      ],
    },
  })
  const { context } = createContext()

  const result = await executeSlitherAnalyze(
    { target: "." },
    context,
    async (_command, _signal, _cwd) => ({
      stdout: slitherJSON,
      stderr: "stderr compile warning",
      exitCode: 1,
    }),
  )

  expect(result.success).toBe(true)
  expect(result.findingsCount).toBe(1)
  expect(result.findings[0]?.severity).toBe("Low")
  expect(result.findings[0]?.lines).toEqual([22, 22])
  expect(result.errors.length).toBe(3)
  expect(result.errors.some((item) => item.includes("code 1"))).toBe(true)
  expect(result.errors.some((item) => item.includes("Compilation failed"))).toBe(true)
  expect(result.errors.some((item) => item.includes("stderr compile warning"))).toBe(true)
})

test("executeSlitherAnalyze returns parse error for non-JSON output", async () => {
  const { context } = createContext()

  const result = await executeSlitherAnalyze(
    { target: "." },
    context,
    async (_command, _signal, _cwd) => ({
      stdout: "plain text error output",
      stderr: "",
      exitCode: 2,
    }),
  )

  expect(result.success).toBe(false)
  expect(result.error).toContain("Slither output parse error:")
})

test("executeSlitherAnalyze forwards optional CLI flags and abort signal", async () => {
  const calls: SlitherRunResult[] = []
  const tempDir = mkdtempSync(join(tmpdir(), "argus-slither-flags-"))
  const { context } = createContext({ directory: tempDir, worktree: tempDir })

  try {
    const result = await executeSlitherAnalyze(
      {
        target: "contracts",
        detectors: ["reentrancy-eth", "unchecked-transfer"],
        exclude: ["unused-state"],
        solc_version: "0.8.24",
      },
      context,
      async (command, signal, _cwd) => {
        expect(command).toContain("--config-file")
        expect(command).toContain("reentrancy-eth,unchecked-transfer")
        expect(command).toContain("unused-state")
        expect(command).toContain("solc:0.8.24")
        expect(signal).toBe(context.abort)
        const response: SlitherRunResult = {
          stdout: '{"success":true,"results":{"detectors":[]}}',
          stderr: "",
          exitCode: 0,
        }
        calls.push(response)
        return response
      },
      tempDir,
    )

    expect(calls.length).toBe(1)
    expect(result.success).toBe(true)
    expect(result.findingsCount).toBe(0)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("executeSlitherAnalyze attempts direct slither before flatten fallback when via_ir is requested", async () => {
  const commands: string[][] = []
  const { context } = createContext()

  const result = await executeSlitherAnalyze(
    { target: "src/WAlpha.sol", via_ir: true },
    context,
    async (command, _signal, _cwd) => {
      commands.push(command)
      return {
        stdout: JSON.stringify({ success: true, results: { detectors: [] } }),
        stderr: "",
        exitCode: 0,
      }
    },
  )

  expect(result.success).toBe(true)
  expect(commands).toHaveLength(1)
  expect(commands[0]).toContain("--config-file")
  expect(commands[0]).toContain("--compile-force-framework")
})

test("detectViaIr does not read a foundry.toml symlink outside the project", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "argus-via-ir-symlink-"))
  const outsideDir = mkdtempSync(join(tmpdir(), "argus-via-ir-outside-"))
  writeFileSync(join(outsideDir, "foundry.toml"), "[profile.default]\nvia_ir = true\n")
  symlinkSync(join(outsideDir, "foundry.toml"), join(projectDir, "foundry.toml"))

  try {
    expect(detectViaIr(projectDir, projectDir)).toBe(false)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(outsideDir, { recursive: true, force: true })
  }
})

test("executeSlitherAnalyze compiles the Foundry root and reports only the requested contract", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "argus-slither-scope-"))
  const sourceDir = join(projectDir, "src")
  const libraryDir = join(projectDir, "lib")
  const target = join(sourceDir, "Vault.sol")
  mkdirSync(sourceDir, { recursive: true })
  mkdirSync(libraryDir, { recursive: true })
  writeFileSync(join(projectDir, "foundry.toml"), "[profile.default]\nvia_ir = true\n")
  writeFileSync(target, "contract Vault {}")

  const payload = JSON.stringify({
    success: true,
    results: {
      detectors: [
        {
          check: "reentrancy-eth",
          impact: "High",
          confidence: "High",
          description: "In-scope finding",
          elements: [{ source_mapping: { filename_relative: "src/Vault.sol", lines: [5] } }],
        },
        {
          check: "incorrect-shift",
          impact: "High",
          confidence: "Medium",
          description: "Dependency finding",
          elements: [{ source_mapping: { filename_relative: "lib/Math.sol", lines: [9] } }],
        },
      ],
    },
  })
  const { context } = createContext({ directory: projectDir, worktree: projectDir })
  let capturedCommand: string[] = []
  let capturedCwd = ""

  try {
    const result = await executeSlitherAnalyze(
      { target, via_ir: true },
      context,
      async (command, _signal, cwd) => {
        capturedCommand = command
        capturedCwd = cwd
        return { stdout: payload, stderr: "", exitCode: 0 }
      },
      projectDir,
    )

    expect(capturedCommand.at(1)).toBe(projectDir)
    expect(capturedCommand).toContain("--filter-paths")
    expect(capturedCommand).toContain("--config-file")
    expect(capturedCommand.at(capturedCommand.indexOf("--config-file") + 1)).toEndWith(
      "trusted-slither.config.json",
    )
    expect(capturedCommand).toContain("--compile-force-framework")
    expect(capturedCwd).toBe(projectDir)
    expect(result.findings.map((finding) => finding.file)).toEqual(["src/Vault.sol"])
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test("executeSlitherAnalyze preserves project-root reporting scope", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "argus-slither-root-scope-"))
  const sourceDir = join(projectDir, "src")
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(join(projectDir, "foundry.toml"), "[profile.default]\n")
  writeFileSync(join(sourceDir, "Vault.sol"), "contract Vault {}")
  const payload = JSON.stringify({
    success: true,
    results: {
      detectors: [
        {
          check: "reentrancy-eth",
          impact: "High",
          confidence: "High",
          description: "Source finding",
          elements: [{ source_mapping: { filename_relative: "src/Vault.sol", lines: [5] } }],
        },
        {
          check: "incorrect-shift",
          impact: "High",
          confidence: "Medium",
          description: "Dependency finding",
          elements: [{ source_mapping: { filename_relative: "lib/Math.sol", lines: [9] } }],
        },
      ],
    },
  })
  const { context } = createContext({ directory: projectDir, worktree: projectDir })

  try {
    const result = await executeSlitherAnalyze(
      { target: projectDir },
      context,
      async () => ({ stdout: payload, stderr: "", exitCode: 0 }),
      projectDir,
    )

    expect(result.findings.map((finding) => finding.file)).toEqual([
      "src/Vault.sol",
      "lib/Math.sol",
    ])
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test("executeSlitherAnalyze returns stderr when direct slither fails without fallback", async () => {
  const { context } = createContext()

  const result = await executeSlitherAnalyze({ target: "src/WAlpha.sol" }, context, async () => ({
    stdout: "not-json",
    stderr: "syntax error near unexpected token",
    exitCode: 1,
  }))

  expect(result.success).toBe(false)
  expect(result.errors).toContain("Slither exited with code 1")
  expect(result.errors).toContain("syntax error near unexpected token")
  expect(result.error).toContain("Slither output parse error")
})

test("executeSlitherAnalyze rejects a path-valued Foundry compiler before spawning", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "argus-unsafe-solc-"))
  const sourceDir = join(projectDir, "src")
  const target = join(sourceDir, "Vault.sol")
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(join(projectDir, "foundry.toml"), '[profile.default]\nsolc = "./tools/solc"\n')
  writeFileSync(target, "contract Vault {}")
  const { context } = createContext({ directory: projectDir, worktree: projectDir })
  let spawned = false

  try {
    const result = await executeSlitherAnalyze(
      { target },
      context,
      async () => {
        spawned = true
        return { stdout: "", stderr: "", exitCode: 0 }
      },
      projectDir,
    )

    expect(spawned).toBe(false)
    expect(result.failureCode).toBe("SLITHER_UNSAFE_FOUNDRY_CONFIG")
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

function createFlattenDeps(overrides: Partial<FlattenFallbackDeps> = {}): FlattenFallbackDeps {
  return {
    runCommand: async (_command, _signal, _cwd) => ({
      stdout: '{"success":true,"results":{"detectors":[]}}',
      stderr: "",
      exitCode: 0,
    }),
    hasBinary: () => true,
    ensureSolc: async () => true,
    parseSolcVersion: () => "0.8.20",
    spawnFn: async () => ({ stdout: "", exitCode: 0 }),
    cwd: "/tmp/project",
    projectDir: "/tmp/project",
    ...overrides,
  }
}

test("flattenFallback returns structured error when forge is missing", async () => {
  const { context } = createContext()
  const deps = createFlattenDeps({ hasBinary: (name) => name !== "forge" })

  const result = await flattenFallback({ target: "/tmp/project" }, context, deps)
  expect(result).toBeDefined()
  expect(result?.success).toBe(false)
  expect(result?.error).toContain("forge binary not found")
})

test("flattenFallback returns structured error when no solc version found", async () => {
  const { context } = createContext()
  const deps = createFlattenDeps({ parseSolcVersion: () => undefined })

  const result = await flattenFallback({ target: "/tmp/project" }, context, deps)
  expect(result).toBeDefined()
  expect(result?.success).toBe(false)
  expect(result?.error).toContain("Could not determine solc version")
})

test("flattenFallback returns error when solc unavailable and solc-select missing", async () => {
  const { context } = createContext()
  const deps = createFlattenDeps({ ensureSolc: async () => false })

  const result = await flattenFallback({ target: "/tmp/project" }, context, deps)
  expect(result).toBeDefined()
  expect(result?.success).toBe(false)
  expect(result?.error).toContain("Flatten fallback requires solc on PATH")
  expect(result?.error).toContain("solc-select install 0.8.20")
})

test("flattenFallback fails when child Slither exits nonzero", async () => {
  const { context } = createContext()
  const tmpFile = join(tmpdir(), `argus-failed-fallback-${Date.now()}.sol`)
  writeFileSync(tmpFile, "pragma solidity ^0.8.20; contract Vault {}")
  const deps = createFlattenDeps({
    projectDir: tmpdir(),
    runCommand: async () => ({ stdout: "", stderr: "compile failed", exitCode: 1 }),
    spawnFn: async () => ({ stdout: "// flattened", exitCode: 0 }),
  })

  try {
    const result = await flattenFallback({ target: tmpFile }, context, deps)
    expect(result?.success).toBe(false)
    expect(result?.failureCode).toBe("SLITHER_EXECUTION_FAILED")
    expect(result?.errors.join(" ")).toContain("compile failed")
  } finally {
    rmSync(tmpFile, { force: true })
  }
})

test("flattenFallback processes flattened files and returns findings", async () => {
  const { context } = createContext()
  const canonicalTmpDir = realpathSync(tmpdir())
  const tmpFile = join(canonicalTmpDir, `argus-test-${Date.now()}.sol`)
  writeFileSync(
    tmpFile,
    "pragma solidity ^0.8.20;\ncontract Vault { function withdraw() external {} }",
  )

  const slitherJSON = JSON.stringify({
    success: true,
    results: {
      detectors: [
        {
          check: "reentrancy-eth",
          impact: "High",
          confidence: "High",
          description: "Reentrancy in Vault.withdraw()",
          elements: [{ source_mapping: { filename_relative: "Vault.flat.sol", lines: [10, 20] } }],
        },
        {
          check: "reentrancy-eth",
          impact: "High",
          confidence: "High",
          description: "Second reentrancy in Vault.deposit()",
          elements: [{ source_mapping: { filename_relative: "Vault.flat.sol", lines: [30, 35] } }],
        },
      ],
    },
  })

  const deps = createFlattenDeps({
    projectDir: canonicalTmpDir,
    runCommand: async (_command, _signal, _cwd) => ({
      stdout: slitherJSON,
      stderr: "",
      exitCode: 0,
    }),
    spawnFn: async (command) => {
      if (command[0] === "forge" && command[1] === "flatten")
        return { stdout: "// flattened content", exitCode: 0 }
      return { stdout: "", exitCode: 0 }
    },
  })

  try {
    const result = await flattenFallback({ target: tmpFile }, context, deps)
    expect(result).toBeDefined()
    expect(result?.success).toBe(true)
    expect(result?.findingsCount).toBe(2)
    expect(result?.findings.at(0)?.check).toBe("reentrancy-eth")
    expect(result?.findings.at(0)?.file).toBe(tmpFile.split("/").at(-1))
    expect(result?.findings.at(0)?.lines).toEqual([1, 1])
    expect(result?.findings.at(0)?.confidence).toBe("Low")
    expect(result?.findings.at(0)?.description).toContain("flattened source lines 10-20")
    expect(result?.findings.at(1)?.description).toContain("flattened source lines 30-35")
    expect(result?.findings.at(0)?.source_location_id).not.toBe(
      result?.findings.at(1)?.source_location_id,
    )
    expect(result?.errors.at(0)).toContain("[flatten-fallback]")
  } finally {
    rmSync(tmpFile, { force: true })
  }
})

test("flattenFallback scans a requested source directory from the Foundry root", async () => {
  const { context } = createContext()
  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), "argus-flatten-source-")))
  const sourceDir = join(projectDir, "src")
  const sourceFile = join(sourceDir, "Vault.sol")
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(sourceFile, "pragma solidity ^0.8.20; contract Vault {}")
  const calls: Array<{ command: string[]; cwd?: string }> = []
  const deps = createFlattenDeps({
    cwd: projectDir,
    projectDir,
    spawnFn: async (command, options) => {
      calls.push({ command, cwd: options?.cwd })
      return { stdout: "// flattened", exitCode: 0 }
    },
  })

  try {
    const result = await flattenFallback({ target: sourceDir }, context, deps)

    expect(result?.success).toBe(true)
    expect(calls.at(0)?.command.at(-1)).toBe(sourceFile)
    expect(calls.find((call) => call.command[0] === "forge")?.cwd).toBe(projectDir)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test("flattenFallback rejects discovered source symlinks outside the active project", async () => {
  const { context } = createContext()
  const projectDir = mkdtempSync(join(tmpdir(), "argus-flatten-symlink-"))
  const outsideDir = mkdtempSync(join(tmpdir(), "argus-flatten-outside-"))
  const sourceDir = join(projectDir, "src")
  const outsideFile = join(outsideDir, "Outside.sol")
  const linkedFile = join(sourceDir, "Linked.sol")
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(outsideFile, "contract Outside {}")
  symlinkSync(outsideFile, linkedFile)
  let forgeCalled = false
  const deps = createFlattenDeps({
    cwd: projectDir,
    projectDir,
    spawnFn: async () => {
      forgeCalled = true
      return { stdout: "// flattened", exitCode: 0 }
    },
  })

  try {
    const result = await flattenFallback({ target: sourceDir }, context, deps)

    expect(forgeCalled).toBe(false)
    expect(result?.success).toBe(false)
    expect(result?.errors.join(" ")).toContain("outside the active project")
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(outsideDir, { recursive: true, force: true })
  }
})

test("flattenFallback retains file-level findings without a contract name", async () => {
  const { context } = createContext()
  const tmpFile = join(tmpdir(), `argus-filter-test-${Date.now()}.sol`)
  writeFileSync(
    tmpFile,
    "pragma solidity ^0.8.20;\ncontract Vault { function deposit() external {} }",
  )

  const slitherJSON = JSON.stringify({
    success: true,
    results: {
      detectors: [
        {
          check: "reentrancy-eth",
          impact: "High",
          confidence: "High",
          description: "Reentrancy in Vault.withdraw()",
          elements: [{ source_mapping: { filename_relative: "Vault.flat.sol", lines: [10] } }],
        },
        {
          check: "naming-convention",
          impact: "Informational",
          confidence: "High",
          description: "OpenZeppelin ERC20._approve() naming issue",
          elements: [{ source_mapping: { filename_relative: "lib/ERC20.sol", lines: [50] } }],
        },
      ],
    },
  })

  const deps = createFlattenDeps({
    projectDir: tmpdir(),
    runCommand: async (_command, _signal, _cwd) => ({
      stdout: slitherJSON,
      stderr: "",
      exitCode: 0,
    }),
    spawnFn: async (command) => {
      if (command[0] === "forge" && command[1] === "flatten")
        return { stdout: "// flattened", exitCode: 0 }
      return { stdout: "", exitCode: 0 }
    },
  })

  try {
    const result = await flattenFallback({ target: tmpFile }, context, deps)
    expect(result).toBeDefined()
    expect(result?.findingsCount).toBe(2)
    expect(result?.findings.at(1)?.check).toBe("naming-convention")
  } finally {
    rmSync(tmpFile, { force: true })
  }
})

test("flattenFallback scans the exact requested root instead of narrowing to src", async () => {
  const { context } = createContext()
  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), "argus-flatten-root-")))
  const sourceDir = join(projectDir, "src")
  mkdirSync(sourceDir)
  writeFileSync(join(sourceDir, "Vault.sol"), "contract Vault {}")
  let flattenedTarget = ""
  const deps = createFlattenDeps({
    cwd: projectDir,
    projectDir,
    spawnFn: async (command) => {
      flattenedTarget = command.at(-1) ?? ""
      return { stdout: "// flattened", exitCode: 0 }
    },
  })

  try {
    await flattenFallback({ target: projectDir }, context, deps)
    expect(flattenedTarget).toBe(join(sourceDir, "Vault.sol"))
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test("flattenFallback forwards detector selection and exclusions", async () => {
  const { context } = createContext()
  const tmpFile = join(tmpdir(), `argus-fallback-options-${Date.now()}.sol`)
  writeFileSync(tmpFile, "pragma solidity ^0.8.20; contract Vault {}")
  let slitherCommand: string[] = []
  const deps = createFlattenDeps({
    projectDir: tmpdir(),
    runCommand: async (command) => {
      slitherCommand = command
      return { stdout: '{"success":true,"results":{"detectors":[]}}', stderr: "", exitCode: 0 }
    },
    spawnFn: async () => ({ stdout: "// flattened", exitCode: 0 }),
  })

  try {
    await flattenFallback(
      { target: tmpFile, detectors: ["reentrancy-eth"], exclude: ["naming-convention"] },
      context,
      deps,
    )
    expect(slitherCommand).toContain("reentrancy-eth")
    expect(slitherCommand).toContain("naming-convention")
  } finally {
    rmSync(tmpFile, { force: true })
  }
})

test("flattenFallback discovers contracts nested deeper than three directories", async () => {
  const { context } = createContext()
  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), "argus-fallback-deep-")))
  const deepDir = join(projectDir, "src", "one", "two", "three", "four")
  const sourceFile = join(deepDir, "Vault.sol")
  mkdirSync(deepDir, { recursive: true })
  writeFileSync(sourceFile, "pragma solidity ^0.8.20; contract Vault {}")
  let flattened = false
  const deps = createFlattenDeps({
    cwd: projectDir,
    projectDir,
    spawnFn: async (command) => {
      flattened = command.at(-1) === sourceFile
      return { stdout: "// flattened", exitCode: 0 }
    },
  })

  try {
    const result = await flattenFallback({ target: projectDir }, context, deps)
    expect(result.success).toBe(true)
    expect(flattened).toBe(true)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test("executeSlitherAnalyze triggers flatten fallback on parse error with crytic_compile stderr", async () => {
  const { context } = createContext()
  let callCount = 0
  const target = `/tmp/argus-slither-fallback-${Date.now()}`
  const slitherJSON = JSON.stringify({
    success: true,
    results: {
      detectors: [
        {
          check: "unchecked-transfer",
          impact: "Medium",
          confidence: "High",
          description: "Unchecked return in Vault.deposit()",
          elements: [{ source_mapping: { filename_relative: "Vault.flat.sol", lines: [5] } }],
        },
      ],
    },
  })

  const result = await executeSlitherAnalyze(
    { target },
    context,
    async (_command, _signal, _cwd) => {
      callCount++
      if (callCount === 1) {
        return {
          stdout: "not json",
          stderr: "crytic_compile error: Contract not found",
          exitCode: 1,
        }
      }
      return { stdout: slitherJSON, stderr: "", exitCode: 0 }
    },
  )

  expect(result.success).toBe(false)
  expect(result.errors.join(" ")).toContain("flatten fallback")
})

test("executeSlitherAnalyze does NOT trigger fallback when primary succeeds with findings", async () => {
  const { context } = createContext()
  const slitherJSON = JSON.stringify({
    success: true,
    results: {
      detectors: [
        {
          check: "reentrancy-eth",
          impact: "High",
          confidence: "High",
          description: "Reentrancy vulnerability",
          elements: [{ source_mapping: { filename_relative: "src/Vault.sol", lines: [10, 15] } }],
        },
      ],
    },
  })

  const result = await executeSlitherAnalyze(
    { target: "." },
    context,
    async (_command, _signal, _cwd) => ({ stdout: slitherJSON, stderr: "", exitCode: 0 }),
  )

  expect(result.success).toBe(true)
  expect(result.findingsCount).toBe(1)
  expect(result.findings[0]?.check).toBe("reentrancy-eth")
})

test("executeSlitherAnalyze reports capability loss without flattening when direct via_ir analysis fails", async () => {
  const { context } = createContext()
  const commands: string[][] = []

  const result = await executeSlitherAnalyze(
    { target: "/tmp/project", via_ir: true },
    context,
    async (command, _signal, _cwd) => {
      commands.push(command)
      return { stdout: "not-json", stderr: "YulException", exitCode: 1 }
    },
  )

  expect(commands).toHaveLength(1)
  expect(commands[0]).toContain("--compile-force-framework")
  expect(result.success).toBe(false)
  expect(result.error).toContain("SLITHER_VIA_IR_ANALYSIS_FAILED")
})

test("executeSlitherAnalyze runs primary when via_ir is false", async () => {
  const { context } = createContext()
  const slitherJSON = JSON.stringify({
    success: true,
    results: { detectors: [] },
  })

  const result = await executeSlitherAnalyze(
    { target: "/tmp/project", via_ir: false },
    context,
    async (_command, _signal, _cwd) => ({ stdout: slitherJSON, stderr: "", exitCode: 0 }),
  )

  expect(result.success).toBe(true)
})

test("detectViaIr returns true for foundry.toml with via_ir = true", () => {
  const tmpDir = join(tmpdir(), `argus-via-ir-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
  writeFileSync(join(tmpDir, "foundry.toml"), `[profile.default]\nvia_ir = true\nsolc = "0.8.20"\n`)

  try {
    expect(detectViaIr(tmpDir)).toBe(true)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test("detectViaIr returns false when no foundry.toml exists", () => {
  expect(detectViaIr(`/tmp/nonexistent-dir-${Date.now()}`)).toBe(false)
})

test("detectViaIr does not inspect Foundry configuration above the active project", () => {
  const parent = mkdtempSync(join(tmpdir(), "argus-via-ir-parent-"))
  const projectDir = join(parent, "workspace")
  const sourceDir = join(projectDir, "src")
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(join(parent, "foundry.toml"), "[profile.default]\nvia_ir = true\n")
  const target = join(sourceDir, "Vault.sol")
  writeFileSync(target, "contract Vault {}")

  try {
    expect(detectViaIr(target, projectDir)).toBe(false)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test("detectViaIr returns false for foundry.toml without via_ir", () => {
  const tmpDir = join(tmpdir(), `argus-via-ir-no-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
  writeFileSync(join(tmpDir, "foundry.toml"), `[profile.default]\nsolc = "0.8.20"\n`)

  try {
    expect(detectViaIr(tmpDir)).toBe(false)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test("detectViaIr detects via-ir (hyphenated) in foundry.toml", () => {
  const tmpDir = join(tmpdir(), `argus-via-ir-hyph-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
  writeFileSync(join(tmpDir, "foundry.toml"), `[profile.default]\nvia-ir = true\n`)

  try {
    expect(detectViaIr(tmpDir)).toBe(true)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test("detectViaIr walks up from subdirectory to find foundry.toml at project root", () => {
  const tmpDir = join(tmpdir(), `argus-via-ir-walk-${Date.now()}`)
  const subDir = join(tmpDir, "src", "contracts")
  mkdirSync(subDir, { recursive: true })
  writeFileSync(join(tmpDir, "foundry.toml"), `[profile.default]\nvia_ir = true\n`)

  try {
    expect(detectViaIr(subDir)).toBe(true)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test("slitherTool.execute resolves relative target against context.directory", async () => {
  const tmpDir = join(tmpdir(), `argus-resolve-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })

  const { context } = createContext({ directory: tmpDir })
  let capturedCommand: string[] | undefined

  // Patch executeSlitherAnalyze indirectly by calling slitherTool.execute
  // which resolves the target. We can verify by checking the result contains the resolved path.
  const result = await executeSlitherAnalyze(
    { target: join(tmpDir, "contracts") },
    context,
    async (command, _signal, _cwd) => {
      capturedCommand = command
      return { stdout: '{"success":true,"results":{"detectors":[]}}', stderr: "", exitCode: 0 }
    },
  )

  expect(capturedCommand).toBeDefined()
  expect(capturedCommand?.at(1)).toBe(join(tmpDir, "contracts"))
  expect(result.success).toBe(true)

  rmSync(tmpDir, { recursive: true, force: true })
})

test("manual via_ir: true override bypasses auto-detection", async () => {
  const { context } = createContext()
  let primaryRunCalled = false
  // Target has no foundry.toml, but via_ir is manually set to true
  const result = await executeSlitherAnalyze(
    { target: `/tmp/nonexistent-project-${Date.now()}`, via_ir: true },
    context,
    async (command, _signal, _cwd) => {
      // If primary slither run is called (not flatten), mark it
      if (!command.some((c) => c.includes(".flat.sol"))) {
        primaryRunCalled = true
      }
      return { stdout: "{}", stderr: "", exitCode: 1 }
    },
  )

  // Manual via_ir should still try direct Slither before any fallback.
  expect(primaryRunCalled).toBe(true)
  expect(result.success).toBe(false)
  expect(result.error).toBeDefined()
  expect(result.failureCode).toBe("SLITHER_PROJECT_COMPILATION_FAILED")
})

test("executeSlitherAnalyze passes cwd to runCommand", async () => {
  const { context } = createContext()
  let capturedCwd: string | undefined

  await executeSlitherAnalyze(
    { target: "." },
    context,
    async (_command, _signal, cwd) => {
      capturedCwd = cwd
      return { stdout: '{"success":true,"results":{"detectors":[]}}', stderr: "", exitCode: 0 }
    },
    "/custom/project/dir",
  )

  expect(capturedCwd).toBe("/custom/project/dir")
})

test("executeSlitherAnalyze rejects solcVersion with shell metacharacters", async () => {
  const { context } = createContext()
  let commandExecuted = false

  const result = await executeSlitherAnalyze(
    { target: ".", solc_version: "0.8.0; rm -rf /" },
    context,
    async (_command, _signal, _cwd) => {
      commandExecuted = true
      return { stdout: '{"success":true,"results":{"detectors":[]}}', stderr: "", exitCode: 0 }
    },
  )

  expect(commandExecuted).toBe(false)
  expect(result.success).toBe(false)
  expect(result.error).toContain("solc_version")
})
