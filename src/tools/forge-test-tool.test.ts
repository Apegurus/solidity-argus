import { expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { executeForgeTest, forgeTestTool } from "./forge-test-tool"

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

test("executeForgeTest rejects a loopback/link-local fork_url without running forge", async () => {
  const { context } = createContext()
  let ran = false
  for (const forkUrl of ["http://169.254.169.254", "http://127.0.0.1:8545"]) {
    const result = await executeForgeTest({ target: ".", fork_url: forkUrl }, context, async () => {
      ran = true
      return { stdout: "", stderr: "", exitCode: 0 }
    })
    expect(result.success).toBe(false)
    expect(result.error ?? "").toMatch(/loopback|link-local|private|disallowed/i)
  }
  expect(ran).toBe(false)
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

  const result = await executeForgeTest({ target: "." }, context, async (command, options) => {
    expect(command).toEqual(["forge", "test", "--json", "-vvv"])
    expect(options.signal).toBe(context.abort)
    expect(options.cwd).toBe("/tmp/project")
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

test("executeForgeTest rejects path traversal in target", async () => {
  const { context } = createContext()

  const result = await executeForgeTest({ target: "../../etc" }, context, async () => ({
    stdout: "{}",
    stderr: "",
    exitCode: 0,
  }))
  expect(result.success).toBe(false)
  expect(result.error).toContain("outside")
})

test("executeForgeTest rejects non-http fork_url", async () => {
  const { context } = createContext()

  const result = await executeForgeTest(
    { target: ".", fork_url: "file:///etc/passwd" },
    context,
    async () => ({ stdout: "{}", stderr: "", exitCode: 0 }),
  )
  expect(result.success).toBe(false)
  expect(result.error ?? "").toMatch(/scheme|http\/https/i)
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
