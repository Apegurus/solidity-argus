import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import type { ToolContext } from "@opencode-ai/plugin"
import { createLogger } from "../shared/logger"
import { assertContained, PathSafetyError } from "../shared/path-safety"
import type { Finding } from "../state/types"
import type { FlattenFallbackDeps } from "./slither-fallback-runtime"
import {
  createSlitherFindingId,
  parseSlitherFindings,
  type SlitherPayload,
} from "./slither-findings"
import type { SlitherAnalyzeResult } from "./slither-tool"

const logger = createLogger()
export const TRUSTED_SLITHER_CONFIG = fileURLToPath(
  new URL("./trusted-slither.config.json", import.meta.url),
)

type FlattenArgs = {
  readonly target: string
  readonly detectors?: readonly string[]
  readonly exclude?: readonly string[]
  readonly solc_version?: string
}

function failed(startedAt: number, message: string): SlitherAnalyzeResult {
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

function discoverSolidityFiles(target: string, projectDir: string): string[] {
  const canonicalTarget = assertContained(target, projectDir)
  if (statSync(canonicalTarget).isFile())
    return canonicalTarget.endsWith(".sol") ? [canonicalTarget] : []

  const files: string[] = []
  const pending = [canonicalTarget]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || visited.has(current)) continue
    visited.add(current)
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "test" || entry.name === "mocks") continue
      const candidate = assertContained(join(current, entry.name), projectDir)
      const candidateStat = statSync(candidate)
      if (candidateStat.isDirectory()) pending.push(candidate)
      else if (candidateStat.isFile() && candidate.endsWith(".sol")) files.push(candidate)
    }
  }
  return files
}

export async function flattenFallback(
  args: FlattenArgs,
  context: ToolContext,
  deps: FlattenFallbackDeps,
): Promise<SlitherAnalyzeResult> {
  const startedAt = Date.now()
  if (!deps.hasBinary("forge"))
    return failed(startedAt, "forge binary not found — required for flatten fallback")

  const solcVersion =
    args.solc_version ??
    (await deps.parseSolcVersion(deps.cwd)) ??
    (args.target === deps.cwd ? undefined : await deps.parseSolcVersion(args.target))
  if (!solcVersion) {
    return failed(
      startedAt,
      "Could not determine solc version from foundry.toml or pragma — required for flatten fallback",
    )
  }
  if (!(await deps.ensureSolc(solcVersion))) {
    return failed(
      startedAt,
      `Flatten fallback requires solc on PATH. Install with: pipx install solc-select && solc-select install ${solcVersion}`,
    )
  }

  let solFiles: string[] = []
  if (existsSync(args.target)) {
    try {
      solFiles = discoverSolidityFiles(args.target, deps.projectDir)
    } catch (error) {
      const message =
        error instanceof PathSafetyError
          ? "source resolves outside the active project"
          : error instanceof Error
            ? error.message
            : String(error)
      return failed(startedAt, `[flatten-fallback] file discovery failed: ${message}`)
    }
  }
  if (solFiles.length === 0) return failed(startedAt, "[flatten-fallback] no .sol files found")

  const tmpDir = mkdtempSync(join(tmpdir(), "argus-slither-"))
  const findings: Finding[] = []
  const errors: string[] = []
  let completed = 0
  try {
    for (const candidate of solFiles) {
      if (context.abort.aborted) {
        errors.push("Slither analysis aborted")
        break
      }
      let sourceFile: string
      try {
        sourceFile = assertContained(candidate, deps.projectDir)
      } catch (error) {
        if (error instanceof PathSafetyError) {
          errors.push(`source resolves outside the active project: ${candidate}`)
          continue
        }
        throw error
      }
      const baseName = sourceFile.split("/").at(-1)?.replace(".sol", "") ?? "Contract"
      const flattenedFile = join(tmpDir, `${baseName}.flat.sol`)
      try {
        const flattened = await deps.spawnFn(["forge", "flatten", sourceFile], {
          cwd: deps.cwd,
          timeout: 30_000,
        })
        if (flattened.exitCode !== 0) {
          errors.push(`forge flatten failed for ${sourceFile}`)
          continue
        }
        writeFileSync(flattenedFile, flattened.stdout)
        const run = await deps.runCommand(
          [
            "slither",
            flattenedFile,
            "--json",
            "-",
            "--config-file",
            TRUSTED_SLITHER_CONFIG,
            "--solc-solcs-select",
            solcVersion,
            ...(args.detectors && args.detectors.length > 0
              ? ["--detect", args.detectors.join(",")]
              : []),
            ...(args.exclude && args.exclude.length > 0
              ? ["--exclude", args.exclude.join(",")]
              : []),
          ],
          context.abort,
          deps.cwd,
        )
        if (run.exitCode !== 0) {
          errors.push(
            run.stderr.trim() || `Slither exited with code ${run.exitCode} for ${baseName}`,
          )
          continue
        }
        const payload = JSON.parse(run.stdout) as SlitherPayload
        if (payload.success === false || payload.error) {
          errors.push(payload.error ?? `Slither failed for ${baseName}`)
          continue
        }
        const projectFile = relative(deps.projectDir, sourceFile)
        findings.push(
          ...parseSlitherFindings(payload).map((finding) => {
            const location = `${finding.lines[0]}-${finding.lines[1]}`
            const approximateLines: [number, number] = [1, 1]
            return {
              ...finding,
              id: createSlitherFindingId(finding.check, projectFile, finding.lines),
              file: projectFile,
              lines: approximateLines,
              source_location_id: `flattened:${location}`,
              confidence: "Low" as const,
              description: `${finding.description}\n[flatten-fallback] Verify manually in ${projectFile}; detector location refers to flattened source lines ${location}.`,
            }
          }),
        )
        completed++
      } catch (error) {
        errors.push(
          `Slither flatten fallback failed for ${baseName}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    const success = errors.length === 0 && completed === solFiles.length
    return {
      success,
      findingsCount: findings.length,
      findings,
      executionTime: Date.now() - startedAt,
      errors:
        errors.length > 0
          ? [`[flatten-fallback] ${errors.join("; ")}`]
          : ["[flatten-fallback] Analysis completed via forge flatten"],
      error: success ? undefined : "Slither flatten fallback did not complete successfully",
      failureCode: success
        ? undefined
        : context.abort.aborted
          ? "SLITHER_ABORTED"
          : "SLITHER_EXECUTION_FAILED",
    }
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      logger.debug("Failed to clean up temp directory")
    }
  }
}
