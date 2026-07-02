import { type ToolContext, tool } from "@opencode-ai/plugin"
import { classifyForgeError } from "../shared/forge-errors"
import { runForgeCommand } from "../shared/forge-runner"
import { assertContained } from "../shared/path-safety"
import { validateUrlScheme } from "../shared/process-runner"
import { resolveProjectDir } from "../shared/project-utils"

type ForgeFuzzArgs = {
  target?: string
  match_test?: string
  runs?: number
  seed?: number
  fork_url?: string
}

type NormalizedForgeFuzzArgs = {
  target: string
  match_test?: string
  runs: number
  seed?: number
  fork_url?: string
}

type ForgeFuzzResultItem = {
  testName: string
  status: "pass" | "fail"
  runs: number
  gas: number
}

type ForgeFuzzCounterexample = {
  testName: string
  inputs: Record<string, string>
  revertReason?: string
}

type ForgeFuzzResult = {
  success: boolean
  results: ForgeFuzzResultItem[]
  counterexamples: ForgeFuzzCounterexample[]
  totalRuns: number
  executionTime: number
  error?: string
}

export type ForgeFuzzCommandResult = {
  stdout: string
  stderr: string
  exitCode: number
}

type RunForgeFuzzCommand = (
  command: string[],
  options: { signal?: AbortSignal; cwd?: string; env?: Record<string, string> },
) => Promise<ForgeFuzzCommandResult>

function normalizeArgs(args: ForgeFuzzArgs, context: ToolContext): NormalizedForgeFuzzArgs {
  const requestedRuns =
    typeof args.runs === "number" && Number.isFinite(args.runs) ? args.runs : 256
  const clampedRuns = Math.max(1, Math.min(10000, Math.floor(requestedRuns)))
  const projectRoot = resolveProjectDir(context)
  const target =
    args.target && args.target !== "." ? assertContained(args.target, projectRoot) : projectRoot

  if (args.fork_url && !validateUrlScheme(args.fork_url)) {
    throw new Error(`fork_url must use http:// or https:// scheme, got: "${args.fork_url}"`)
  }

  return {
    target,
    match_test: args.match_test,
    runs: clampedRuns,
    seed: args.seed,
    fork_url: args.fork_url,
  }
}

function buildForgeFuzzCommand(args: NormalizedForgeFuzzArgs): string[] {
  const command = ["forge", "test", "--fuzz-runs", String(args.runs)]

  if (args.match_test) {
    command.push("--match-test", args.match_test)
  }
  if (typeof args.seed === "number" && Number.isFinite(args.seed)) {
    command.push("--fuzz-seed", String(Math.floor(args.seed)))
  }
  if (args.fork_url) {
    command.push("--fork-url", args.fork_url)
  }

  command.push("-v")
  return command
}

function parseNumber(input?: string): number {
  if (!input) {
    return 0
  }
  const normalized = input.replaceAll("_", "").trim()
  const value = Number.parseInt(normalized, 10)
  return Number.isFinite(value) ? value : 0
}

function splitArgsList(input: string): string[] {
  const values: string[] = []
  let current = ""
  let depth = 0

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i] ?? ""
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1
      current += ch
      continue
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth = Math.max(0, depth - 1)
      current += ch
      continue
    }
    if (ch === "," && depth === 0) {
      values.push(current.trim())
      current = ""
      continue
    }
    current += ch
  }

  if (current.trim().length > 0) {
    values.push(current.trim())
  }

  return values.filter((value) => value.length > 0)
}

function parseInputsFromArgs(argsBlob: string): Record<string, string> {
  const values = splitArgsList(argsBlob.trim())
  const inputs: Record<string, string> = {}

  values.forEach((value, index) => {
    inputs[`arg${index}`] = value
  })

  return inputs
}

function parseResultLine(line: string): ForgeFuzzResultItem | undefined {
  const match = line.match(
    /^\[(PASS|FAIL)[^\]]*\]\s*(.+?)\s*\(runs:\s*([\d_]+)(?:,\s*(?:\u03bc|mean):\s*([\d_]+))?/i,
  )
  if (!match) {
    return undefined
  }

  const status = match[1]?.toUpperCase() === "PASS" ? "pass" : "fail"
  return {
    testName: (match[2] ?? "unknown-test").trim(),
    status,
    runs: parseNumber(match[3]),
    gas: parseNumber(match[4]),
  }
}

function parseCounterexampleLine(line: string):
  | {
      testName?: string
      inputs: Record<string, string>
    }
  | undefined {
  if (!line.includes("Counterexample:")) {
    return undefined
  }

  const argsMatch = line.match(/Counterexample:\s*.*?args=\((.*?)\)\]/)
  if (!argsMatch) {
    return undefined
  }

  const trailing = line.match(/\]\s*(.+)$/)
  const possibleTest = trailing?.[1]?.replace(/\s*\(runs:.*$/, "").trim()

  return {
    testName: possibleTest && possibleTest.length > 0 ? possibleTest : undefined,
    inputs: parseInputsFromArgs(argsMatch[1] ?? ""),
  }
}

export async function executeForgeFuzz(
  args: ForgeFuzzArgs,
  context: ToolContext,
  runCommand: RunForgeFuzzCommand = runForgeCommand,
): Promise<ForgeFuzzResult> {
  const startedAt = Date.now()

  const fail = (error: string): ForgeFuzzResult => ({
    success: false,
    results: [],
    counterexamples: [],
    totalRuns: 0,
    executionTime: Date.now() - startedAt,
    error,
  })

  try {
    const normalized = normalizeArgs(args, context)
    context.metadata({ title: `Run forge fuzz: ${normalized.target}` })
    const runResult = await runCommand(buildForgeFuzzCommand(normalized), {
      signal: context.abort,
      cwd: normalized.target,
    })

    const lines = `${runResult.stdout}\n${runResult.stderr}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    const results: ForgeFuzzResultItem[] = []
    const counterexamples: ForgeFuzzCounterexample[] = []
    let lastTestName: string | undefined

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? ""
      const parsedResult = parseResultLine(line)
      if (parsedResult) {
        results.push(parsedResult)
        lastTestName = parsedResult.testName
      }

      const parsedCounterexample = parseCounterexampleLine(line)
      if (!parsedCounterexample) {
        continue
      }

      const fallbackName = parsedCounterexample.testName ?? lastTestName ?? "unknown-test"
      const nextLine = lines[i + 1] ?? ""
      const reasonMatch = nextLine.match(/^(?:Reason|Error):\s*(.+)$/i)
      counterexamples.push({
        testName: fallbackName,
        inputs: parsedCounterexample.inputs,
        ...(reasonMatch?.[1] ? { revertReason: reasonMatch[1].trim() } : {}),
      })
    }

    const totalRuns = results.reduce((sum, item) => sum + item.runs, 0)
    const failedCount = results.filter((item) => item.status === "fail").length
    const output: ForgeFuzzResult = {
      success: runResult.exitCode === 0 && failedCount === 0,
      results,
      counterexamples,
      totalRuns,
      executionTime: Date.now() - startedAt,
    }

    if (runResult.exitCode !== 0 && failedCount === 0) {
      output.error = runResult.stderr.trim() || `forge fuzz exited with code ${runResult.exitCode}`
    }

    return output
  } catch (error) {
    const classified = classifyForgeError(error, context, "forge fuzz")
    if (classified) return fail(classified)

    const maybeError = error as Error
    return fail(maybeError.message || "forge fuzz failed")
  }
}

export const forgeFuzzTool = tool({
  description:
    "Run Foundry fuzz tests, parse test runs, and extract counterexamples from verbose output.",
  args: {
    target: tool.schema.string().default("."),
    match_test: tool.schema.string().optional(),
    runs: tool.schema.number().min(1).max(10000).default(256),
    seed: tool.schema.number().optional(),
    fork_url: tool.schema.string().optional(),
  },
  async execute(args, context) {
    const result = await executeForgeFuzz(args, context)
    return JSON.stringify(result)
  },
})
