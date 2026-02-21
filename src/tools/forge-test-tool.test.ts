import { expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { executeForgeTest, type ForgeCommandResult, forgeTestTool } from "./forge-test-tool"

function createContext(): { context: ToolContext; metadataCalls: Array<{ title?: string }> } {
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
  }

  return { context, metadataCalls }
}

test("forgeTestTool uses tool() helper contract", () => {
  expect(forgeTestTool.description.length).toBeGreaterThan(0)
  expect(forgeTestTool.args).toBeDefined()
  expect(typeof forgeTestTool.execute).toBe("function")
})

test("executeForgeTest parses contract-mapped forge test JSON", async () => {
  const { context, metadataCalls } = createContext()
  const stdout = JSON.stringify({
    tests: {
      "VaultTest.sol": {
        test_deposit: { status: "Success", gas: 21000 },
        test_withdraw_fails: { status: "Failure", gas: 5000 },
        test_skip_case: { status: "Skipped", gas: 0 },
      },
    },
    success: false,
  })

  const result = await executeForgeTest({ target: "." }, context, async (command, signal, cwd) => {
    expect(command).toEqual(["forge", "test", "--json", "-vvv"])
    expect(signal).toBe(context.abort)
    expect(cwd).toBe("/tmp/project")
    return { stdout, stderr: "", exitCode: 1 }
  })

  expect(result.success).toBe(false)
  expect(result.summary).toEqual({ passed: 1, failed: 1, skipped: 1, total: 3 })
  expect(result.tests).toEqual([
    { name: "test_deposit", contract: "VaultTest.sol", status: "pass", gas: 21000 },
    { name: "test_withdraw_fails", contract: "VaultTest.sol", status: "fail", gas: 5000 },
  ])
  expect(metadataCalls[0]?.title).toContain("forge test")
  expect(result.executionTime).toBeGreaterThanOrEqual(0)
})

test("executeForgeTest parses flat-array forge test JSON", async () => {
  const { context } = createContext()
  const stdout = JSON.stringify({
    tests: [
      { name: "testA", contract: "A.t.sol", status: "pass", gas: 101 },
      { name: "testB", contract: "A.t.sol", status: "fail", gas: 202 },
    ],
    success: false,
  })

  const result = await executeForgeTest({ target: ".", verbosity: 2 }, context, async () => ({
    stdout,
    stderr: "",
    exitCode: 1,
  }))

  expect(result.summary).toEqual({ passed: 1, failed: 1, skipped: 0, total: 2 })
  expect(result.tests[0]?.status).toBe("pass")
  expect(result.tests[1]?.status).toBe("fail")
})

test("executeForgeTest parses real forge --json output format", async () => {
  const { context } = createContext()
  const stdout = JSON.stringify({
    "test/VulnerableVault.t.sol:VulnerableVaultTest": {
      duration: { secs: 0, nanos: 123456789 },
      test_results: {
        "testReentrancy()": {
          status: "Success",
          reason: null,
          kind: { Unit: { gas: 45678 } },
          duration: { secs: 0, nanos: 12345 },
        },
        "testInvariantFuzz(uint256)": {
          status: "Failure",
          reason: "assertion failed",
          kind: { Fuzz: { mean_gas: 32100 } },
          duration: { secs: 0, nanos: 6789 },
        },
        "testSkipCase()": {
          status: "Skipped",
          reason: null,
          kind: { Unit: { gas: 111 } },
          duration: { secs: 0, nanos: 555 },
        },
      },
      warnings: [],
    },
  })

  const result = await executeForgeTest({ target: "." }, context, async () => ({
    stdout,
    stderr: "",
    exitCode: 1,
  }))

  expect(result.success).toBe(false)
  expect(result.summary).toEqual({ passed: 1, failed: 1, skipped: 1, total: 3 })
  expect(result.tests).toEqual([
    {
      name: "testReentrancy()",
      contract: "VulnerableVaultTest",
      status: "pass",
      gas: 45678,
    },
    {
      name: "testInvariantFuzz(uint256)",
      contract: "VulnerableVaultTest",
      status: "fail",
      gas: 32100,
    },
  ])
})

test("executeForgeTest runs coverage command and parses report", async () => {
  const { context } = createContext()
  const responses: ForgeCommandResult[] = [
    {
      stdout: JSON.stringify({
        tests: {
          "VaultTest.sol": {
            test_deposit: { status: "Success", gas: 21000 },
          },
        },
        success: true,
      }),
      stderr: "",
      exitCode: 0,
    },
    {
      stdout: JSON.stringify({
        files: [
          {
            path: "src/Vault.sol",
            lineCoverage: 80,
            branchCoverage: 70,
            functionCoverage: 50,
            uncoveredFunctions: ["withdraw", "emergencyWithdraw"],
          },
          {
            path: "src/Token.sol",
            lines: 100,
            branches: 90,
            functions: 100,
            uncoveredFunctions: [],
          },
        ],
      }),
      stderr: "",
      exitCode: 0,
    },
  ]

  const calls: string[][] = []
  const cwdCalls: string[] = []
  const result = await executeForgeTest(
    {
      target: "contracts",
      coverage: true,
      match_test: "test_deposit",
      match_contract: "VaultTest",
      fork_url: "https://rpc.example",
      gas_report: true,
      verbosity: 4,
    },
    context,
    async (command, _signal, cwd) => {
      calls.push(command)
      cwdCalls.push(cwd)
      const next = responses.shift()
      if (!next) {
        throw new Error("missing mocked response")
      }
      return next
    },
  )

  expect(calls).toEqual([
    [
      "forge",
      "test",
      "--json",
      "-vvvv",
      "--match-test",
      "test_deposit",
      "--match-contract",
      "VaultTest",
      "--fork-url",
      "https://rpc.example",
      "--gas-report",
    ],
    ["forge", "coverage", "--report", "json"],
  ])
  expect(cwdCalls).toEqual(["contracts", "contracts"])
  expect(result.success).toBe(true)
  expect(result.coverageReport).toEqual({
    files: [
      {
        path: "src/Vault.sol",
        lines: 80,
        branches: 70,
        functions: 50,
        uncoveredFunctions: ["withdraw", "emergencyWithdraw"],
      },
      {
        path: "src/Token.sol",
        lines: 100,
        branches: 90,
        functions: 100,
        uncoveredFunctions: [],
      },
    ],
  })
})

test("executeForgeTest handles ENOENT when forge is missing", async () => {
  const { context } = createContext()

  const result = await executeForgeTest({ target: "." }, context, async () => {
    const error = new Error("forge not found") as Error & { code?: string }
    error.code = "ENOENT"
    throw error
  })

  expect(result.success).toBe(false)
  expect(result.error).toBe(
    "Foundry not found. Install: curl -L https://foundry.paradigm.xyz | bash",
  )
})

test("executeForgeTest handles timeout and abort errors", async () => {
  const { context } = createContext()

  const timeoutResult = await executeForgeTest({ target: "." }, context, async () => {
    const error = new Error("timed out") as Error & { code?: string }
    error.code = "ETIMEDOUT"
    throw error
  })
  expect(timeoutResult.success).toBe(false)
  expect(timeoutResult.error).toBe("forge test timed out")

  const abortResult = await executeForgeTest({ target: "." }, context, async () => {
    throw new DOMException("Aborted", "AbortError")
  })
  expect(abortResult.success).toBe(false)
  expect(abortResult.error).toBe("forge test aborted")
})
