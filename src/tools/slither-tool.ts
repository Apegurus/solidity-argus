import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { type ToolContext, tool } from "@opencode-ai/plugin"
import { createLogger } from "../shared/logger"
import type { Finding, FindingSeverity } from "../state/types"

const logger = createLogger()

import {
  extractContractNames as extractContractNamesShared,
  hasBinary as hasBinaryShared,
  parseSolcVersion as parseSolcVersionShared,
} from "../shared/binary-utils"
import { resolveProjectDir } from "../shared/project-utils"

type SlitherArgs = {
  target: string
  detectors?: string[]
  exclude?: string[]
  solc_version?: string
  via_ir?: boolean
}

type SlitherDetector = {
  check?: string
  impact?: string
  confidence?: string
  description?: string
  elements?: Array<{
    source_mapping?: {
      filename_relative?: string
      lines?: number[]
    }
  }>
}

type SlitherPayload = {
  success?: boolean
  error?: string | null
  results?: {
    detectors?: SlitherDetector[]
  }
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
}

function mapSeverity(impact?: string): FindingSeverity {
  switch (impact) {
    case "High":
      return "High"
    case "Medium":
      return "Medium"
    case "Low":
      return "Low"
    case "Informational":
      return "Informational"
    default:
      return "Informational"
  }
}

function mapConfidence(confidence?: string): "High" | "Medium" | "Low" {
  switch (confidence) {
    case "High":
      return "High"
    case "Medium":
      return "Medium"
    case "Low":
      return "Low"
    default:
      return "Low"
  }
}

function findingLines(lines?: number[]): [number, number] {
  if (!lines || lines.length === 0) {
    return [1, 1]
  }

  if (lines.length === 1) {
    const only = lines[0] ?? 1
    return [only, only]
  }

  const start = lines[0] ?? 1
  const end = lines[lines.length - 1] ?? start
  return [start, end]
}

function createFindingID(check: string, file: string, lines: [number, number]): string {
  const key = `${check}:${file}:${lines[0]}-${lines[1]}`
  return createHash("sha256").update(key).digest("hex").slice(0, 16)
}

function buildCommand(args: SlitherArgs): string[] {
  const command = ["slither", args.target, "--json", "-", "--filter-paths", "node_modules"]

  if (args.detectors && args.detectors.length > 0) {
    command.push("--detect", args.detectors.join(","))
  }

  if (args.exclude && args.exclude.length > 0) {
    command.push("--exclude-detectors", args.exclude.join(","))
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

const parseSolcVersion = parseSolcVersionShared
const extractContractNames = extractContractNamesShared
const hasBinary = hasBinaryShared

async function ensureSolc(version: string): Promise<boolean> {
  if (hasBinary("solc")) return true
  if (!hasBinary("solc-select")) return false
  try {
    const installProc = Bun.spawn(["solc-select", "install", version], {
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(30_000),
    })
    const installExit = await installProc.exited
    if (installExit !== 0) return false

    const useProc = Bun.spawn(["solc-select", "use", version], {
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(30_000),
    })
    const useExit = await useProc.exited
    return useExit === 0
  } catch (_e) {
    return false
  }
}

export const runSlitherCommand: RunSlitherCommand = async (command, signal, cwd) => {
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

export type SpawnFn = (
  command: string[],
  options?: { cwd?: string; timeout?: number },
) => Promise<{ stdout: string; exitCode: number }>

export type FlattenFallbackDeps = {
  runCommand: RunSlitherCommand
  hasBinary: (name: string) => boolean
  ensureSolc: (version: string) => Promise<boolean>
  parseSolcVersion: (target: string) => Promise<string | undefined> | string | undefined
  extractContractNames: (filePath: string) => Promise<string[]> | string[]
  spawnFn: SpawnFn
  cwd: string
}

async function defaultSpawnFn(
  command: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: options?.cwd,
    ...(options?.timeout ? { signal: AbortSignal.timeout(options.timeout) } : {}),
  })
  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  return { stdout, exitCode }
}

function getDefaultFlattenDeps(): FlattenFallbackDeps {
  return {
    runCommand: runSlitherCommand,
    hasBinary,
    ensureSolc,
    parseSolcVersion,
    extractContractNames,
    spawnFn: defaultSpawnFn,
    cwd: process.cwd(),
  }
}

export async function flattenFallback(
  args: SlitherArgs,
  context: ToolContext,
  deps: FlattenFallbackDeps = getDefaultFlattenDeps(),
): Promise<SlitherAnalyzeResult | undefined> {
  const startedAt = Date.now()

  if (!deps.hasBinary("forge")) {
    return {
      success: false,
      findingsCount: 0,
      findings: [],
      executionTime: Date.now() - startedAt,
      errors: ["forge binary not found — required for via_ir flatten fallback"],
      error: "forge binary not found — required for via_ir flatten fallback",
    }
  }

  const solcVersion = args.solc_version ?? (await deps.parseSolcVersion(args.target))
  if (!solcVersion) {
    return {
      success: false,
      findingsCount: 0,
      findings: [],
      executionTime: Date.now() - startedAt,
      errors: [
        "Could not determine solc version from foundry.toml or pragma — required for flatten fallback",
      ],
      error:
        "Could not determine solc version from foundry.toml or pragma — required for flatten fallback",
    }
  }

  if (!(await deps.ensureSolc(solcVersion))) {
    return {
      success: false,
      findingsCount: 0,
      findings: [],
      executionTime: Date.now() - startedAt,
      errors: ["solc not available and solc-select not found"],
      error:
        "Flatten fallback requires solc on PATH. Install with: pipx install solc-select && solc-select install " +
        solcVersion,
    }
  }

  const srcDir = join(args.target, "src")
  let solFiles: string[] = []
  if (args.target.endsWith(".sol")) {
    solFiles = [args.target]
  } else if (existsSync(srcDir)) {
    try {
      const findResult = await deps.spawnFn(
        [
          "find",
          srcDir,
          "-maxdepth",
          "3",
          "-name",
          "*.sol",
          "-not",
          "-path",
          "*/mocks/*",
          "-not",
          "-path",
          "*/test/*",
        ],
        { timeout: 5_000 },
      )
      if (findResult.exitCode !== 0) {
        return {
          success: false,
          findingsCount: 0,
          findings: [],
          executionTime: Date.now() - startedAt,
          errors: ["[flatten-fallback] find command failed — could not discover .sol files"],
        }
      }
      solFiles = findResult.stdout.trim().split("\n").filter(Boolean)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        success: false,
        findingsCount: 0,
        findings: [],
        executionTime: Date.now() - startedAt,
        errors: [`[flatten-fallback] file discovery failed: ${msg}`],
      }
    }
  }

  if (solFiles.length === 0) {
    return {
      success: false,
      findingsCount: 0,
      findings: [],
      executionTime: Date.now() - startedAt,
      errors: ["[flatten-fallback] no .sol files found in target directory"],
    }
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "argus-slither-"))
  const allFindings: Finding[] = []
  const errors: string[] = []

  try {
    for (const solFile of solFiles) {
      if (context.abort.aborted) break

      const baseName = solFile.split("/").pop()?.replace(".sol", "") ?? "Contract"
      const flatFile = join(tmpDir, `${baseName}.flat.sol`)
      const originalContracts = await deps.extractContractNames(solFile)

      try {
        const flatResult = await deps.spawnFn(["forge", "flatten", solFile], {
          cwd: deps.cwd,
          timeout: 30_000,
        })
        if (flatResult.exitCode !== 0) {
          errors.push(`forge flatten failed for ${solFile}`)
          continue
        }
        writeFileSync(flatFile, flatResult.stdout)
      } catch (_e) {
        errors.push(`forge flatten failed for ${solFile}`)
        continue
      }

      const command = ["slither", flatFile, "--json", "-", "--solc-solcs-select", solcVersion]

      try {
        const runResult = await deps.runCommand(command, context.abort, deps.cwd)

        let payload: SlitherPayload
        try {
          payload = JSON.parse(runResult.stdout) as SlitherPayload
        } catch (_e) {
          if (runResult.stderr.trim()) errors.push(runResult.stderr.trim())
          continue
        }

        const rawFindings = parseFindings(payload)
        const filtered =
          originalContracts.length > 0
            ? rawFindings.filter((f) => {
                if (f.file.includes(".flat.sol") || f.file === flatFile) return true
                return originalContracts.some(
                  (name) => f.description.includes(name) || f.file.includes(name),
                )
              })
            : rawFindings

        const remapped = filtered.map((f) => ({
          ...f,
          file: f.file.includes(".flat.sol") ? solFile.replace(`${args.target}/`, "") : f.file,
        }))

        allFindings.push(...remapped)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        errors.push(`Slither flatten fallback failed for ${baseName}: ${msg}`)
      }
    }

    return {
      success: allFindings.length > 0 || errors.length === 0,
      findingsCount: allFindings.length,
      findings: allFindings,
      executionTime: Date.now() - startedAt,
      errors:
        errors.length > 0
          ? [`[flatten-fallback] ${errors.join("; ")}`]
          : ["[flatten-fallback] Analysis completed via forge flatten"],
    }
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch (_cleanupErr) {
      logger.debug("Failed to clean up temp directory")
    }
  }
}

function parseFindings(payload: SlitherPayload): Finding[] {
  const detectors = payload.results?.detectors ?? []

  return detectors.map((detector) => {
    const file = detector.elements?.[0]?.source_mapping?.filename_relative ?? "unknown"
    const lines = findingLines(detector.elements?.[0]?.source_mapping?.lines)
    const check = detector.check ?? "unknown-check"

    return {
      id: createFindingID(check, file, lines),
      check,
      severity: mapSeverity(detector.impact),
      confidence: mapConfidence(detector.confidence),
      description: detector.description ?? "",
      file,
      lines,
      source: "slither",
    }
  })
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
    }
  }

  if (args.via_ir) {
    const fallbackResult = await flattenFallback(args, context, {
      ...getDefaultFlattenDeps(),
      runCommand,
      cwd: projectDir,
    })
    if (fallbackResult) return fallbackResult
    return {
      success: false,
      findingsCount: 0,
      findings: [],
      executionTime: Date.now() - startedAt,
      errors: [
        "via_ir enabled — flatten fallback failed. Ensure forge and solc-select are installed.",
      ],
      error:
        "Project uses via_ir which is incompatible with Slither direct analysis. Flatten fallback also failed.",
    }
  }

  const command = buildCommand(args)

  try {
    const runResult = await runCommand(command, context.abort, projectDir)
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
      if (shouldTryFlattenFallback(errors, runResult.stderr)) {
        const fallbackResult = await flattenFallback(args, context, {
          ...getDefaultFlattenDeps(),
          runCommand,
          cwd: projectDir,
        })
        if (fallbackResult) return fallbackResult
      }
      return {
        success: false,
        findingsCount: 0,
        findings: [],
        executionTime: Date.now() - startedAt,
        errors,
        error: `Slither output parse error: ${message}`,
      }
    }

    if (payload.error) {
      errors.push(payload.error)
    }

    const findings = parseFindings(payload)
    const success = findings.length > 0 || (runResult.exitCode === 0 && payload.success !== false)

    if (!success && findings.length === 0 && shouldTryFlattenFallback(errors, runResult.stderr)) {
      const fallbackResult = await flattenFallback(args, context, {
        ...getDefaultFlattenDeps(),
        runCommand,
        cwd: projectDir,
      })
      if (fallbackResult) return fallbackResult
    }

    return {
      success,
      findingsCount: findings.length,
      findings,
      executionTime: Date.now() - startedAt,
      errors,
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
      }
    }

    return {
      success: false,
      findingsCount: 0,
      findings: [],
      executionTime: Date.now() - startedAt,
      errors: [message],
      error: message,
    }
  }
}

export function detectViaIr(target: string): boolean {
  let dir = resolve(target.endsWith(".sol") ? dirname(target) : target)
  const root = resolve("/")

  while (true) {
    const foundryTomlPath = join(dir, "foundry.toml")
    if (existsSync(foundryTomlPath)) {
      try {
        const content = readFileSync(foundryTomlPath, "utf-8")
        if (/^\s*via[_-]ir\s*=\s*true/m.test(content)) return true
      } catch {
        logger.debug("Unreadable foundry.toml, continuing directory walk")
      }
    }
    if (dir === root) break
    dir = dirname(dir)
  }

  return false
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
    const resolvedTarget = isAbsolute(args.target) ? args.target : resolve(projectDir, args.target)
    const viaIr = args.via_ir ?? detectViaIr(resolvedTarget)
    const result = await executeSlitherAnalyze(
      { ...args, target: resolvedTarget, via_ir: viaIr },
      context,
      runSlitherCommand,
      projectDir,
    )
    return JSON.stringify(result)
  },
})
