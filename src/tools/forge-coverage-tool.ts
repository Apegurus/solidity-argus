import { type ToolContext, tool } from "@opencode-ai/plugin"
import { classifyForgeError } from "../shared/forge-errors"
import { runForgeCommand } from "../shared/forge-runner"
import { resolveProjectDir } from "../shared/project-utils"

type ForgeCoverageArgs = {
  target?: string
  match_path?: string
  ir_minimum?: boolean
}

type NormalizedForgeCoverageArgs = {
  target: string
  match_path?: string
  ir_minimum: boolean
}

type ForgeCoverageFile = {
  path: string
  linesPct: number
  statementsPct: number
  branchesPct: number
  functionsPct: number
}

type ForgeCoverageSummary = {
  totalLinesPct: number
  totalStatementsPct: number
  totalBranchesPct: number
  totalFunctionsPct: number
}

type ForgeCoverageReport = {
  files: ForgeCoverageFile[]
  summary: ForgeCoverageSummary
}

type ForgeCoverageResult = {
  success: boolean
  report: ForgeCoverageReport
  executionTime: number
  error?: string
  hint?: string
  suggested_command?: string
}

export type ForgeCommandRunner = (
  command: string[],
  options: { signal?: AbortSignal; cwd?: string; env?: Record<string, string> },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>

const EMPTY_SUMMARY: ForgeCoverageSummary = {
  totalLinesPct: 0,
  totalStatementsPct: 0,
  totalBranchesPct: 0,
  totalFunctionsPct: 0,
}

function normalizeArgs(args: ForgeCoverageArgs, context: ToolContext): NormalizedForgeCoverageArgs {
  return {
    target: args.target ?? resolveProjectDir(context),
    match_path: args.match_path,
    ir_minimum: args.ir_minimum ?? false,
  }
}

function buildCoverageCommand(args: NormalizedForgeCoverageArgs, forceIrMinimum = false): string[] {
  const command = ["forge", "coverage", "--report", "summary"]
  if (args.match_path) command.push("--match-path", args.match_path)
  if (args.ir_minimum || forceIrMinimum) command.push("--ir-minimum")
  return command
}

function isStackTooDeep(stderr: string): boolean {
  return /stack too deep/i.test(stderr)
}

function isUnknownConfigKey(stderr: string): boolean {
  return /unknown key/i.test(stderr)
}

function classifyCoverageFailure(
  stderr: string,
  args: NormalizedForgeCoverageArgs,
): Pick<ForgeCoverageResult, "hint" | "suggested_command"> | undefined {
  if (isUnknownConfigKey(stderr)) {
    return {
      hint:
        `Forge coverage failed for ${args.target} because foundry.toml contains an unknown foundry.toml key. ` +
        "Review coverage-compatible Foundry configuration manually; Argus will not edit foundry.toml.",
      suggested_command: buildCoverageCommand(args).join(" "),
    }
  }

  const command = buildCoverageCommand({ ...args, ir_minimum: true }).join(" ")

  if (
    !/(optimizerSteps|unsupported optimizer|config parse|failed to parse|instrumentation)/i.test(
      stderr,
    )
  ) {
    return undefined
  }

  return {
    hint:
      `Forge coverage failed for ${args.target} while parsing or instrumenting project configuration. ` +
      "If foundry.toml uses optimizerSteps or unsupported optimizer settings, run a scoped coverage command or temporarily adjust coverage-only config manually; Argus will not edit foundry.toml.",
    suggested_command: command,
  }
}

function shouldRetryWithIrMinimum(stderr: string): boolean {
  return (
    isStackTooDeep(stderr) ||
    (!isUnknownConfigKey(stderr) &&
      /(optimizerSteps|unsupported optimizer|config parse|failed to parse|instrumentation)/i.test(
        stderr,
      ))
  )
}

function parsePercent(input: string): number {
  const match = input.match(/(\d+(?:\.\d+)?)%/)
  if (!match?.[1]) {
    return 0
  }

  const value = Number.parseFloat(match[1])
  return Number.isFinite(value) ? value : 0
}

function parseTableRow(line: string): string[] {
  if (!line.startsWith("|")) {
    return []
  }
  return line
    .split("|")
    .slice(1, -1)
    .map((item) => item.trim())
}

function isSeparatorRow(cells: string[]): boolean {
  if (cells.length === 0) {
    return false
  }
  return cells.every((cell) => /^-+$/.test(cell))
}

function parseCoverageReport(output: string): ForgeCoverageReport {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))

  const files: ForgeCoverageFile[] = []
  let summary: ForgeCoverageSummary = { ...EMPTY_SUMMARY }
  let hasSummary = false

  for (const line of lines) {
    const cells = parseTableRow(line)
    if (cells.length < 5) {
      continue
    }

    if (isSeparatorRow(cells)) {
      continue
    }

    const label = cells[0]?.toLowerCase()
    if (label === "file") {
      continue
    }

    const rowValues = {
      linesPct: parsePercent(cells[1] ?? "0"),
      statementsPct: parsePercent(cells[2] ?? "0"),
      branchesPct: parsePercent(cells[3] ?? "0"),
      functionsPct: parsePercent(cells[4] ?? "0"),
    }

    if (label === "total") {
      summary = {
        totalLinesPct: rowValues.linesPct,
        totalStatementsPct: rowValues.statementsPct,
        totalBranchesPct: rowValues.branchesPct,
        totalFunctionsPct: rowValues.functionsPct,
      }
      hasSummary = true
      continue
    }

    files.push({
      path: cells[0] ?? "unknown",
      ...rowValues,
    })
  }

  if (!hasSummary) {
    throw new Error("Invalid tabular output from forge coverage")
  }

  return { files, summary }
}

function isAllZeroCoverage(summary: ForgeCoverageSummary): boolean {
  return (
    summary.totalLinesPct === 0 &&
    summary.totalStatementsPct === 0 &&
    summary.totalBranchesPct === 0 &&
    summary.totalFunctionsPct === 0
  )
}

export async function executeForgeCoverage(
  args: ForgeCoverageArgs,
  context: ToolContext,
  runCommand: ForgeCommandRunner = runForgeCommand,
): Promise<ForgeCoverageResult> {
  const startedAt = Date.now()
  const normalizedArgs = normalizeArgs(args, context)
  context.metadata({ title: `Run forge coverage: ${normalizedArgs.target}` })

  const fail = (
    error: string,
    diagnostics?: Pick<ForgeCoverageResult, "hint" | "suggested_command">,
  ): ForgeCoverageResult => ({
    success: false,
    report: { files: [], summary: { ...EMPTY_SUMMARY } },
    executionTime: Date.now() - startedAt,
    error,
    ...diagnostics,
  })

  try {
    let runResult = await runCommand(buildCoverageCommand(normalizedArgs), {
      signal: context.abort,
      cwd: normalizedArgs.target,
    })

    if (
      runResult.exitCode !== 0 &&
      !normalizedArgs.ir_minimum &&
      shouldRetryWithIrMinimum(runResult.stderr)
    ) {
      runResult = await runCommand(buildCoverageCommand(normalizedArgs, true), {
        signal: context.abort,
        cwd: normalizedArgs.target,
      })
    }

    if (runResult.exitCode !== 0) {
      const error =
        runResult.stderr.trim() || `forge coverage exited with code ${runResult.exitCode}`
      return fail(error, classifyCoverageFailure(error, normalizedArgs))
    }

    let report: ForgeCoverageReport
    try {
      report = parseCoverageReport(runResult.stdout)
    } catch {
      return fail("Invalid tabular output from forge coverage")
    }

    if (isAllZeroCoverage(report.summary)) {
      return {
        success: false,
        report,
        executionTime: Date.now() - startedAt,
        error:
          "forge coverage reported 0% across all metrics — coverage was not measured (no tests executed or contracts were not instrumented).",
        hint: "Confirm the project has runnable tests and compiles, then retry after `forge clean`. If the build hits stack-too-deep, pass ir_minimum: true.",
        suggested_command: "forge clean && forge coverage --report summary",
      }
    }

    return {
      success: true,
      report,
      executionTime: Date.now() - startedAt,
    }
  } catch (error) {
    const classified = classifyForgeError(error, context, "forge coverage")
    if (classified) return fail(classified)

    const maybeError = error as Error
    return fail(maybeError.message || "forge coverage failed")
  }
}

export const forgeCoverageTool = tool({
  description:
    "Run forge coverage analysis and return structured per-file coverage metrics (lines, statements, branches, functions).",
  args: {
    target: tool.schema.string().optional(),
    match_path: tool.schema.string().optional(),
    ir_minimum: tool.schema.boolean().optional(),
  },
  async execute(args, context) {
    const result = await executeForgeCoverage(args, context)
    return JSON.stringify(result)
  },
})
