import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { resolveRunIdFromOpencodeSession } from "../features/persistent-state/global-run-index"
import { createAuditArtifactResolver } from "../shared/audit-artifact-resolver"
import { createDropDiagnosticsCollector, type DropDiagnostic } from "../shared/drop-diagnostics"
import { validateRunId } from "../shared/path-safety"
import { resolveProjectDir } from "../shared/project-utils"
import { isNonEmptyString } from "../shared/type-guards"
import { normalizeToCanonicalFinding } from "../state/adapters"
import { type ReportInput, SCHEMA_VERSION, validateReportInput } from "../state/schemas"
import type { ArgusAgentName, AuditState } from "../state/types"
import type { ReportGenerationDependencies, ReportGeneratorArgs } from "./report-generator-tool"

/** Sentinel for missing/unknown tool execution timestamps (schema requires startTime > 0). */
export const UNKNOWN_TIMESTAMP_SENTINEL = 1

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
  "themis",
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

export function reportInputToAuditState(reportInput: ReportInput): AuditState {
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
      rec.success = false
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

export function resolveExpectedRunId(
  args: ReportGeneratorArgs,
  context: ToolContext,
  deps: ReportGenerationDependencies,
): string | undefined {
  // 1. Explicit run_id from LLM args (highest priority)
  if (isNonEmptyString(args.run_id)) {
    return validateRunId(args.run_id.trim())
  }

  if (isNonEmptyString(args.report_input)) {
    return undefined
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

export function parseReportInputPayload(
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
      let dedupedArtifact: {
        run_id?: string
        findings?: unknown[]
        dropped_observations?: unknown[]
        deduped_by?: string
      }
      try {
        dedupedArtifact = JSON.parse(readFileSync(dedupedFile, "utf-8")) as typeof dedupedArtifact
      } catch {
        diagnostics.error(
          "REPORT_INPUT_DEDUPED_CORRUPT",
          `deduped-findings.json for run ${effectiveRunId} is not valid JSON.`,
          "deduped-findings.json",
        )
        throwContractMismatch(
          "ReportInput contract mismatch: corrupted deduped artifact",
          diagnostics.getDiagnostics(),
        )
      }

      if (dedupedArtifact.run_id !== effectiveRunId) {
        diagnostics.error(
          "REPORT_INPUT_DEDUPED_RUN_MISMATCH",
          `deduped-findings.json belongs to run ${String(dedupedArtifact.run_id)}, expected ${effectiveRunId}.`,
          "run_id",
        )
        throwContractMismatch(
          "ReportInput contract mismatch: deduped artifact run_id mismatch",
          diagnostics.getDiagnostics(),
        )
      }
      if (dedupedArtifact.deduped_by !== "scribe") {
        diagnostics.error(
          "REPORT_INPUT_DEDUPED_PROVENANCE_INVALID",
          "deduped-findings.json must be persisted by Scribe.",
          "deduped_by",
        )
        throwContractMismatch(
          "ReportInput contract mismatch: invalid deduped artifact provenance",
          diagnostics.getDiagnostics(),
        )
      }

      if (!Array.isArray(dedupedArtifact.findings)) {
        diagnostics.error(
          "REPORT_INPUT_DEDUPED_VALIDATION_FAILED",
          "findings must be an array in deduped-findings.json.",
          "findings",
        )
        throwContractMismatch(
          "ReportInput contract mismatch: deduped artifact failed schema validation",
          diagnostics.getDiagnostics(),
        )
      }

      const reportInputFile = resolver.paths().reportInputFile
      let baseInput: Record<string, unknown> = {}
      if (existsSync(reportInputFile)) {
        try {
          baseInput = JSON.parse(readFileSync(reportInputFile, "utf-8")) as Record<string, unknown>
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
      if (typeof merged.tool_call_id !== "string" || (merged.tool_call_id as string).length === 0) {
        merged.tool_call_id = `deduped:${effectiveRunId}`
      }
      if (typeof merged.source !== "string" || (merged.source as string).length === 0) {
        merged.source = "deduped-findings"
      }
      if (typeof merged.schema_version !== "string" || merged.schema_version !== SCHEMA_VERSION) {
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
        diagnostics.error(
          "REPORT_INPUT_DEDUPED_VALIDATION_FAILED",
          `${error.field}: ${error.message}`,
          error.field,
        )
      }
      throwContractMismatch(
        "ReportInput contract mismatch: deduped artifact failed schema validation",
        diagnostics.getDiagnostics(),
      )
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
