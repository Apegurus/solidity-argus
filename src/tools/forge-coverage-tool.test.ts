import { expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { executeForgeCoverage, forgeCoverageTool } from "./forge-coverage-tool"

function createContext(overrides?: {
  directory?: string
  worktree?: string
  abort?: AbortSignal
}): { context: ToolContext; metadataCalls: Array<{ title?: string }> } {
  const metadataCalls: Array<{ title?: string }> = []
  const abortController = new AbortController()

  const context: ToolContext = {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "argus",
    directory: overrides?.directory ?? "/tmp/project",
    worktree: overrides?.worktree ?? "/tmp/project",
    abort: overrides?.abort ?? abortController.signal,
    metadata(input) {
      metadataCalls.push({ title: input.title })
    },
    async ask() {
      return
    },
  }

  return { context, metadataCalls }
}

test("forgeCoverageTool uses tool() helper contract", () => {
  expect(forgeCoverageTool.description.length).toBeGreaterThan(0)
  expect(forgeCoverageTool.args).toBeDefined()
  expect(typeof forgeCoverageTool.execute).toBe("function")
})

test("executeForgeCoverage parses forge coverage table output", async () => {
  const { context, metadataCalls } = createContext()
  const stdout = [
    "| File                      | % Lines         | % Statements    | % Branches      | % Funcs         |",
    "|---------------------------|-----------------|-----------------|-----------------|-----------------|",
    "| src/Vault.sol             | 80.00% (8/10)   | 75.00% (6/8)    | 50.00% (2/4)    | 100.00% (3/3)   |",
    "| src/Token.sol             | 100.00% (20/20) | 100.00% (15/15) | 90.00% (9/10)   | 100.00% (5/5)   |",
    "| Total                     | 87.50% (28/30)  | 85.71% (21/23)  | 71.43% (11/14)  | 100.00% (8/8)   |",
  ].join("\n")

  const result = await executeForgeCoverage(
    { target: "." },
    context,
    async (command: string[], options: { signal?: AbortSignal; cwd?: string }) => {
      expect(command).toEqual(["forge", "coverage", "--report", "summary"])
      expect(options.signal).toBe(context.abort)
      expect(options.cwd).toBe(".")
      return { stdout, stderr: "", exitCode: 0 }
    },
  )

  expect(result.success).toBe(true)
  expect(result.report.files).toEqual([
    {
      path: "src/Vault.sol",
      linesPct: 80,
      statementsPct: 75,
      branchesPct: 50,
      functionsPct: 100,
    },
    {
      path: "src/Token.sol",
      linesPct: 100,
      statementsPct: 100,
      branchesPct: 90,
      functionsPct: 100,
    },
  ])
  expect(result.report.summary).toEqual({
    totalLinesPct: 87.5,
    totalStatementsPct: 85.71,
    totalBranchesPct: 71.43,
    totalFunctionsPct: 100,
  })
  expect(metadataCalls[0]?.title).toContain("forge coverage")
  expect(result.executionTime).toBeGreaterThanOrEqual(0)
})

test("executeForgeCoverage forwards match_path and ir_minimum flags", async () => {
  const { context } = createContext()
  const stdout =
    "| File | % Lines | % Statements | % Branches | % Funcs |\n|---|---|---|---|---|\n| Total | 100.00% (1/1) | 100.00% (1/1) | 100.00% (1/1) | 100.00% (1/1) |"

  const result = await executeForgeCoverage(
    { target: ".", match_path: "test/WAlpha.t.sol", ir_minimum: true },
    context,
    async (command, options) => {
      expect(command).toEqual([
        "forge",
        "coverage",
        "--report",
        "summary",
        "--match-path",
        "test/WAlpha.t.sol",
        "--ir-minimum",
      ])
      expect(options.cwd).toBe(".")
      return { stdout, stderr: "", exitCode: 0 }
    },
  )

  expect(result.success).toBe(true)
})

test("executeForgeCoverage retries stack-too-deep failures with ir_minimum", async () => {
  const { context } = createContext()
  const commands: string[][] = []
  const stdout =
    "| File | % Lines | % Statements | % Branches | % Funcs |\n|---|---|---|---|---|\n| Total | 100.00% (1/1) | 100.00% (1/1) | 100.00% (1/1) | 100.00% (1/1) |"

  const result = await executeForgeCoverage({ target: "." }, context, async (command) => {
    commands.push(command)
    if (commands.length === 1) {
      return { stdout: "", stderr: "Compiler error: Stack too deep", exitCode: 1 }
    }
    return { stdout, stderr: "", exitCode: 0 }
  })

  expect(result.success).toBe(true)
  expect(commands).toEqual([
    ["forge", "coverage", "--report", "summary"],
    ["forge", "coverage", "--report", "summary", "--ir-minimum"],
  ])
})

test("executeForgeCoverage retries optimizer instrumentation failures with ir_minimum", async () => {
  const { context } = createContext()
  const commands: string[][] = []
  const stdout =
    "| File | % Lines | % Statements | % Branches | % Funcs |\n|---|---|---|---|---|\n| Total | 100.00% (1/1) | 100.00% (1/1) | 100.00% (1/1) | 100.00% (1/1) |"

  const result = await executeForgeCoverage({ target: "." }, context, async (command) => {
    commands.push(command)
    if (commands.length === 1) {
      return {
        stdout: "",
        stderr: "failed to parse foundry.toml: optimizerSteps unsupported during instrumentation",
        exitCode: 1,
      }
    }
    return { stdout, stderr: "", exitCode: 0 }
  })

  expect(result.success).toBe(true)
  expect(commands).toEqual([
    ["forge", "coverage", "--report", "summary"],
    ["forge", "coverage", "--report", "summary", "--ir-minimum"],
  ])
})

test("executeForgeCoverage handles missing forge binary gracefully", async () => {
  const { context } = createContext()

  const result = await executeForgeCoverage({ target: "." }, context, async () => {
    const error = new Error("forge not found") as Error & { code?: string }
    error.code = "ENOENT"
    throw error
  })

  expect(result.success).toBe(false)
  expect(result.error).toBe(
    "Foundry not found. Install: curl -L https://foundry.paradigm.xyz | bash",
  )
  expect(result.report.files).toEqual([])
})

test("executeForgeCoverage handles project with no tests gracefully", async () => {
  const { context } = createContext()
  const stdout = [
    "| File                      | % Lines         | % Statements    | % Branches      | % Funcs         |",
    "|---------------------------|-----------------|-----------------|-----------------|-----------------|",
    "| Total                     | 0.00% (0/0)     | 0.00% (0/0)     | 0.00% (0/0)     | 0.00% (0/0)     |",
  ].join("\n")

  const result = await executeForgeCoverage({ target: "." }, context, async () => ({
    stdout,
    stderr: "",
    exitCode: 0,
  }))

  expect(result.success).toBe(true)
  expect(result.report.files).toEqual([])
  expect(result.report.summary).toEqual({
    totalLinesPct: 0,
    totalStatementsPct: 0,
    totalBranchesPct: 0,
    totalFunctionsPct: 0,
  })
})

test("executeForgeCoverage handles AbortSignal cancellation", async () => {
  const abortController = new AbortController()
  abortController.abort()
  const { context } = createContext({ abort: abortController.signal })

  const result = await executeForgeCoverage({}, context, async () => {
    throw new DOMException("Aborted", "AbortError")
  })

  expect(result.success).toBe(false)
  expect(result.error).toBe("forge coverage aborted")
})

test("executeForgeCoverage returns hint for optimizerSteps coverage failure", async () => {
  const { context } = createContext()
  const stderr =
    "Error: failed to parse foundry.toml: optimizerSteps is not supported during coverage instrumentation"

  const result = await executeForgeCoverage(
    { target: "/tmp/project", match_path: "test/Vault.t.sol" },
    context,
    async () => ({ stdout: "", stderr, exitCode: 1 }),
  )

  expect(result.success).toBe(false)
  expect(result.error).toBe(stderr)
  expect(result.hint).toContain("Forge coverage failed for /tmp/project")
  expect(result.hint).toContain("optimizerSteps")
  expect(result.suggested_command).toBe(
    "forge coverage --report summary --match-path test/Vault.t.sol --ir-minimum",
  )
})

test("executeForgeCoverage preserves generic forge stderr without hint", async () => {
  const { context } = createContext()
  const stderr = "forge coverage aborted"

  const result = await executeForgeCoverage({ target: "/tmp/project" }, context, async () => ({
    stdout: "",
    stderr,
    exitCode: 1,
  }))

  expect(result.success).toBe(false)
  expect(result.error).toBe(stderr)
  expect(result.hint).toBeUndefined()
  expect(result.suggested_command).toBeUndefined()
})

test("executeForgeCoverage resolves cwd from context when target is omitted", async () => {
  const { context } = createContext({
    directory: "/tmp/from-directory",
    worktree: "/tmp/from-worktree",
  })

  await executeForgeCoverage(
    {},
    context,
    async (_command: string[], options: { signal?: AbortSignal; cwd?: string }) => {
      expect(options.cwd).toBe("/tmp/from-directory")
      return {
        stdout:
          "| File | % Lines | % Statements | % Branches | % Funcs |\n|---|---|---|---|---|\n| Total | 10.00% (1/10) | 20.00% (2/10) | 30.00% (3/10) | 40.00% (4/10) |",
        stderr: "",
        exitCode: 0,
      }
    },
  )
})
