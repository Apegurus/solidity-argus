import { type ToolContext, tool } from "@opencode-ai/plugin"
import { resolveProjectDir } from "../shared/project-utils"

type ForgeTestArgs = {
  target?: string
  match_test?: string
  match_contract?: string
  fork_url?: string
  verbosity?: number
  gas_report?: boolean
  coverage?: boolean
}

type NormalizedForgeTestArgs = {
  target: string
  match_test?: string
  match_contract?: string
  fork_url?: string
  verbosity: number
  gas_report?: boolean
  coverage: boolean
}

type ForgeTestItem = {
  name: string
  contract: string
  status: "pass" | "fail"
  gas: number
}

type ForgeTestSummary = {
  passed: number
  failed: number
  skipped: number
  total: number
}

type ForgeCoverageFile = {
  path: string
  lines: number
  branches: number
  functions: number
  uncoveredFunctions: string[]
}

type ForgeTestResult = {
  success: boolean
  summary: ForgeTestSummary
  tests: ForgeTestItem[]
  gasReport?: Record<string, unknown>
  coverageReport?: { files: ForgeCoverageFile[] }
  executionTime: number
  error?: string
}

export type ForgeCommandResult = {
  stdout: string
  stderr: string
  exitCode: number
}

type RunForgeCommand = (
  command: string[],
  signal: AbortSignal,
  cwd: string,
) => Promise<ForgeCommandResult>

type ForgeTestPayload = {
  success?: boolean
  tests?:
    | Record<string, Record<string, { status?: string; gas?: number }>>
    | Array<{ name?: string; contract?: string; status?: string; gas?: number }>
  summary?: {
    passed?: number
    failed?: number
    skipped?: number
    total?: number
  }
  gas_report?: Record<string, unknown>
  gasReport?: Record<string, unknown>
}

type CoveragePayload = {
  files?: Array<Record<string, unknown>>
  coverage?: Record<string, Record<string, unknown>>
}

function mapStatus(input?: string): "pass" | "fail" | "skip" {
  const normalized = (input ?? "").toLowerCase()
  if (normalized.includes("skip") || normalized.includes("ignore")) {
    return "skip"
  }
  if (normalized.includes("pass") || normalized.includes("success")) {
    return "pass"
  }
  return "fail"
}

function toNumber(input: unknown, fallback = 0): number {
  return typeof input === "number" && Number.isFinite(input) ? input : fallback
}

function parseTests(payload: ForgeTestPayload): {
  tests: ForgeTestItem[]
  summary: ForgeTestSummary
} {
  const collected: Array<ForgeTestItem | { skipped: true }> = []

  if (Array.isArray(payload.tests)) {
    for (const item of payload.tests) {
      const status = mapStatus(item.status)
      if (status === "skip") {
        collected.push({ skipped: true })
        continue
      }
      collected.push({
        name: item.name ?? "unknown-test",
        contract: item.contract ?? "unknown-contract",
        status,
        gas: toNumber(item.gas),
      })
    }
  } else if (payload.tests && typeof payload.tests === "object") {
    const entries = Object.entries(payload.tests)
    for (const [contract, tests] of entries) {
      for (const [name, details] of Object.entries(tests)) {
        const status = mapStatus(details.status)
        if (status === "skip") {
          collected.push({ skipped: true })
          continue
        }
        collected.push({
          name,
          contract,
          status,
          gas: toNumber(details.gas),
        })
      }
    }
  }

  const tests = collected.filter((item): item is ForgeTestItem => !("skipped" in item))
  const passed = tests.filter((item) => item.status === "pass").length
  const failed = tests.filter((item) => item.status === "fail").length
  const skippedFromTests = collected.length - tests.length
  const summary = payload.summary
  const skipped = typeof summary?.skipped === "number" ? summary.skipped : skippedFromTests
  const total = typeof summary?.total === "number" ? summary.total : passed + failed + skipped

  return {
    tests,
    summary: {
      passed: typeof summary?.passed === "number" ? summary.passed : passed,
      failed: typeof summary?.failed === "number" ? summary.failed : failed,
      skipped,
      total,
    },
  }
}

function valueFromRecord(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key]
    }
  }
  return undefined
}

function parseUncoveredFunctions(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return []
  }

  return input
    .map((value) => {
      if (typeof value === "string") {
        return value
      }
      if (value && typeof value === "object" && "name" in value) {
        const name = (value as { name?: unknown }).name
        return typeof name === "string" ? name : ""
      }
      return ""
    })
    .filter((value) => value.length > 0)
}

function normalizeCoverageFile(file: Record<string, unknown>): ForgeCoverageFile {
  return {
    path: (valueFromRecord(file, ["path", "file", "name"]) as string) ?? "unknown",
    lines: toNumber(valueFromRecord(file, ["lines", "lineCoverage", "line_coverage"])),
    branches: toNumber(valueFromRecord(file, ["branches", "branchCoverage", "branch_coverage"])),
    functions: toNumber(
      valueFromRecord(file, ["functions", "functionCoverage", "function_coverage"]),
    ),
    uncoveredFunctions: parseUncoveredFunctions(
      valueFromRecord(file, ["uncoveredFunctions", "uncovered_functions"]),
    ),
  }
}

function parseCoverage(payload: CoveragePayload): { files: ForgeCoverageFile[] } {
  if (Array.isArray(payload.files)) {
    return {
      files: payload.files
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => normalizeCoverageFile(item)),
    }
  }

  if (payload.coverage && typeof payload.coverage === "object") {
    const files: ForgeCoverageFile[] = []
    for (const [path, metrics] of Object.entries(payload.coverage)) {
      if (!metrics || typeof metrics !== "object") {
        continue
      }
      files.push(
        normalizeCoverageFile({
          path,
          ...metrics,
        }),
      )
    }

    return { files }
  }

  return { files: [] }
}

function normalizeArgs(args: ForgeTestArgs): NormalizedForgeTestArgs {
  return {
    target: args.target ?? ".",
    match_test: args.match_test,
    match_contract: args.match_contract,
    fork_url: args.fork_url,
    verbosity:
      typeof args.verbosity === "number" && args.verbosity >= 1 && args.verbosity <= 5
        ? args.verbosity
        : 3,
    gas_report: args.gas_report,
    coverage: args.coverage ?? false,
  }
}

function buildForgeTestCommand(args: NormalizedForgeTestArgs): string[] {
  const command = ["forge", "test", "--json", `-v${"v".repeat(args.verbosity - 1)}`]

  if (args.match_test) {
    command.push("--match-test", args.match_test)
  }
  if (args.match_contract) {
    command.push("--match-contract", args.match_contract)
  }
  if (args.fork_url) {
    command.push("--fork-url", args.fork_url)
  }
  if (args.gas_report) {
    command.push("--gas-report")
  }

  return command
}

const runForgeCommand: RunForgeCommand = async (command, signal, cwd) => {
  const child = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    signal,
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])

  return {
    stdout,
    stderr,
    exitCode,
  }
}

export async function executeForgeTest(
  args: ForgeTestArgs,
  context: ToolContext,
  runCommand: RunForgeCommand = runForgeCommand,
): Promise<ForgeTestResult> {
  const startedAt = Date.now()
  const normalizedArgs = normalizeArgs(args)
  const projectDir = resolveProjectDir(context)
  context.metadata({ title: `Run forge test: ${normalizedArgs.target}` })

  const fail = (error: string): ForgeTestResult => ({
    success: false,
    summary: { passed: 0, failed: 0, skipped: 0, total: 0 },
    tests: [],
    executionTime: Date.now() - startedAt,
    error,
  })

  try {
    const testResult = await runCommand(
      buildForgeTestCommand(normalizedArgs),
      context.abort,
      projectDir,
    )

    let payload: ForgeTestPayload
    try {
      payload = JSON.parse(testResult.stdout) as ForgeTestPayload
    } catch {
      return fail("Invalid JSON output from forge test")
    }

    const parsed = parseTests(payload)
    const output: ForgeTestResult = {
      success:
        testResult.exitCode === 0 &&
        parsed.summary.failed === 0 &&
        (payload.success ?? true) === true,
      summary: parsed.summary,
      tests: parsed.tests,
      executionTime: Date.now() - startedAt,
    }

    const gasReport = payload.gas_report ?? payload.gasReport
    if (gasReport) {
      output.gasReport = gasReport
    }

    if (normalizedArgs.coverage) {
      const coverageResult = await runCommand(
        ["forge", "coverage", "--report", "json"],
        context.abort,
        projectDir,
      )
      if (coverageResult.exitCode !== 0) {
        output.error = coverageResult.stderr.trim() || "forge coverage failed"
        output.success = false
      } else {
        try {
          const coveragePayload = JSON.parse(coverageResult.stdout) as CoveragePayload
          output.coverageReport = parseCoverage(coveragePayload)
        } catch {
          output.error = "Invalid JSON output from forge coverage"
          output.success = false
        }
      }
    }

    if (testResult.exitCode !== 0 && !output.error) {
      output.error =
        testResult.stderr.trim() || `forge test exited with code ${testResult.exitCode}`
    }

    return output
  } catch (error) {
    if (context.abort.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      return fail("forge test aborted")
    }

    const maybeError = error as Error & { code?: string }
    if (maybeError.code === "ENOENT") {
      return fail("Foundry not found. Install: curl -L https://foundry.paradigm.xyz | bash")
    }
    if (maybeError.code === "ETIMEDOUT" || maybeError.message.toLowerCase().includes("timed out")) {
      return fail("forge test timed out")
    }

    return fail(maybeError.message || "forge test failed")
  }
}

export const forgeTestTool = tool({
  description: "Run forge test with optional coverage and return normalized results.",
  args: {
    target: tool.schema.string().default("."),
    match_test: tool.schema.string().optional(),
    match_contract: tool.schema.string().optional(),
    fork_url: tool.schema.string().optional(),
    verbosity: tool.schema.number().min(1).max(5).default(3),
    gas_report: tool.schema.boolean().optional(),
    coverage: tool.schema.boolean().default(false),
  },
  async execute(args, context) {
    const result = await executeForgeTest(args, context)
    return JSON.stringify(result)
  },
})
