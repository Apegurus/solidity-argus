import { expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { executeGasAnalysis, gasAnalysisTool } from "./gas-analysis-tool"

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

const SAMPLE_GAS_REPORT = `
╭─────────────────────────────────────────┬─────────────────┬────────┬────────┬────────┬─────────╮
│ src/Vault.sol:Vault contract            ┆                 ┆        ┆        ┆        ┆         │
╞═════════════════════════════════════════╪═════════════════╪════════╪════════╪════════╪═════════╡
│ Deployment Cost                         ┆ Deployment Size ┆        ┆        ┆        ┆         │
├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌╌┤
│ 428939                                  ┆ 2382            ┆        ┆        ┆        ┆         │
├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌╌┤
│ Function Name                           ┆ min             ┆ avg    ┆ median ┆ max    ┆ # calls │
├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌╌┤
│ deposit                                 ┆ 46292           ┆ 46292  ┆ 46292  ┆ 46292  ┆ 1       │
├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌╌┤
│ withdraw                                ┆ 28410           ┆ 128410 ┆ 128410 ┆ 228410 ┆ 3       │
╰─────────────────────────────────────────┴─────────────────┴────────┴────────┴────────┴─────────╯
`

test("gas-analysis tool uses tool() helper contract", () => {
  expect(gasAnalysisTool.description.length).toBeGreaterThan(0)
  expect(gasAnalysisTool.args).toBeDefined()
  expect(typeof gasAnalysisTool.execute).toBe("function")
})

test("gas-analysis parses forge gas report into structured result", async () => {
  const { context, metadataCalls } = createContext()

  const result = await executeGasAnalysis(
    { target: "." },
    context,
    async (command: string[], signal: AbortSignal, cwd: string) => {
      expect(command).toEqual(["forge", "test", "--gas-report"])
      expect(signal).toBe(context.abort)
      expect(cwd).toBe(".")
      return { stdout: SAMPLE_GAS_REPORT, stderr: "", exitCode: 0 }
    },
  )

  expect(result.success).toBe(true)
  expect(result.contracts).toEqual([
    {
      name: "src/Vault.sol:Vault",
      deploymentCost: 428939,
      deploymentSize: 2382,
      functions: [
        { name: "deposit", min: 46292, avg: 46292, median: 46292, max: 46292, calls: 1 },
        { name: "withdraw", min: 28410, avg: 128410, median: 128410, max: 228410, calls: 3 },
      ],
    },
  ])
  expect(result.hotspots).toEqual([
    {
      contract: "src/Vault.sol:Vault",
      function: "withdraw",
      avgGas: 128410,
    },
  ])
  expect(metadataCalls[0]?.title).toContain("gas report")
})

test("gas-analysis identifies high-gas hotspots above threshold", async () => {
  const { context } = createContext()

  const result = await executeGasAnalysis({ target: ".", threshold: 40000 }, context, async () => {
    return { stdout: SAMPLE_GAS_REPORT, stderr: "", exitCode: 0 }
  })

  expect(result.hotspots).toEqual([
    { contract: "src/Vault.sol:Vault", function: "withdraw", avgGas: 128410 },
    { contract: "src/Vault.sol:Vault", function: "deposit", avgGas: 46292 },
  ])
})

test("gas-analysis handles empty gas report", async () => {
  const { context } = createContext()

  const result = await executeGasAnalysis({ target: "." }, context, async () => {
    return { stdout: "No tests found in project", stderr: "", exitCode: 0 }
  })

  expect(result.success).toBe(true)
  expect(result.contracts).toEqual([])
  expect(result.hotspots).toEqual([])
})

test("gas-analysis handles missing forge binary", async () => {
  const { context } = createContext()

  const result = await executeGasAnalysis({ target: "." }, context, async () => {
    const error = new Error("forge not found") as Error & { code?: string }
    error.code = "ENOENT"
    throw error
  })

  expect(result.success).toBe(false)
  expect(result.error).toBe(
    "Foundry not found. Install: curl -L https://foundry.paradigm.xyz | bash",
  )
})

test("gas-analysis handles AbortSignal cancellation", async () => {
  const { context } = createContext()

  const result = await executeGasAnalysis({ target: "." }, context, async () => {
    throw new DOMException("Aborted", "AbortError")
  })

  expect(result.success).toBe(false)
  expect(result.error).toBe("forge gas analysis aborted")
})

test("gas-analysis resolves cwd from context when target is omitted", async () => {
  const { context } = createContext({
    directory: "/tmp/from-directory",
    worktree: "/tmp/from-worktree",
  })

  await executeGasAnalysis(
    {},
    context,
    async (_command: string[], _signal: AbortSignal, cwd: string) => {
      expect(cwd).toBe("/tmp/from-directory")
      return { stdout: "", stderr: "", exitCode: 0 }
    },
  )
})
