import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { type ToolContext, tool } from "@opencode-ai/plugin"
import { loadArgusConfig } from "../config/loader"
import type { ArgusConfig } from "../config/types"
import { readEvents } from "../features/persistent-state/event-sink"
import { resolveRunIdFromOpencodeSession } from "../features/persistent-state/global-run-index"
import { createAuditArtifactResolver } from "../shared/audit-artifact-resolver"
import type { DropDiagnostic } from "../shared/drop-diagnostics"
import { createDropDiagnosticsCollector } from "../shared/drop-diagnostics"
import { computeMissingKeyTools } from "../shared/key-tools"
import { validateFindingLineage } from "../shared/lineage-validator"
import { createLogger } from "../shared/logger"
import { resolveProjectDir } from "../shared/project-utils"
import { resolveReportPath } from "../shared/report-path-resolver"
import { isNonEmptyString } from "../shared/type-guards"
import { SEVERITY_RANK } from "../shared/validation-constants"
import { normalizeToCanonicalFinding } from "../state/adapters"
import {
  compareIssueFingerprintSets,
  dedupeFindingsForFinalOutput,
} from "../state/finding-aggregation"
import { projectFindings, stableHash } from "../state/projectors"
import { type ReportInput, SCHEMA_VERSION, validateReportInput } from "../state/schemas"
import type { ArgusAgentName, AuditState, Finding, FindingSeverity } from "../state/types"
import { checkReportPreflight } from "./report-preflight"

type SeverityThreshold = "critical" | "high" | "medium" | "low" | "informational"

type ToolCoveragePolicy = "enforce" | "warn" | "skip"

type ReportGeneratorArgs = {
  project_name: string
  scope: string[]
  include_executive_summary?: boolean
  severity_threshold?: SeverityThreshold
  quality_gate_policy?: QualityGatePolicy
  report_input?: string
  preflight_policy?: PreflightPolicy
  tool_coverage_policy?: ToolCoveragePolicy
  run_id?: string
  revision?: number
  force?: boolean
}

type FindingsCount = {
  critical: number
  high: number
  medium: number
  low: number
  informational: number
}

export type ReportGenerationResult = {
  report: string
  findingsCount: FindingsCount
  filename: string
  run_id: string
  contentHash: string
  qualityGates: ReportQualityValidation
  contractDiagnostics: DropDiagnostic[]
  filePath?: string
  error?: { code: string; message: string }
}

type QualityGatePolicy = "warn" | "strict-fail"

type PreflightPolicy = "warn" | "strict-fail"

type ReportQualityViolation = {
  findingId: string
  code: string
  message: string
}

type ReportQualityValidation = {
  passed: boolean
  violations: ReportQualityViolation[]
}

export type ReportGenerationDependencies = {
  loadConfig?: (projectDir: string) => ArgusConfig
  readEvents?: (
    runId: string,
    projectDir: string,
  ) => Promise<import("../state/schemas").AuditEvent[]>
  resolveCanonicalRunId?: (sessionId: string, projectDir: string) => string | null | undefined
}

export const SINGLE_WRITER_POLICY_VERSION = "1.0.0"

const REPORT_METADATA_REGEX = /<!-- argus:report_metadata (.+?) -->/

/**
 * Extract the run_id from report metadata embedded as an HTML comment.
 * Returns null if no metadata is found or run_id is missing.
 */
export function extractReportRunId(content: string): string | null {
  const match = content.match(REPORT_METADATA_REGEX)
  if (!match?.[1]) return null
  try {
    const metadata = JSON.parse(match[1])
    return typeof metadata.run_id === "string" ? metadata.run_id : null
  } catch {
    return null
  }
}

function buildReportMetadataComment(runId: string): string {
  const metadata = {
    run_id: runId,
    policy_version: SINGLE_WRITER_POLICY_VERSION,
  }
  return `<!-- argus:report_metadata ${JSON.stringify(metadata)} -->`
}

async function checkDuplicateWrite(
  filePath: string,
  runId: string,
): Promise<{ code: string; message: string } | null> {
  if (!existsSync(filePath)) return null
  try {
    const existingContent = await Bun.file(filePath).text()
    const existingRunId = extractReportRunId(existingContent)
    if (existingRunId === runId) {
      return {
        code: "DUPLICATE_WRITE_ATTEMPT",
        message: `Report for run_id "${runId}" already exists at ${filePath}. Single-writer policy (v${SINGLE_WRITER_POLICY_VERSION}) prevents duplicate writes for the same run.`,
      }
    }
  } catch {
    // Cannot read existing file; allow write
  }
  return null
}

async function checkSafeForceOverwrite(
  filePath: string,
  runId: string,
): Promise<{ code: string; message: string } | null> {
  if (!existsSync(filePath)) return null
  try {
    const existingContent = await Bun.file(filePath).text()
    const existingRunId = extractReportRunId(existingContent)
    if (existingRunId === runId) return null
    return {
      code: "INSECURE_OVERWRITE_REFUSED",
      message:
        existingRunId == null
          ? `Refusing to force overwrite ${filePath}: existing file has no Argus report metadata.`
          : `Refusing to force overwrite ${filePath}: existing report belongs to run_id "${existingRunId}", not "${runId}".`,
    }
  } catch (err) {
    return {
      code: "INSECURE_OVERWRITE_REFUSED",
      message: `Refusing to force overwrite ${filePath}: existing file could not be read (${err instanceof Error ? err.message : String(err)}).`,
    }
  }
}

const THRESHOLD_WEIGHT: Record<SeverityThreshold, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  informational: 1,
}

const FINDING_WEIGHT: Record<FindingSeverity, number> = {
  Critical: 5,
  High: 4,
  Medium: 3,
  Low: 2,
  Informational: 1,
}

/** Sentinel for missing/unknown tool execution timestamps (schema requires startTime > 0). */
const UNKNOWN_TIMESTAMP_SENTINEL = 1

const MISSING_IMPACT_TEXT = "Impact details were not provided in the finding payload."
const MISSING_RECOMMENDATION_TEXT =
  "Recommendation details were not provided in the finding payload."

type ReportFindingFields = {
  impact?: string
  recommendation?: string
  proofOfConcept?: string
}

function emptyCounts(): FindingsCount {
  return {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
  }
}

/**
 * Parse a location string like "File.sol:18-22" or "File.sol:18" into { file, lines }.
 * Returns undefined if the string doesn't match a recognized format.
 */
export function parseLocationString(
  location: string,
): { file: string; lines: [number, number] } | undefined {
  // "File.sol:18-22" or "File.sol:L18-L22"
  const rangeMatch = location.match(/^(.+?):L?(\d+)\s*-\s*L?(\d+)$/)
  if (rangeMatch) {
    const file = rangeMatch.at(1)
    const start = rangeMatch.at(2)
    const end = rangeMatch.at(3)
    if (file && start && end) {
      return { file, lines: [Number(start), Number(end)] }
    }
  }
  // "File.sol:18"
  const singleMatch = location.match(/^(.+?):L?(\d+)$/)
  if (singleMatch) {
    const file = singleMatch.at(1)
    const lineNum = singleMatch.at(2)
    if (file && lineNum) {
      const n = Number(lineNum)
      return { file, lines: [n, n] }
    }
  }
  return undefined
}

/**
 * Normalize a raw finding object from agent output into the canonical field format.
 * Handles common aliases:
 *   - title/name → check
 *   - location (string) → file + lines
 *   - case-insensitive severity → capitalized
 */
export function normalizeRawFinding(raw: Record<string, unknown>): Record<string, unknown> {
  const result = { ...raw }

  // check: accept title, name as aliases
  if (typeof result.check !== "string" || (result.check as string).length === 0) {
    const alias = result.title ?? result.name
    if (typeof alias === "string" && alias.length > 0) {
      result.check = alias
    }
  }

  // file + lines: accept location string as alias.
  // Always attempt to extract lines from location, even when file is already set.
  // LLMs commonly provide both file and location (e.g. file="src/Vault.sol", location="Vault.sol:18-23").
  if (typeof result.location === "string") {
    const parsed = parseLocationString(result.location as string)
    if (parsed) {
      if (typeof result.file !== "string" || (result.file as string).length === 0) {
        result.file = parsed.file
      }
      if (!Array.isArray(result.lines) || (result.lines as unknown[]).length !== 2) {
        result.lines = parsed.lines
      }
    }
  }

  // lines: accept [start] as [start, start], accept line_start/line_end
  if (!Array.isArray(result.lines) || (result.lines as unknown[]).length !== 2) {
    if (Array.isArray(result.lines) && (result.lines as unknown[]).length === 1) {
      const n = Number((result.lines as unknown[])[0])
      if (!Number.isNaN(n)) {
        result.lines = [n, n]
      }
    } else if (typeof result.line_start === "number" && typeof result.line_end === "number") {
      result.lines = [result.line_start, result.line_end]
    } else if (typeof result.line === "number") {
      result.lines = [result.line, result.line]
    }
  }

  // severity: case-insensitive normalization
  if (typeof result.severity === "string") {
    const lower = (result.severity as string).toLowerCase()
    const SEVERITY_MAP: Record<string, string> = {
      critical: "Critical",
      high: "High",
      medium: "Medium",
      low: "Low",
      informational: "Informational",
      info: "Informational",
    }
    const mapped = SEVERITY_MAP[lower]
    if (mapped) {
      result.severity = mapped
    }
  }

  // confidence: case-insensitive normalization
  if (typeof result.confidence === "string") {
    const lower = (result.confidence as string).toLowerCase()
    const CONFIDENCE_MAP: Record<string, string> = {
      high: "High",
      medium: "Medium",
      low: "Low",
    }
    const mapped = CONFIDENCE_MAP[lower]
    if (mapped) {
      result.confidence = mapped
    }
  }

  // description: fall back to check if missing
  if (typeof result.description !== "string" && typeof result.check === "string") {
    result.description = result.check
  }

  if (!Array.isArray(result.lines) || (result.lines as unknown[]).length !== 2) {
    result.lines = [0, 0]
  }

  return result
}

type ParseReportInputResult = {
  reportInput: ReportInput
  diagnostics: DropDiagnostic[]
}

const VALID_AGENT_VALUES = new Set<ArgusAgentName>([
  "argus",
  "sentinel",
  "pythia",
  "audit-specialist",
  "scribe",
  "unknown",
])

function normalizeDedupedFindings(
  rawFindings: unknown[],
  runId: string,
  projectDir: string,
  dedupedBy: string,
): Record<string, unknown>[] {
  const reportedByAgent: ArgusAgentName = VALID_AGENT_VALUES.has(dedupedBy as ArgusAgentName)
    ? (dedupedBy as ArgusAgentName)
    : "scribe"
  return rawFindings.map((raw, index) => {
    const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
    const normalized = normalizeRawFinding(input)
    const result = normalizeToCanonicalFinding(
      normalized,
      runId,
      index + 1,
      { reportedByAgent },
      projectDir,
    )
    return result.data as unknown as Record<string, unknown>
  })
}

function diagnosticsSummary(diagnostics: DropDiagnostic[]): string {
  return diagnostics.map((diag) => `${diag.reason.code}:${diag.reason.message}`).join("; ")
}

function throwContractMismatch(message: string, diagnostics: DropDiagnostic[]): never {
  const details = diagnosticsSummary(diagnostics)
  const fullMessage = details.length > 0 ? `${message}. Diagnostics: ${details}` : message
  throw new Error(fullMessage)
}

function reportInputToAuditState(reportInput: ReportInput): AuditState {
  return {
    sessionId: reportInput.session_id,
    projectDir: reportInput.projectDir,
    contractsReviewed: Array.from(
      new Set(reportInput.findings.map((finding) => finding.file)),
    ).sort((a, b) => a.localeCompare(b)),
    findings: reportInput.findings,
    toolsExecuted: reportInput.toolsExecuted,
    currentPhase: "complete",
    scope: reportInput.scope,
    startTime: 0,
    soloditResults: reportInput.soloditResults,
    fuzzCounterexamples: reportInput.fuzzCounterexamples,
    coverageReport: reportInput.coverageReport,
    gasHotspots: reportInput.gasHotspots,
    proxyContracts: reportInput.proxyContracts,
    patternVersion: reportInput.patternVersion,
    skillsLoaded: reportInput.skillsLoaded,
    unavailableTools: reportInput.unavailableTools,
  }
}

function normalizeToolsExecutedDefaults(
  parsed: unknown,
  expectedRunId: string | undefined,
  diagnostics: ReturnType<typeof createDropDiagnosticsCollector>,
): void {
  if (!parsed || typeof parsed !== "object") return
  const obj = parsed as Record<string, unknown>
  if (!Array.isArray(obj.toolsExecuted)) return

  const runId = (typeof obj.run_id === "string" && obj.run_id) || expectedRunId || "unknown"
  let patched = false

  for (const entry of obj.toolsExecuted) {
    if (!entry || typeof entry !== "object") continue
    const rec = entry as Record<string, unknown>
    if (typeof rec.startTime !== "number" || rec.startTime <= 0) {
      rec.startTime = UNKNOWN_TIMESTAMP_SENTINEL
      patched = true
    }
    if (typeof rec.success !== "boolean") {
      rec.success = true
      patched = true
    }
    if (typeof rec.findingsCount !== "number" || rec.findingsCount < 0) {
      rec.findingsCount = 0
      patched = true
    }
    if (!isNonEmptyString(rec.run_id)) {
      rec.run_id = runId
      patched = true
    }
    if (!isNonEmptyString(rec.schema_version)) {
      rec.schema_version = SCHEMA_VERSION
      patched = true
    }
  }

  if (patched) {
    diagnostics.warn(
      "REPORT_INPUT_TOOLS_EXECUTED_NORMALIZED",
      "toolsExecuted entries were missing canonical fields (startTime, success, findingsCount, run_id, schema_version); defaults applied.",
      "toolsExecuted",
    )
  }
}

function resolveExpectedRunId(
  args: ReportGeneratorArgs,
  context: ToolContext,
  deps: ReportGenerationDependencies,
): string | undefined {
  // 1. Explicit run_id from LLM args (highest priority)
  if (isNonEmptyString(args.run_id)) {
    return args.run_id.trim()
  }

  // 2. Global run index lookup by session ID
  const sessionId = context.sessionID
  const projectDir = resolveProjectDir(context)
  if (isNonEmptyString(sessionId)) {
    const resolveCanonicalRunId = deps.resolveCanonicalRunId ?? resolveRunIdFromOpencodeSession
    const resolved = resolveCanonicalRunId(sessionId, projectDir)
    if (isNonEmptyString(resolved)) {
      return resolved
    }
  }

  // When caller provides inline report_input, skip filesystem discovery —
  // the caller already has their data and filesystem state may belong to a different run.
  if (isNonEmptyString(args.report_input)) {
    return undefined
  }

  // 3. Per-session state files (per-session managers write to sessions/state-{sessionId}.json)
  const STALE_STATE_TTL_MS = 24 * 60 * 60 * 1000
  const sessionsDir = path.join(projectDir, ".argus", "sessions")
  try {
    const entries = readdirSync(sessionsDir)
    const stateFiles = entries.filter((e) => e.startsWith("state-") && e.endsWith(".json"))
    const ranked = stateFiles
      .map((name) => {
        const filePath = path.join(sessionsDir, name)
        try {
          return { name, path: filePath, mtime: statSync(filePath).mtimeMs }
        } catch {
          return null
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => b.mtime - a.mtime)

    for (const entry of ranked) {
      try {
        const stateRaw = JSON.parse(readFileSync(entry.path, "utf-8")) as Record<string, unknown>
        const stateSessionId = stateRaw.sessionId
        const savedAt = typeof stateRaw.savedAt === "number" ? stateRaw.savedAt : 0
        const isFresh = Date.now() - savedAt < STALE_STATE_TTL_MS
        if (
          typeof stateSessionId === "string" &&
          stateSessionId.trim().length > 0 &&
          !stateSessionId.startsWith("ses_") &&
          isFresh
        ) {
          const resolver = createAuditArtifactResolver(stateSessionId, projectDir)
          const hasArtifacts =
            existsSync(resolver.paths().reportInputFile) || existsSync(resolver.paths().journalFile)
          if (hasArtifacts) {
            return stateSessionId
          }
        }
      } catch {
        /* skip unreadable session file */
      }
    }
  } catch {
    /* sessions dir doesn't exist */
  }

  // 4. Shared audit state (legacy fallback)
  try {
    const sharedStatePath = path.join(projectDir, ".argus", "argus-state.json")
    if (existsSync(sharedStatePath)) {
      const stateRaw = JSON.parse(readFileSync(sharedStatePath, "utf-8")) as Record<string, unknown>
      const stateSessionId = stateRaw.sessionId
      const savedAt = typeof stateRaw.savedAt === "number" ? stateRaw.savedAt : 0
      const isFresh = Date.now() - savedAt < STALE_STATE_TTL_MS
      if (
        typeof stateSessionId === "string" &&
        stateSessionId.trim().length > 0 &&
        !stateSessionId.startsWith("ses_") &&
        isFresh
      ) {
        const resolver = createAuditArtifactResolver(stateSessionId, projectDir)
        const hasArtifacts =
          existsSync(resolver.paths().reportInputFile) || existsSync(resolver.paths().journalFile)
        if (hasArtifacts) {
          return stateSessionId
        }
      }
    }
  } catch {
    /* fallback path */
  }

  return undefined
}

function finalizeReportInputSelection(
  reportInput: ReportInput,
  diagnostics: ReturnType<typeof createDropDiagnosticsCollector>,
  expectedRunId?: string,
): ParseReportInputResult {
  if (reportInput.run_id.startsWith("ses_")) {
    diagnostics.error(
      "REPORT_INPUT_RUN_ID_MISMATCH",
      "ReportInput run_id must be a canonical run identifier, not an OpenCode session id (ses_*).",
      "run_id",
    )
    throwContractMismatch(
      "ReportInput contract mismatch: run_id/session_id conflation detected",
      diagnostics.getDiagnostics(),
    )
  }

  if (expectedRunId && reportInput.run_id !== expectedRunId) {
    diagnostics.error(
      "REPORT_INPUT_CANONICAL_RUN_MISMATCH",
      `ReportInput run_id ${reportInput.run_id} does not match canonical run_id ${expectedRunId}.`,
      "run_id",
    )
    throwContractMismatch(
      "ReportInput contract mismatch: report_input run_id diverges from canonical run_id",
      diagnostics.getDiagnostics(),
    )
  }

  return { reportInput, diagnostics: diagnostics.getDiagnostics() }
}

function parseReportInputPayload(
  args: ReportGeneratorArgs,
  context: ToolContext,
  expectedRunId: string | undefined,
): ParseReportInputResult {
  const diagnostics = createDropDiagnosticsCollector(
    "warn",
    "report-generator",
    "argus_generate_report",
  )

  if (isNonEmptyString(args.report_input)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(args.report_input)
    } catch {
      diagnostics.error(
        "REPORT_INPUT_MALFORMED_JSON",
        "report_input is not valid JSON. Expected serialized ReportInput object.",
        "report_input",
      )
      throwContractMismatch(
        "ReportInput contract mismatch: malformed report_input JSON",
        diagnostics.getDiagnostics(),
      )
    }

    normalizeToolsExecutedDefaults(parsed, expectedRunId, diagnostics)

    const validation = validateReportInput(parsed)
    if (!validation.success) {
      for (const error of validation.errors) {
        diagnostics.warn(
          "REPORT_INPUT_INLINE_VALIDATION_FAILED",
          `${error.field}: ${error.message}`,
          error.field,
        )
      }
      diagnostics.warn(
        "REPORT_INPUT_INLINE_FALLTHROUGH",
        `Inline report_input failed validation (${validation.errors.length} errors). Falling back to disk artifact.`,
        "report_input",
      )
    } else {
      return finalizeReportInputSelection(validation.data, diagnostics, expectedRunId)
    }
  }

  const effectiveRunId =
    (isNonEmptyString(args.run_id) ? args.run_id.trim() : undefined) ?? expectedRunId

  if (isNonEmptyString(effectiveRunId)) {
    const projectDir = resolveProjectDir(context)
    const resolver = createAuditArtifactResolver(effectiveRunId, projectDir)

    const dedupedFile = resolver.paths().dedupedFindingsFile
    if (existsSync(dedupedFile)) {
      try {
        const dedupedArtifact = JSON.parse(readFileSync(dedupedFile, "utf-8")) as {
          findings?: unknown[]
          dropped_observations?: unknown[]
          deduped_by?: string
        }
        if (Array.isArray(dedupedArtifact.findings) && dedupedArtifact.findings.length > 0) {
          const reportInputFile = resolver.paths().reportInputFile
          let baseInput: Record<string, unknown> = {}
          if (existsSync(reportInputFile)) {
            try {
              baseInput = JSON.parse(readFileSync(reportInputFile, "utf-8")) as Record<
                string,
                unknown
              >
            } catch {
              /* use empty base */
            }
          }
          const normalizedFindings = normalizeDedupedFindings(
            dedupedArtifact.findings,
            effectiveRunId,
            projectDir,
            typeof dedupedArtifact.deduped_by === "string" ? dedupedArtifact.deduped_by : "scribe",
          )
          const merged: Record<string, unknown> = {
            ...baseInput,
            run_id: effectiveRunId,
            findings: normalizedFindings,
            dropped_observations: Array.isArray(dedupedArtifact.dropped_observations)
              ? dedupedArtifact.dropped_observations
              : baseInput.dropped_observations,
          }
          normalizeToolsExecutedDefaults(merged, effectiveRunId, diagnostics)
          if (typeof merged.seq !== "number" || (merged.seq as number) < 0) {
            merged.seq = 0
          }
          if (typeof merged.session_id !== "string" || (merged.session_id as string).length === 0) {
            merged.session_id = "unknown"
          }
          if (
            typeof merged.tool_call_id !== "string" ||
            (merged.tool_call_id as string).length === 0
          ) {
            merged.tool_call_id = `deduped:${effectiveRunId}`
          }
          if (typeof merged.source !== "string" || (merged.source as string).length === 0) {
            merged.source = "deduped-findings"
          }
          if (
            typeof merged.schema_version !== "string" ||
            merged.schema_version !== SCHEMA_VERSION
          ) {
            merged.schema_version = SCHEMA_VERSION
          }
          if (typeof merged.projectDir !== "string" || (merged.projectDir as string).length === 0) {
            merged.projectDir = projectDir
          }
          if (!Array.isArray(merged.scope)) {
            merged.scope = []
          }
          if (!Array.isArray(merged.toolsExecuted)) {
            merged.toolsExecuted = []
          }
          const validation = validateReportInput(merged)
          if (validation.success) {
            return finalizeReportInputSelection(validation.data, diagnostics, expectedRunId)
          }
          for (const error of validation.errors) {
            diagnostics.warn(
              "REPORT_INPUT_DEDUPED_VALIDATION_FAILED",
              `${error.field}: ${error.message}`,
              error.field,
            )
          }
        }
      } catch {
        /* deduped file unreadable — fall through to report-input.json */
      }
    }

    const reportInputFile = resolver.paths().reportInputFile
    if (existsSync(reportInputFile)) {
      diagnostics.warn(
        "REPORT_INPUT_DISK_FALLBACK",
        `No report_input provided; reading materialized report-input.json from disk for run ${effectiveRunId}.`,
        "report_input",
      )
      let parsed: unknown
      try {
        parsed = JSON.parse(readFileSync(reportInputFile, "utf-8"))
      } catch {
        diagnostics.error(
          "REPORT_INPUT_DISK_CORRUPT",
          `Materialized report-input.json for run ${effectiveRunId} is not valid JSON.`,
          "report_input",
        )
        throwContractMismatch(
          "ReportInput contract mismatch: corrupted disk artifact",
          diagnostics.getDiagnostics(),
        )
      }
      const validation = validateReportInput(parsed)
      if (!validation.success) {
        for (const error of validation.errors) {
          diagnostics.error(
            "REPORT_INPUT_DISK_VALIDATION_FAILED",
            `${error.field}: ${error.message}`,
            error.field,
          )
        }
        throwContractMismatch(
          "ReportInput contract mismatch: disk artifact failed schema validation",
          diagnostics.getDiagnostics(),
        )
      }
      return finalizeReportInputSelection(validation.data, diagnostics, expectedRunId)
    }
  }
  diagnostics.error(
    "REPORT_INPUT_MISSING",
    `Missing report_input payload. args.run_id=${args.run_id ?? "undefined"}, expectedRunId=${expectedRunId ?? "undefined"}. Provide report_input (preferred) or run_id for disk fallback.`,
    "report_input",
  )
  throwContractMismatch(
    "ReportInput contract mismatch: missing required payload",
    diagnostics.getDiagnostics(),
  )
}

function normalizeTitle(check: string): string {
  if (!check || typeof check !== "string") return "Unknown Check"
  return check
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ")
}

function formatLocation(finding: Finding): string {
  if (!finding.file || !Array.isArray(finding.lines) || finding.lines.length < 2)
    return "unknown location"
  return `${finding.file}:${finding.lines[0]}-${finding.lines[1]}`
}

function sourceExcerpt(projectDir: string, finding: Finding): string | null {
  if (!finding.file || !Array.isArray(finding.lines) || finding.lines.length < 2) return null
  const start = finding.lines[0]
  const end = finding.lines[1]
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
    return null
  }
  const absolutePath = path.isAbsolute(finding.file)
    ? finding.file
    : path.join(projectDir, finding.file)
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) return null
  const contents = readFileSync(absolutePath, "utf-8").split(/\r?\n/)
  const excerpt = contents.slice(start - 1, end).join("\n")
  return excerpt.trim().length > 0 ? excerpt : null
}

function shouldIncludeFinding(finding: Finding, threshold: SeverityThreshold): boolean {
  return FINDING_WEIGHT[finding.severity] >= THRESHOLD_WEIGHT[threshold]
}

function normalizeScopePath(value: string): string {
  return value.replace(/^\.\//, "").replace(/\/+$|\\+$/g, "")
}

function isFindingInScope(finding: Finding, scope: string[]): boolean {
  if (scope.length === 0) return true
  const file = normalizeScopePath(finding.file)
  return scope.some((entry) => {
    const scoped = normalizeScopePath(entry)
    return file === scoped || file.startsWith(`${scoped}/`)
  })
}

function collectOutOfScopeFindings(findings: Finding[], scope: string[]): Finding[] {
  return findings.filter((finding) => !isFindingInScope(finding, scope))
}

function calculateCounts(findings: Finding[]): FindingsCount {
  const counts = emptyCounts()

  for (const finding of findings) {
    if (finding.severity === "Critical") counts.critical += 1
    if (finding.severity === "High") counts.high += 1
    if (finding.severity === "Medium") counts.medium += 1
    if (finding.severity === "Low") counts.low += 1
    if (finding.severity === "Informational") counts.informational += 1
  }

  return counts
}

function overallRiskAssessment(counts: FindingsCount): string {
  if (counts.critical > 0) return "Critical risk"
  if (counts.high > 0) return "High risk"
  if (counts.medium > 0) return "Medium risk"
  if (counts.low > 0) return "Low risk"
  if (counts.informational > 0) return "Informational only"
  return "No significant risk identified"
}

function genericImpact(severity: FindingSeverity): string {
  if (severity === "Critical") {
    return "Could lead to immediate and severe compromise of funds or protocol control."
  }
  if (severity === "High") {
    return "Could materially impact protocol security, user funds, or system integrity."
  }
  if (severity === "Medium") {
    return "Could cause operational issues or increase exploitability under specific conditions."
  }
  if (severity === "Low") {
    return "Limited direct impact but should be addressed to improve security posture."
  }
  return "No immediate exploit impact, but useful for hardening and maintainability."
}

function genericRecommendation(severity: FindingSeverity): string {
  if (severity === "Critical" || severity === "High") {
    return "Prioritize remediation before production deployment and validate with focused regression tests."
  }
  if (severity === "Medium") {
    return "Address in the near term and include unit/integration tests to prevent regressions."
  }
  if (severity === "Low") {
    return "Schedule remediation in regular hardening cycles."
  }
  return "Track and resolve during routine code quality and documentation improvements."
}

function getExtendedFinding(finding: Finding): Finding & ReportFindingFields {
  return finding as Finding & ReportFindingFields
}

function getFindingImpact(finding: Finding): string {
  const extended = getExtendedFinding(finding)
  if (isNonEmptyString(extended.impact)) {
    return extended.impact.trim()
  }
  return MISSING_IMPACT_TEXT
}

function getFindingRecommendation(finding: Finding): string {
  const extended = getExtendedFinding(finding)
  if (isNonEmptyString(extended.recommendation)) {
    return extended.recommendation.trim()
  }
  if (isNonEmptyString(finding.remediation)) {
    return finding.remediation.trim()
  }
  return MISSING_RECOMMENDATION_TEXT
}

function getPocEvidence(finding: Finding): string | undefined {
  const extended = getExtendedFinding(finding)
  if (isNonEmptyString(extended.proofOfConcept)) {
    return extended.proofOfConcept.trim()
  }
  if (isNonEmptyString(finding.exploitReference)) {
    return finding.exploitReference.trim()
  }
  return undefined
}

function compareFindingsDeterministically(a: Finding, b: Finding): number {
  const severityDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  if (severityDelta !== 0) return severityDelta

  const fileDelta = a.file.localeCompare(b.file)
  if (fileDelta !== 0) return fileDelta

  const lineDelta = (a.lines[0] ?? 0) - (b.lines[0] ?? 0)
  if (lineDelta !== 0) return lineDelta

  return a.id.localeCompare(b.id)
}

function sortFindingsDeterministically(findings: Finding[]): Finding[] {
  return [...findings].sort(compareFindingsDeterministically)
}

function sortFindingsByConfidence(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const aHas = typeof a.confidence_score === "number"
    const bHas = typeof b.confidence_score === "number"
    if (aHas && !bHas) return -1
    if (!aHas && bHas) return 1
    if (aHas && bHas && a.confidence_score !== b.confidence_score) {
      const aScore = a.confidence_score as number
      const bScore = b.confidence_score as number
      return bScore - aScore
    }

    const severityDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (severityDelta !== 0) return severityDelta

    const fileDelta = a.file.localeCompare(b.file)
    if (fileDelta !== 0) return fileDelta

    const lineDelta = (a.lines[0] ?? 0) - (b.lines[0] ?? 0)
    if (lineDelta !== 0) return lineDelta

    return a.id.localeCompare(b.id)
  })
}

function splitFindingsByTier(
  findings: Finding[],
  threshold: number,
): { findings: Finding[]; leads: Finding[] } {
  const findingsTier: Finding[] = []
  const leadsTier: Finding[] = []
  for (const finding of findings) {
    if (typeof finding.confidence_score === "number" && finding.confidence_score < threshold) {
      leadsTier.push(finding)
    } else {
      findingsTier.push(finding)
    }
  }
  return { findings: findingsTier, leads: leadsTier }
}

function hasObservationIds(finding: Finding): boolean {
  const observationIds = (finding as { observation_ids?: unknown }).observation_ids
  return Array.isArray(observationIds) && observationIds.length > 0
}

function hasCompleteDedupLineage(findings: Finding[]): boolean {
  return findings.length > 0 && findings.every(hasObservationIds)
}

function hasPartialDedupLineage(findings: Finding[]): boolean {
  const withLineage = findings.some(hasObservationIds)
  const withoutLineage = findings.some((finding) => {
    const observationIds = (finding as { observation_ids?: unknown }).observation_ids
    return !Array.isArray(observationIds) || observationIds.length === 0
  })
  return withLineage && withoutLineage
}

export function validateReportQuality(
  findings: Finding[],
  policy: QualityGatePolicy,
): ReportQualityValidation {
  const violations: ReportQualityViolation[] = []

  for (const finding of findings) {
    const findingId = finding.id
    const impact = getFindingImpact(finding)
    const recommendation = getFindingRecommendation(finding)
    const severity = finding.severity

    if (!finding.id || !finding.check || !finding.file || !Array.isArray(finding.lines)) {
      violations.push({
        findingId,
        code: "schema.missing-required",
        message: "Finding is missing required fields for deterministic report rendering.",
      })
    }

    if (!finding.description || finding.description.trim().length === 0) {
      violations.push({
        findingId,
        code: "completeness.missing-description",
        message: "Finding description must be non-empty.",
      })
    }

    if (!finding.source || finding.source.trim().length === 0) {
      violations.push({
        findingId,
        code: "provenance.missing-source",
        message: "Finding source is required for provenance traceability.",
      })
    }

    if (severity !== "Critical" && severity !== "High") {
      continue
    }

    if (
      impact.length === 0 ||
      impact === MISSING_IMPACT_TEXT ||
      impact === genericImpact(severity)
    ) {
      violations.push({
        findingId,
        code: "severity-justification.missing-impact",
        message: `${severity} findings must include specific non-generic impact details.`,
      })
    }

    if (
      recommendation.length === 0 ||
      recommendation === MISSING_RECOMMENDATION_TEXT ||
      recommendation === genericRecommendation(severity)
    ) {
      violations.push({
        findingId,
        code: "severity-justification.missing-recommendation",
        message: `${severity} findings must include specific non-generic recommendations.`,
      })
    }

    if (getPocEvidence(finding) == null) {
      violations.push({
        findingId,
        code: "severity-justification.missing-poc",
        message: `${severity} findings must satisfy PoC policy with exploitReference or proofOfConcept.`,
      })
    }
  }

  if (policy === "warn" && violations.length > 0) {
    const logger = createLogger()
    logger.warn(`[report-generator] quality gates failed with ${violations.length} violation(s)`)
    for (const violation of violations) {
      logger.warn(
        `[report-generator] [${violation.code}] finding=${violation.findingId}: ${violation.message}`,
      )
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  }
}

function buildRecommendations(counts: FindingsCount): string[] {
  const items: string[] = []

  if (counts.critical > 0) {
    items.push(
      "1. Immediately remediate all Critical findings and block release until fixes are verified.",
    )
  }
  if (counts.high > 0) {
    items.push(
      "2. Prioritize High findings in the next patch cycle with dedicated security test coverage.",
    )
  }
  if (counts.medium > 0) {
    items.push("3. Resolve Medium findings to reduce attack surface and improve resilience.")
  }
  if (counts.low > 0 || counts.informational > 0) {
    items.push(
      "4. Address Low/Informational findings as part of ongoing hardening and code quality efforts.",
    )
  }

  if (items.length === 0) {
    items.push(
      "1. Maintain current controls, monitor code changes, and re-audit before major upgrades.",
    )
  }

  return items
}

function buildFindingsSection(findings: Finding[], projectDir: string): string {
  if (findings.length === 0) {
    return ""
  }

  const lines: string[] = ["## Findings"]

  for (const finding of findings) {
    const recommendation = getFindingRecommendation(finding)
    const impact = getFindingImpact(finding)

    lines.push(renderFindingHeader(finding, "finding"))
    lines.push(`**Severity**: ${finding.severity}`)
    lines.push(`**Confidence**: ${finding.confidence}`)
    lines.push(`**Location**: ${formatLocation(finding)}`)
    const excerpt = sourceExcerpt(projectDir, finding)
    if (excerpt) {
      lines.push("")
      lines.push("**Source Excerpt**:")
      lines.push("")
      lines.push("```solidity")
      lines.push(excerpt)
      lines.push("```")
    }
    lines.push("")
    lines.push(`**Description**: ${renderFindingBody(finding)}`)
    lines.push("")
    lines.push(`**Impact**: ${impact}`)
    lines.push("")
    lines.push(`**Recommendation**: ${recommendation}`)
    const pocEvidence = getPocEvidence(finding)
    if (pocEvidence) {
      lines.push("")
      lines.push(`**PoC / Evidence**: ${pocEvidence}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

function renderFindingHeader(finding: Finding, tier: "finding" | "lead"): string {
  const prefix =
    typeof finding.confidence_score === "number"
      ? `[${finding.confidence_score}] `
      : ""
  return `### ${prefix}${normalizeTitle(finding.check)} · severity: ${finding.severity} · evidence: ${finding.confidence}`
}

function hasRubricTrace(f: Finding): boolean {
  return (
    typeof f.description === "string" && f.description.trimStart().startsWith("**Rubric Trace**")
  )
}

function renderFindingBody(f: Finding): string {
  const annotation = hasRubricTrace(f)
    ? ""
    : "⚠️ no rubric trace — this finding was emitted without applying the 4-gate refutation rubric.\n\n"
  return annotation + (f.description ?? "")
}

function renderAdoptionFooter(findings: Finding[]): string {
  if (findings.length === 0) return ""
  const withTrace = findings.filter(hasRubricTrace).length
  return `\n\n---\n\n_Rubric: ${withTrace}/${findings.length} findings include 4-gate trace_\n`
}

function buildLeadsSection(findings: Finding[]): string {
  if (findings.length === 0) {
    return ""
  }

  const lines: string[] = ["## Leads"]

  for (const finding of findings) {
    lines.push(renderFindingHeader(finding, "lead"))
    lines.push("")
    lines.push(`**Description**: ${renderFindingBody(finding)}`)
    lines.push("")
  }

  return lines.join("\n")
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function buildProvenanceAppendix(
  state: AuditState,
  threshold: SeverityThreshold,
  reportFindings: Finding[],
): string {
  const lines: string[] = ["## Appendix: Data Provenance"]

  lines.push("- Data source: `report_input` payload")
  lines.push(`- Severity threshold applied: ${threshold}`)
  lines.push(`- Findings included in report: ${reportFindings.length}`)

  if (reportFindings.length > 0) {
    const sourceCounts: Record<string, number> = {}
    for (const f of reportFindings) {
      sourceCounts[f.source] = (sourceCounts[f.source] ?? 0) + 1
    }
    lines.push("")
    lines.push("### Source Breakdown")
    lines.push("")
    lines.push("| Source | Count |")
    lines.push("| --- | ---: |")
    for (const [source, count] of Object.entries(sourceCounts).sort((a, b) => {
      const countDelta = b[1] - a[1]
      if (countDelta !== 0) return countDelta
      return a[0].localeCompare(b[0])
    })) {
      lines.push(`| ${source} | ${count} |`)
    }
  }

  if (state.toolsExecuted.length > 0) {
    lines.push("")
    lines.push("### Tool Execution Summary")
    lines.push("")
    lines.push("| Tool | Duration | Status | Findings |")
    lines.push("| --- | --- | --- | ---: |")
    for (const exec of state.toolsExecuted) {
      const toolName = typeof exec.tool === "string" && exec.tool ? exec.tool : "(unknown tool)"
      const hasTimes =
        typeof exec.startTime === "number" &&
        !Number.isNaN(exec.startTime) &&
        exec.endTime != null &&
        typeof exec.endTime === "number" &&
        !Number.isNaN(exec.endTime)
      const duration = hasTimes ? formatDuration((exec.endTime as number) - exec.startTime) : "N/A"
      const status =
        typeof exec.success === "boolean"
          ? exec.success
            ? "\u2705 success"
            : "\u274C failure"
          : "\u26A0 malformed"
      const findings =
        typeof exec.findingsCount === "number" && !Number.isNaN(exec.findingsCount)
          ? exec.findingsCount
          : "N/A"
      lines.push(`| ${toolName} | ${duration} | ${status} | ${findings} |`)
    }
  }

  const syncExec = state.toolsExecuted.find((t) => t.tool === "argus_sync_knowledge")
  if (state.patternVersion || syncExec) {
    lines.push("")
    lines.push("### Data Freshness")
    lines.push("")
    if (state.patternVersion) {
      lines.push(`- Pattern pack version: \`${state.patternVersion}\``)
    }
    if (syncExec) {
      const syncTime =
        typeof syncExec.startTime === "number" && !Number.isNaN(syncExec.startTime)
          ? new Date(syncExec.startTime).toISOString()
          : "N/A"
      lines.push(`- SCVD last synced: ${syncTime}`)
    }
  }

  if (state.soloditResults && state.soloditResults.length > 0) {
    lines.push("")
    lines.push("### Solodit Cross-References")
    lines.push("")
    for (const result of state.soloditResults) {
      lines.push(`**Query**: "${result.query}" — ${result.resultCount} results`)
      if (result.topResults.length > 0) {
        lines.push("")
        lines.push("| Title | Severity | Protocol |")
        lines.push("| --- | --- | --- |")
        for (const top of result.topResults) {
          lines.push(`| ${top.title} | ${top.severity} | ${top.protocol} |`)
        }
      }
      lines.push("")
    }
  }

  if (state.fuzzCounterexamples && state.fuzzCounterexamples.length > 0) {
    lines.push("")
    lines.push("### Fuzz Evidence")
    lines.push("")
    lines.push("| Test | Inputs | Runs | Revert Reason |")
    lines.push("| --- | --- | ---: | --- |")
    for (const cx of state.fuzzCounterexamples) {
      const inputs = cx.inputs.join(", ")
      const reason = cx.revertReason ?? "—"
      lines.push(`| ${cx.testName} | ${inputs} | ${cx.runs} | ${reason} |`)
    }
  }

  if (state.skillsLoaded && state.skillsLoaded.length > 0) {
    lines.push("")
    lines.push("### Knowledge Sources")
    lines.push("")
    lines.push("Skills loaded during this audit:")
    lines.push("")
    for (const skill of state.skillsLoaded) {
      lines.push(`- ${skill}`)
    }
  }

  return lines.join("\n")
}

export type RenderReportOptions = {
  threshold?: number
  projectName?: string
  include_executive_summary?: boolean
  severity_threshold?: SeverityThreshold
  scope?: string[]
  preflightWarningSection?: string | null
  runId?: string
}

export function renderReportMarkdown(
  input: ReportInput,
  options: RenderReportOptions = {},
): string {
  const projectName = options.projectName ?? "Unknown Project"
  const includeExecutiveSummary = options.include_executive_summary ?? true
  const threshold = options.severity_threshold ?? "informational"
  const confidenceThreshold = options.threshold ?? 80
  const preflightWarningSection = options.preflightWarningSection ?? null
  const toolsExecuted = input.toolsExecuted ?? []
  const state = reportInputToAuditState({ ...input, toolsExecuted })
  const scope = options.scope ?? input.scope ?? []
  const finalFindings = dedupeFindingsForFinalOutput(input.findings)
  const reportFindings = sortFindingsDeterministically(
    finalFindings.filter((finding) => shouldIncludeFinding(finding, threshold)),
  )
  const tiers = splitFindingsByTier(reportFindings, confidenceThreshold)
  const findings = sortFindingsByConfidence(tiers.findings)
  const leads = sortFindingsByConfidence(tiers.leads)
  const counts = calculateCounts(findings)
  const runStartTime = toolsExecuted.reduce(
    (earliest, exec) =>
      typeof exec.startTime === "number" &&
      exec.startTime > UNKNOWN_TIMESTAMP_SENTINEL &&
      exec.startTime < earliest
        ? exec.startTime
        : earliest,
    Number.MAX_SAFE_INTEGER,
  )
  const auditDate =
    runStartTime < Number.MAX_SAFE_INTEGER
      ? new Date(runStartTime).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)

  const sections: string[] = [`# Security Audit Report — ${projectName}`]

  if (includeExecutiveSummary) {
    sections.push("## Executive Summary")
    sections.push(
      `This report summarizes security findings identified for ${projectName} based on static analysis, testing, and pattern-based review.`,
    )
    sections.push("")
    sections.push("| Severity | Count |")
    sections.push("| --- | ---: |")
    sections.push(`| Critical | ${counts.critical} |`)
    sections.push(`| High | ${counts.high} |`)
    sections.push(`| Medium | ${counts.medium} |`)
    sections.push(`| Low | ${counts.low} |`)
    sections.push(`| Informational | ${counts.informational} |`)
    sections.push("")
    sections.push(`Overall risk assessment: ${overallRiskAssessment(counts)}.`)
  }

  sections.push("## Scope")
  sections.push("Contracts in scope:")
  if (scope.length === 0) {
    sections.push("- None provided")
  } else {
    for (const contract of scope) {
      sections.push(`- ${contract}`)
    }
  }
  sections.push(`Audit date: ${auditDate}`)

  sections.push("## Methodology")
  sections.push("Tools and techniques used:")
  sections.push("- Slither static analysis")
  sections.push("- Foundry tests and fuzzing")
  sections.push("- Pattern Analysis")
  sections.push("- Solodit research cross-referencing")
  sections.push(
    "Approach: Findings are normalized, split into Findings/Leads by confidence threshold, deterministically ordered by confidence/severity/file/line, and validated against report quality gates before emission.",
  )

  const findingsSection = buildFindingsSection(findings, input.projectDir)
  if (findingsSection.length > 0) {
    sections.push(findingsSection)
  }
  const leadsSection = buildLeadsSection(leads)
  if (leadsSection.length > 0) {
    sections.push(leadsSection)
  }

  sections.push("## Recommendations")
  for (const item of buildRecommendations(counts)) {
    sections.push(`- ${item}`)
  }

  if (preflightWarningSection) {
    sections.push(preflightWarningSection)
  }

  sections.push(buildProvenanceAppendix(state, threshold, findings))

  const runId = options.runId ?? input.run_id
  if (runId) {
    sections.push(buildReportMetadataComment(runId))
  }

  const allFindings = [...findings, ...leads]
  return sections.join("\n\n") + renderAdoptionFooter(allFindings)
}

export async function executeReportGeneration(
  args: ReportGeneratorArgs,
  context: ToolContext,
  deps: ReportGenerationDependencies = {},
): Promise<ReportGenerationResult> {
  const includeExecutiveSummary = args.include_executive_summary ?? true
  const threshold = args.severity_threshold ?? "informational"
  const qualityGatePolicy = args.quality_gate_policy ?? "warn"
  const toolCoveragePolicy = args.tool_coverage_policy ?? "enforce"
  const expectedRunId = resolveExpectedRunId(args, context, deps)
  let confidenceThreshold = 80
  let loadedConfig: ArgusConfig | undefined
  const invalidRegenerationOptions =
    args.force === true && args.revision != null
      ? {
          code: "INVALID_REGENERATION_OPTIONS",
          message: "force and revision must not both be set.",
        }
      : args.revision != null && (!Number.isInteger(args.revision) || args.revision < 2)
        ? {
            code: "INVALID_REGENERATION_OPTIONS",
            message: "revision must be an integer greater than or equal to 2.",
          }
        : null

  // Ensure report-input.json is materialized before attempting disk lookup.
  // Scribe may call generate_report without calling read_findings first,
  // or read_findings may have materialized under a different run_id.
  if (typeof expectedRunId === "string" && expectedRunId.length > 0) {
    const projectDir = resolveProjectDir(context)
    const resolver = createAuditArtifactResolver(expectedRunId, projectDir)
    if (!existsSync(resolver.paths().reportInputFile)) {
      try {
        const { materializeReportInput } = await import(
          "../features/persistent-state/findings-materializer"
        )
        await materializeReportInput(expectedRunId, projectDir, context.sessionID)
      } catch {
        /* Best-effort: parseReportInputPayload will produce a clear error if the file is still missing */
      }
    }
  }

  const { reportInput, diagnostics } = parseReportInputPayload(args, context, expectedRunId)
  try {
    const loadConfig = deps.loadConfig ?? loadArgusConfig
    const projectDir = resolveProjectDir(context)
    loadedConfig = loadConfig(projectDir)
    confidenceThreshold = loadedConfig.reporting?.confidenceThreshold ?? confidenceThreshold
  } catch {
    /* Preserve existing write-error behavior: config failures are reported during report write. */
  }

  const preflightPolicy = args.preflight_policy ?? "warn"
  let preflightWarningSection: string | null = null
  const warningBullets: string[] = []
  const scope = args.scope.length > 0 ? args.scope : reportInput.scope
  const finalFindings = dedupeFindingsForFinalOutput(reportInput.findings)
  const outOfScopeFindings = collectOutOfScopeFindings(finalFindings, scope)
  if (outOfScopeFindings.length > 0) {
    const locations = outOfScopeFindings.map(formatLocation).join(", ")
    const message = `findings outside audited scope: ${locations}`
    if (preflightPolicy === "strict-fail") {
      throw new Error(`Preflight failed (strict-fail): ${message}`)
    }
    warningBullets.push(`- ${message}`)
  }

  // Hard gate: refuse to generate a report if key audit tools have not been executed
  if (toolCoveragePolicy !== "skip") {
    const missingTools = computeMissingKeyTools(
      reportInput.toolsExecuted,
      reportInput.unavailableTools,
    )
    if (missingTools.length > 0) {
      const toolList = missingTools.join(", ")
      if (toolCoveragePolicy === "enforce") {
        throw new Error(
          `Tool coverage gate failed: the following key audit tools have not been executed: ${toolList}. ` +
            'Run the missing tools before generating a report, or pass tool_coverage_policy: "warn" to override.',
        )
      }
      warningBullets.push(`- Tool coverage incomplete: ${toolList} not executed`)
    }
  }

  try {
    const readEventsFn = deps.readEvents ?? readEvents
    const events = await readEventsFn(reportInput.run_id, reportInput.projectDir)
    const preflightResult = checkReportPreflight(events)
    if (!preflightResult.passed) {
      if (preflightPolicy === "strict-fail") {
        const parts: string[] = []
        if (preflightResult.orphanedTools.length > 0)
          parts.push(`orphaned tools: ${preflightResult.orphanedTools.join(", ")}`)
        if (preflightResult.missingLifecycle.length > 0)
          parts.push(`missing lifecycle: ${preflightResult.missingLifecycle.join(", ")}`)
        if (preflightResult.missingRequiredTools.length > 0)
          parts.push(`missing required tools: ${preflightResult.missingRequiredTools.join(", ")}`)
        throw new Error(`Preflight failed (strict-fail): ${parts.join("; ")}`)
      }
      if (preflightResult.orphanedTools.length > 0)
        warningBullets.push(`- Orphaned tools: ${preflightResult.orphanedTools.join(", ")}`)
      if (preflightResult.missingLifecycle.length > 0)
        warningBullets.push(`- Missing lifecycle: ${preflightResult.missingLifecycle.join(", ")}`)
      if (preflightResult.missingRequiredTools.length > 0)
        warningBullets.push(
          `- Missing required tools: ${preflightResult.missingRequiredTools.join(", ")}`,
        )
      if (preflightResult.warnings.length > 0)
        warningBullets.push(`- Warnings: ${preflightResult.warnings.join(", ")}`)
    }

    const eventFindings = dedupeFindingsForFinalOutput(projectFindings(events))
    const inputFindings = dedupeFindingsForFinalOutput(reportInput.findings)
    const hasLineage = hasCompleteDedupLineage(reportInput.findings)
    const partialLineage = hasPartialDedupLineage(reportInput.findings)
    const shouldCheckParity =
      !partialLineage && (eventFindings.length === inputFindings.length || hasLineage)
    const lineage = hasLineage
      ? validateFindingLineage(
          projectFindings(events),
          reportInput.findings,
          reportInput.dropped_observations,
        )
      : null
    const parity = shouldCheckParity
      ? lineage
        ? {
            missing: lineage.missing_observation_ids,
            extra: lineage.phantom_observation_ids,
            duplicates: lineage.duplicate_observation_ids,
            countMismatches: lineage.count_mismatches,
            matches: lineage.valid,
          }
        : {
            ...compareIssueFingerprintSets(eventFindings, inputFindings),
            duplicates: [],
            countMismatches: [],
          }
      : { missing: [], extra: [], duplicates: [], countMismatches: [], matches: true }

    if (partialLineage) {
      const partialSummary = `event_findings=${eventFindings.length}, report_findings=${inputFindings.length}`
      if (preflightPolicy === "strict-fail") {
        throw new Error(
          `Preflight failed (strict-fail): finding parity not verifiable (${partialSummary}; partial observation_ids)`,
        )
      }

      warningBullets.push(
        `- Finding parity not verifiable: ${partialSummary}; partial dedup lineage means some findings lack observation_ids`,
      )
    } else if (!shouldCheckParity) {
      const unverifiableSummary = `event_findings=${eventFindings.length}, report_findings=${inputFindings.length}`
      if (preflightPolicy === "strict-fail") {
        throw new Error(
          `Preflight failed (strict-fail): finding parity not verifiable (${unverifiableSummary}; missing observation_ids)`,
        )
      }

      warningBullets.push(
        `- Finding parity not verifiable: ${unverifiableSummary}; deduped findings must include observation_ids to prove merged observations were preserved`,
      )
    }

    if (!parity.matches) {
      const mismatchSummary = `missing=${parity.missing.length}, extra=${parity.extra.length}`
      if (preflightPolicy === "strict-fail") {
        throw new Error(
          `Preflight failed (strict-fail): finding parity mismatch (${mismatchSummary})`,
        )
      }

      warningBullets.push(`- Finding parity mismatch: ${mismatchSummary}`)
      const parityLabel = hasLineage ? "observation IDs" : "issue fingerprints"
      if (parity.missing.length > 0) {
        warningBullets.push(`- Missing ${parityLabel}: ${parity.missing.join(", ")}`)
      }
      if (parity.extra.length > 0) {
        warningBullets.push(`- Extra ${parityLabel}: ${parity.extra.join(", ")}`)
      }
      if (parity.duplicates.length > 0) {
        warningBullets.push(`- Duplicate ${parityLabel}: ${parity.duplicates.join(", ")}`)
      }
      if (parity.countMismatches.length > 0) {
        warningBullets.push(
          `- Observation count mismatches: ${parity.countMismatches.map((item) => item.check).join(", ")}`,
        )
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Preflight failed (strict-fail)")) {
      throw err
    }
    if (preflightPolicy === "strict-fail") {
      throw new Error("Preflight failed: unable to read event stream for completeness check")
    }
    // warn mode: skip preflight when events cannot be read
  }

  if (warningBullets.length > 0) {
    preflightWarningSection = [
      "## \u26A0 Completeness Warning",
      "",
      "This report was generated with incomplete orchestration state.",
      "",
      ...warningBullets,
    ].join("\n")
  }

  const findings = sortFindingsDeterministically(
    finalFindings.filter((finding) => shouldIncludeFinding(finding, threshold)),
  )
  const qualityGates = validateReportQuality(findings, qualityGatePolicy)
  if (!qualityGates.passed && qualityGatePolicy === "strict-fail") {
    throw new Error(
      `Report quality gates failed: ${JSON.stringify({ passed: false, violations: qualityGates.violations })}`,
    )
  }
  const counts = calculateCounts(findings)
  // Derive audit date from the run's start time for deterministic output.
  // Falls back to the earliest toolsExecuted timestamp, then current date as last resort.
  // Exclude UNKNOWN_TIMESTAMP_SENTINEL (patched-in value for missing timestamps).
  const runStartTime = reportInput.toolsExecuted.reduce(
    (earliest, exec) =>
      typeof exec.startTime === "number" &&
      exec.startTime > UNKNOWN_TIMESTAMP_SENTINEL &&
      exec.startTime < earliest
        ? exec.startTime
        : earliest,
    Number.MAX_SAFE_INTEGER,
  )
  const auditDate =
    runStartTime < Number.MAX_SAFE_INTEGER
      ? new Date(runStartTime).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)

  context.metadata({ title: `Generate audit report: ${args.project_name}` })

  // Embed report metadata for single-writer policy enforcement
  const runId = expectedRunId ?? reportInput.run_id
  if (runId.startsWith("ses_")) {
    throw new Error("Report generation requires canonical run_id; received OpenCode session id")
  }
  const reportMarkdown = renderReportMarkdown(reportInput, {
    projectName: args.project_name,
    include_executive_summary: includeExecutiveSummary,
    severity_threshold: threshold,
    threshold: confidenceThreshold,
    scope,
    preflightWarningSection,
    runId,
  })
  const contentHash = stableHash(reportMarkdown)
  const { filename: canonicalFilename } = resolveReportPath({
    contractName: args.project_name,
    date: new Date(auditDate),
    outputDir: ".opencode/reports/",
    runId: runId || undefined,
    revision: args.revision,
  })

  const result: ReportGenerationResult = {
    report: reportMarkdown,
    findingsCount: counts,
    filename: canonicalFilename,
    run_id: runId,
    contentHash,
    qualityGates,
    contractDiagnostics: diagnostics,
  }

  if (invalidRegenerationOptions) {
    result.error = invalidRegenerationOptions
    return result
  }

  try {
    const loadConfig = deps.loadConfig ?? loadArgusConfig
    const projectDir = resolveProjectDir(context)
    const config = loadedConfig ?? loadConfig(projectDir)
    const rawOutputDir = config.reporting?.output_dir ?? ".argus/reports/"
    const resolvedOutput = path.resolve(projectDir, rawOutputDir)
    const projectRoot = projectDir.endsWith(path.sep) ? projectDir : projectDir + path.sep
    if (resolvedOutput !== projectDir && !resolvedOutput.startsWith(projectRoot)) {
      result.error = {
        code: "OUTPUT_DIR_TRAVERSAL",
        message: `output_dir "${rawOutputDir}" resolves outside the project root. Report not written.`,
      }
      return result
    }
    const { filePath: fullPath } = resolveReportPath({
      contractName: args.project_name,
      date: new Date(auditDate),
      outputDir: resolvedOutput,
      runId: runId || undefined,
      revision: args.revision,
    })

    // Single-writer policy: check for duplicate writes with same run_id
    if (runId) {
      if (args.force === true) {
        const forceError = await checkSafeForceOverwrite(fullPath, runId)
        if (forceError) {
          result.error = forceError
          return result
        }
      } else {
        const duplicateError = await checkDuplicateWrite(fullPath, runId)
        if (duplicateError) {
          result.error = duplicateError
          return result
        }
      }
    }

    await Bun.write(fullPath, reportMarkdown)
    result.filePath = fullPath
  } catch (err: unknown) {
    const logger = createLogger()
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(`Failed to write report to disk: ${message}`)
    result.error = {
      code: "WRITE_FAILED",
      message,
    }
  }

  return result
}

export const reportGeneratorTool = tool({
  description:
    "Generate a professional markdown security audit report. Pass project_name, scope, and run_id — the tool reads the materialized ReportInput artifact from disk automatically.",
  args: {
    project_name: tool.schema.string(),
    scope: tool.schema.array(tool.schema.string()),
    include_executive_summary: tool.schema.boolean().default(true),
    severity_threshold: tool.schema
      .enum(["critical", "high", "medium", "low", "informational"])
      .default("informational"),
    preflight_policy: tool.schema.enum(["warn", "strict-fail"]).optional(),
    quality_gate_policy: tool.schema
      .enum(["warn", "strict-fail"])
      .optional()
      .describe("Controls whether report quality gate violations warn or fail generation."),
    tool_coverage_policy: tool.schema
      .enum(["enforce", "warn", "skip"])
      .optional()
      .describe(
        "Controls whether report generation requires key audit tools to have been executed. " +
          "Defaults to 'enforce'.",
      ),
    run_id: tool.schema
      .string()
      .optional()
      .describe(
        "The canonical run ID from <argus-context>. The tool reads the materialized report-input.json from disk using this ID.",
      ),
    revision: tool.schema
      .number()
      .optional()
      .describe(
        "Caller-supplied report revision. Must be an integer >= 2 and writes a -r{revision} file.",
      ),
    force: tool.schema
      .boolean()
      .optional()
      .describe(
        "Overwrite only the base canonical report path when existing Argus metadata matches the same run_id.",
      ),
  },
  async execute(args, context) {
    const result = await executeReportGeneration(args, context)
    // Return a slim payload to avoid OpenCode truncating large tool results.
    // The full markdown is already written to disk at result.filePath.
    // Truncated JSON breaks tool-tracking-hook parsing, which prevents
    // reportGenerated from being set and blocks run finalization.
    const { report, ...slimResult } = result
    return JSON.stringify({
      ...slimResult,
      reportSummary: `Report written to disk (${report.length} bytes, ${report.split("\n").length} lines). See filePath.`,
    })
  },
})
