import { expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { executeForgeFuzz, type ForgeFuzzCommandResult, forgeFuzzTool } from "./forge-fuzz-tool"

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

test("forgeFuzzTool uses tool() helper contract", () => {
  expect(forgeFuzzTool.description.length).toBeGreaterThan(0)
  expect(forgeFuzzTool.args).toBeDefined()
  expect(typeof forgeFuzzTool.execute).toBe("function")
})

test("executeForgeFuzz rejects a loopback/link-local fork_url without running forge", async () => {
  const { context } = createContext()
  let ran = false
  for (const forkUrl of ["http://169.254.169.254", "http://127.0.0.1:8545"]) {
    const result = await executeForgeFuzz({ target: ".", fork_url: forkUrl }, context, async () => {
      ran = true
      return { stdout: "", stderr: "", exitCode: 0 }
    })
    expect(result.success).toBe(false)
    expect(result.error ?? "").toMatch(/loopback|link-local|private|disallowed/i)
  }
  expect(ran).toBe(false)
})

test("executeForgeFuzz rejects a flag-shaped match_test without running forge (adj_20)", async () => {
  const { context } = createContext()
  let ran = false
  const result = await executeForgeFuzz(
    { target: ".", match_test: "--fork-url=http://169.254.169.254" },
    context,
    async () => {
      ran = true
      return { stdout: "", stderr: "", exitCode: 0 }
    },
  )
  expect(result.success).toBe(false)
  expect(result.error ?? "").toMatch(/option injection|may not start with/i)
  expect(ran).toBe(false)
})

test("executeForgeFuzz parses fuzz results and counterexamples", async () => {
  const { context, metadataCalls } = createContext()
  const output = [
    "Ran 2 tests for test/FuzzVault.t.sol:FuzzVaultTest",
    "[PASS] testFuzz_Deposit(uint256) (runs: 256, μ: 20123, ~: 20011)",
    "[FAIL. Counterexample: calldata=0x1234, args=(0)] testFuzz_Withdraw(uint256) (runs: 22, μ: 42219, ~: 42000)",
    "Reason: panic: assertion failed (0x01)",
  ].join("\n")

  const result = await executeForgeFuzz(
    {
      target: ".",
      runs: 256,
      match_test: "testFuzz_",
      seed: 42,
      fork_url: "https://rpc.example",
    },
    context,
    async (command, options) => {
      expect(command).toEqual([
        "forge",
        "test",
        "--fuzz-runs",
        "256",
        "--match-test",
        "testFuzz_",
        "--fuzz-seed",
        "42",
        "--fork-url",
        "https://rpc.example",
        "-v",
      ])
      expect(options.signal).toBe(context.abort)
      expect(options.cwd).toBe("/tmp/project")

      const response: ForgeFuzzCommandResult = {
        stdout: output,
        stderr: "",
        exitCode: 1,
      }

      return response
    },
  )

  expect(result.success).toBe(false)
  expect(result.results).toEqual([
    {
      testName: "testFuzz_Deposit(uint256)",
      status: "pass",
      runs: 256,
      gas: 20123,
    },
    {
      testName: "testFuzz_Withdraw(uint256)",
      status: "fail",
      runs: 22,
      gas: 42219,
    },
  ])
  expect(result.counterexamples).toEqual([
    {
      testName: "testFuzz_Withdraw(uint256)",
      inputs: { arg0: "0" },
      revertReason: "panic: assertion failed (0x01)",
    },
  ])
  expect(result.totalRuns).toBe(278)
  expect(result.executionTime).toBeGreaterThanOrEqual(0)
  expect(metadataCalls[0]?.title).toContain("forge fuzz")
})

test("executeForgeFuzz parses test name from previous line when fail line omits it", async () => {
  const { context } = createContext()
  const output = [
    "[FAIL: assertion failed] testFuzz_Invariant(uint256) (runs: 9, μ: 1921, ~: 1900)",
    "[FAIL. Counterexample: calldata=0xabcd, args=(1, 2)]",
  ].join("\n")

  const result = await executeForgeFuzz({ target: ".", runs: 10 }, context, async () => ({
    stdout: output,
    stderr: "",
    exitCode: 1,
  }))

  expect(result.counterexamples).toEqual([
    {
      testName: "testFuzz_Invariant(uint256)",
      inputs: { arg0: "1", arg1: "2" },
    },
  ])
})

test("executeForgeFuzz caps runs to 10000 and succeeds without failures", async () => {
  const { context } = createContext()
  const output = "[PASS] testFuzz_Bounds(uint256) (runs: 10000, μ: 999, ~: 999)"

  const result = await executeForgeFuzz({ target: ".", runs: 20000 }, context, async (command) => {
    expect(command).toEqual(["forge", "test", "--fuzz-runs", "10000", "-v"])
    return {
      stdout: output,
      stderr: "",
      exitCode: 0,
    }
  })

  expect(result.success).toBe(true)
  expect(result.totalRuns).toBe(10000)
  expect(result.error).toBeUndefined()
})

test("forgeFuzzTool.execute returns JSON string payload", async () => {
  const { context } = createContext()

  const raw = await forgeFuzzTool.execute({ target: ".", runs: 1 }, context)
  const parsed = JSON.parse(raw as string) as {
    success: boolean
    results: unknown[]
    counterexamples: unknown[]
    totalRuns: number
    executionTime: number
    error?: string
  }

  expect(parsed).toHaveProperty("success")
  expect(parsed).toHaveProperty("results")
  expect(parsed).toHaveProperty("counterexamples")
  expect(parsed).toHaveProperty("totalRuns")
  expect(parsed).toHaveProperty("executionTime")
})

test("executeForgeFuzz rejects path traversal in target", async () => {
  const { context } = createContext()

  const result = await executeForgeFuzz({ target: "../../etc", runs: 1 }, context, async () => ({
    stdout: "",
    stderr: "",
    exitCode: 0,
  }))
  expect(result.success).toBe(false)
  expect(result.error).toContain("outside")
})

test("executeForgeFuzz rejects non-http fork_url", async () => {
  const { context } = createContext()

  const result = await executeForgeFuzz(
    { target: ".", runs: 1, fork_url: "file:///etc/passwd" },
    context,
    async () => ({ stdout: "", stderr: "", exitCode: 0 }),
  )
  expect(result.success).toBe(false)
  expect(result.error ?? "").toMatch(/scheme|http\/https/i)
})

test("executeForgeFuzz handles ENOENT, timeout, and abort", async () => {
  const { context } = createContext()

  const enoent = await executeForgeFuzz({ target: ".", runs: 128 }, context, async () => {
    const error = new Error("forge not found") as Error & { code?: string }
    error.code = "ENOENT"
    throw error
  })
  expect(enoent.success).toBe(false)
  expect(enoent.error).toBe(
    "Foundry not found. Install: curl -L https://foundry.paradigm.xyz | bash",
  )

  const timeout = await executeForgeFuzz({ target: ".", runs: 128 }, context, async () => {
    const error = new Error("timed out") as Error & { code?: string }
    error.code = "ETIMEDOUT"
    throw error
  })
  expect(timeout.success).toBe(false)
  expect(timeout.error).toBe("forge fuzz timed out")

  const aborted = await executeForgeFuzz({ target: ".", runs: 128 }, context, async () => {
    throw new DOMException("Aborted", "AbortError")
  })
  expect(aborted.success).toBe(false)
  expect(aborted.error).toBe("forge fuzz aborted")
})
