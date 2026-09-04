import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { type ToolContext, tool } from "@opencode-ai/plugin"
import { createLogger } from "../shared/logger"
import { assertContained, PathSafetyError } from "../shared/path-safety"
import { buildSafeEnv } from "../shared/process-runner"
import { findFoundryProjectDir, resolveProjectDir } from "../shared/project-utils"
import {
  appendTruncationMarker,
  DEFAULT_SUBPROCESS_TIMEOUT_MS,
  MAX_SUBPROCESS_STDERR_BYTES,
  MAX_SUBPROCESS_STDOUT_BYTES,
  readStreamCapped,
} from "../shared/subprocess-io"
import type { Finding } from "../state/types"
import { defaultFlattenDeps } from "./slither-fallback-runtime"
import { parseSlitherFindings, type SlitherPayload } from "./slither-findings"
import { flattenFallback, TRUSTED_SLITHER_CONFIG } from "./slither-flatten-fallback"
import {
  filterSlitherFindings,
  resolveSlitherInvocation,
  validateFoundryCompilerConfig,
  validateFoundrySourceClosure,
  validateSlitherTarget,
} from "./slither-target"

const logger = createLogger()

export {
  defaultSpawnFn,
  type FlattenFallbackDeps,
  type SpawnFn,
} from "./slither-fallback-runtime"
export { flattenFallback } from "./slither-flatten-fallback"

type SlitherArgs = {
  target: string
  detectors?: string[]
  exclude?: string[]
  solc_version?: string
  via_ir?: boolean
}

export type SlitherRunResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export type RunSlitherCommand = (
  command: string[],
  signal: AbortSignal,
  cwd: string,
) => Promise<SlitherRunResult>

export type SlitherAnalyzeResult = {
  success: boolean
  findingsCount: number
  findings: Finding[]
  executionTime: number
  errors: string[]
  error?: string
  failureCode?: SlitherFailureCode
  hint?: string
  suggested_command?: string
}

export type SlitherFailureCode =
  | "SLITHER_INVALID_ARGUMENT"
  | "SLITHER_TARGET_NOT_FOUND"
  | "SLITHER_TARGET_OUTSIDE_PROJECT"
  | "SLITHER_BINARY_UNAVAILABLE"
  | "SLITHER_ABORTED"
  | "SLITHER_OUTPUT_PARSE_FAILED"
  | "SLITHER_PROJECT_COMPILATION_FAILED"
  | "SLITHER_UNSAFE_FOUNDRY_CONFIG"
  | "SLITHER_UNSAFE_SOURCE_TREE"
  | "SLITHER_EXECUTION_FAILED"

function buildCommand(args: SlitherArgs, commandTarget: string, forceFoundry = false): string[] {
  const command = [
    "slither",
    commandTarget,
    "--json",
    "-",
    "--filter-paths",
    "node_modules",
    "--config-file",
    TRUSTED_SLITHER_CONFIG,
  ]
  if (forceFoundry || args.via_ir) command.push("--compile-force-framework", "foundry")

  if (args.detectors && args.detectors.length > 0) {
    command.push("--detect", args.detectors.join(","))
  }

  if (args.exclude && args.exclude.length > 0) {
    command.push("--exclude", args.exclude.join(","))
  }

  if (args.solc_version) {
    command.push("--solc", `solc:${args.solc_version}`)
  }

  return command
}

const FALLBACK_TRIGGERS = [
  "Contract",
  "not found",
  "AssertionError",
  "crytic_compile",
  "empty AST",
  "Compilation failed",
  "via_ir",
  "via-ir",
  "viaIR",
  "YulException",
  "StackTooDeep",
  "Stack too deep",
]

function shouldTryFlattenFallback(errors: string[], stderr: string): boolean {
  const combined = [...errors, stderr].join(" ")
  return FALLBACK_TRIGGERS.some((trigger) => combined.includes(trigger))
}

function isMixedPragmaSlitherFailure(errors: string[], stderr: string): boolean {
  const combined = [...errors, stderr].join(" ")
  return (
    /(CryticCompileError|Slither exited with code 1)/i.test(combined) &&
    /(solc|pragma|requires different compiler version|different compiler version|compiler version)/i.test(
      combined,
    )
  )
}

function containsSolidityFile(dir: string): boolean {
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)
      if (stat.isFile() && entry.endsWith(".sol")) return true
      if (stat.isDirectory() && containsSolidityFile(fullPath)) return true
    }
  } catch {
    return false
  }
  return false
}

function mixedPragmaDiagnostics(
  args: SlitherArgs,
  projectDir: string,
  errors: string[],
  stderr: string,
): Pick<SlitherAnalyzeResult, "hint" | "suggested_command"> | undefined {
  if (!isMixedPragmaSlitherFailure(errors, stderr)) return undefined

  const target = resolve(projectDir, args.target)
  const srcCandidate = join(target, "src")
  const suggestion =
    existsSync(srcCandidate) && containsSolidityFile(srcCandidate) ? srcCandidate : undefined
  return {
    hint: "Try narrowing target to a single-pragma subdirectory and check foundry.toml/remappings for mixed compiler or vendored dependency scope issues.",
    suggested_command: suggestion
      ? buildCommand({ ...args, target: suggestion }, suggestion).join(" ")
      : undefined,
  }
}

export const runSlitherCommand: RunSlitherCommand = async (command, signal, cwd) => {
  const child = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    signal,
    timeout: DEFAULT_SUBPROCESS_TIMEOUT_MS,
    env: buildSafeEnv(),
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    readStreamCapped(child.stdout, MAX_SUBPROCESS_STDOUT_BYTES),
    readStreamCapped(child.stderr, MAX_SUBPROCESS_STDERR_BYTES),
  ])

  return {
    stdout: appendTruncationMarker(stdout, "stdout"),
    stderr: appendTruncationMarker(stderr, "stderr"),
    exitCode,
  }
}

export async function executeSlitherAnalyze(
  args: SlitherArgs,
  context: ToolContext,
  runCommand: RunSlitherCommand = runSlitherCommand,
  cwd?: string,
): Promise<SlitherAnalyzeResult> {
  const projectDir = cwd ?? resolveProjectDir(context)
  const startedAt = Date.now()
  context.metadata({ title: `Slither analysis: ${args.target}` })

  if (args.solc_version && !/^\d+\.\d+\.\d+$/.test(args.solc_version)) {
    return {
      success: false,
      findingsCount: 0,
      findings: [],
      executionTime: Date.now() - startedAt,
      errors: [
        `Invalid solc_version format: "${args.solc_version}". Expected semver format (e.g. 0.8.20)`,
      ],
      error: `Invalid solc_version format: "${args.solc_version}". Expected semver format (e.g. 0.8.20)`,
      failureCode: "SLITHER_INVALID_ARGUMENT",
    }
  }

  const invocation = resolveSlitherInvocation(args.target, projectDir)
  const compilerConfig = validateFoundryCompilerConfig(invocation.cwd)
  if (!compilerConfig.ok) {
    return {
      success: false,
      findingsCount: 0,
      findings: [],
      executionTime: Date.now() - startedAt,
      errors: [compilerConfig.message],
      error: compilerConfig.message,
      failureCode: "SLITHER_UNSAFE_FOUNDRY_CONFIG",
    }
  }
  const sourceClosure = validateFoundrySourceClosure(invocation.cwd, projectDir)
  if (!sourceClosure.ok) {
    return {
      success: false,
      findingsCount: 0,
      findings: [],
      executionTime: Date.now() - startedAt,
      errors: [sourceClosure.message],
      error: sourceClosure.message,
      failureCode: "SLITHER_UNSAFE_SOURCE_TREE",
    }
  }
  const command = buildCommand(
    args,
    invocation.commandTarget,
    existsSync(join(invocation.cwd, "foundry.toml")),
  )

  try {
    const runResult = await runCommand(command, context.abort, invocation.cwd)
    const errors: string[] = []

    if (runResult.exitCode !== 0) {
      errors.push(`Slither exited with code ${runResult.exitCode}`)
    }
    if (runResult.stderr.trim().length > 0) {
      errors.push(runResult.stderr.trim())
    }

    let payload: SlitherPayload
    try {
      payload = JSON.parse(runResult.stdout) as SlitherPayload
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown parse error"
      const diagnostics = mixedPragmaDiagnostics(args, projectDir, errors, runResult.stderr)
      if (!args.via_ir && !diagnostics && shouldTryFlattenFallback(errors, runResult.stderr)) {
        const fallbackResult = await flattenFallback(args, context, {
          ...defaultFlattenDeps(runCommand),
          runCommand,
          cwd: invocation.cwd,
          projectDir,
        })
        if (fallbackResult) return fallbackResult
      }
      return {
        success: false,
        findingsCount: 0,
        findings: [],
        executionTime: Date.now() - startedAt,
        errors,
        error: args.via_ir
          ? `SLITHER_VIA_IR_ANALYSIS_FAILED: Slither output parse error: ${message}`
          : `Slither output parse error: ${message}`,
        failureCode: "SLITHER_OUTPUT_PARSE_FAILED",
        ...diagnostics,
      }
    }

    if (payload.error) {
      errors.push(payload.error)
    }

    const findings = filterSlitherFindings(
      parseSlitherFindings(payload),
      invocation.reportTarget,
      invocation.cwd,
      projectDir,
    )
    const success = findings.length > 0 || (runResult.exitCode === 0 && payload.success !== false)

    const diagnostics = mixedPragmaDiagnostics(args, projectDir, errors, runResult.stderr)

    if (
      !success &&
      findings.length === 0 &&
      !diagnostics &&
      !args.via_ir &&
      shouldTryFlattenFallback(errors, runResult.stderr)
    ) {
      const fallbackResult = await flattenFallback(args, context, {
        ...defaultFlattenDeps(runCommand),
        runCommand,
        cwd: invocation.cwd,
        projectDir,
      })
      if (fallbackResult) return fallbackResult
    }

    return {
      success,
      findingsCount: findings.length,
      findings,
      executionTime: Date.now() - startedAt,
      errors,
      error:
        args.via_ir && !success
          ? "SLITHER_VIA_IR_ANALYSIS_FAILED: direct Foundry analysis failed"
          : undefined,
      failureCode: success ? undefined : "SLITHER_PROJECT_COMPILATION_FAILED",
      ...diagnostics,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    const maybeErrno = error as Error & { code?: string; name?: string }

    if (maybeErrno.code === "ENOENT") {
      return {
        success: false,
        findingsCount: 0,
        findings: [],
        executionTime: Date.now() - startedAt,
        errors: [],
        error: "Slither not found. Install with: pip install slither-analyzer",
        failureCode: "SLITHER_BINARY_UNAVAILABLE",
      }
    }

    if (maybeErrno.name === "AbortError" || context.abort.aborted) {
      return {
        success: false,
        findingsCount: 0,
        findings: [],
        executionTime: Date.now() - startedAt,
        errors: ["Slither analysis aborted"],
        error: "Slither analysis aborted",
        failureCode: "SLITHER_ABORTED",
      }
    }

    return {
      success: false,
      findingsCount: 0,
      findings: [],
      executionTime: Date.now() - startedAt,
      errors: [message],
      error: message,
      failureCode: "SLITHER_EXECUTION_FAILED",
    }
  }
}

export function detectViaIr(target: string, projectDir?: string): boolean {
  const foundryRoot = findFoundryProjectDir(resolve(target), projectDir)
  const foundryTomlPath = join(foundryRoot, "foundry.toml")
  if (!existsSync(foundryTomlPath)) return false
  try {
    const containedConfig = assertContained(foundryTomlPath, projectDir ?? foundryRoot)
    return /^\s*via[_-]ir\s*=\s*true/m.test(readFileSync(containedConfig, "utf-8"))
  } catch (error) {
    if (!(error instanceof PathSafetyError)) logger.debug("Unreadable foundry.toml")
    return false
  }
}

export const slitherTool = tool({
  description: "Run Slither static analysis and return normalized findings for Solidity targets.",
  args: {
    target: tool.schema.string(),
    detectors: tool.schema.array(tool.schema.string()).optional(),
    exclude: tool.schema.array(tool.schema.string()).optional(),
    solc_version: tool.schema.string().optional(),
    via_ir: tool.schema.boolean().optional(),
  },
  async execute(args, context) {
    const projectDir = resolveProjectDir(context)
    const target = validateSlitherTarget(args.target, projectDir)
    if (!target.ok) {
      return JSON.stringify({
        success: false,
        findingsCount: 0,
        findings: [],
        executionTime: 0,
        errors: [target.message],
        error: target.message,
        failureCode: target.code,
      } satisfies SlitherAnalyzeResult)
    }
    const resolvedTarget = target.target
    const viaIr = args.via_ir ?? detectViaIr(resolvedTarget, projectDir)
    const result = await executeSlitherAnalyze(
      { ...args, target: resolvedTarget, via_ir: viaIr },
      context,
      runSlitherCommand,
      projectDir,
    )
    return JSON.stringify(result)
  },
})
