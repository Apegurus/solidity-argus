import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { type ToolContext, tool } from "@opencode-ai/plugin"
import { loadArgusConfig } from "../config/loader"
import type { ArgusConfig } from "../config/types"
import { readEvents } from "../features/persistent-state/event-sink"
import { resolveRunIdFromOpencodeSession } from "../features/persistent-state/global-run-index"
import { createAuditArtifactResolver } from "../shared/audit-artifact-resolver"
import type { DropDiagnostic, DropPolicy } from "../shared/drop-diagnostics"
import { createDropDiagnosticsCollector } from "../shared/drop-diagnostics"
import { createLogger } from "../shared/logger"
import { resolveProjectDir } from "../shared/project-utils"
import { resolveReportPath } from "../shared/report-path-resolver"
import { SEVERITY_RANK, VALID_SEVERITIES, VALID_SOURCES } from "../shared/validation-constants"
import { normalizeToCanonicalFinding } from "../state/adapters"
import {
  compareIssueFingerprintSets,
  dedupeFindingsForFinalOutput,
} from "../state/finding-aggregation"
import { projectFindings, stableHash } from "../state/projectors"
import { type ReportInput, SCHEMA_VERSION, validateReportInput } from "../state/schemas"
import type { AuditState, Finding, FindingSeverity } from "../state/types"
import { computeMissingKeyTools } from "../shared/key-tools"
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
  audit_state?: string
  preflight_policy?: PreflightPolicy
  tool_coverage_policy?: ToolCoveragePolicy
  run_id?: string
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

const SEVERITY_ORDER: FindingSeverity[] = ["Critical", "High", "Medium", "Low", "Informational"]

const SEVERITY_PREFIX: Record<FindingSeverity, string> = {
  Critical: "CRIT",
  High: "HIGH",
  Medium: "MED",
  Low: "LOW",
  Informational: "INFO",
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

function emptyAuditState(findings: Finding[] = []): AuditState {
  return {
    sessionId: "",
    projectDir: "",
    contractsReviewed: [],
    findings,
    toolsExecuted: [],
    currentPhase: "complete",
    scope: [],
    startTime: 0,
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

function hasMinimumFindingFields(
  f: unknown,
): f is { check: string; file: string; lines: [number, number] } {
  if (typeof f !== "object" || f === null) return false
  const obj = f as Record<string, unknown>
  const hasCheck = typeof obj.check === "string" && obj.check.length > 0
  if (!hasCheck) return false
  if (typeof obj.file !== "string") {
    obj.file = ""
  }
  if (!Array.isArray(obj.lines) || obj.lines.length !== 2) {
    obj.lines = [0, 0]
  }
  return true
}

function normalizeFinding(f: Record<string, unknown>): Finding {
  const severity =
    typeof f.severity === "string" && VALID_SEVERITIES.has(f.severity as Finding["severity"])
      ? (f.severity as Finding["severity"])
      : "Informational"
  const confidence =
    typeof f.confidence === "string" && ["High", "Medium", "Low"].includes(f.confidence)
      ? (f.confidence as Finding["confidence"])
      : "Low"
  const source =
    typeof f.source === "string" && VALID_SOURCES.has(f.source as Finding["source"])
      ? (f.source as Finding["source"])
      : "manual"
  const description = typeof f.description === "string" ? f.description : (f.check as string)
  const id = typeof f.id === "string" ? f.id : `${f.check}:${f.file}:${(f.lines as number[])[0]}`
  return {
    id,
    check: f.check as string,
    severity,
    confidence,
    description,
    file: f.file as string,
    lines: f.lines as [number, number],
    source,
    remediation: typeof f.remediation === "string" ? f.remediation : undefined,
    exploitReference: typeof f.exploitReference === "string" ? f.exploitReference : undefined,
    ...(typeof f.impact === "string" ? { impact: f.impact } : {}),
    ...(typeof f.recommendation === "string" ? { recommendation: f.recommendation } : {}),
    ...(typeof f.proofOfConcept === "string" ? { proofOfConcept: f.proofOfConcept } : {}),
    ...(typeof f.proof_of_concept === "string" ? { proofOfConcept: f.proof_of_concept } : {}),
  } as Finding
}

export type ParseAuditStateOptions = {
  dropPolicy?: DropPolicy
}

export type ParseAuditStateResult = {
  state: AuditState
  diagnostics: DropDiagnostic[]
}

type ParseReportInputResult = {
  reportInput: ReportInput
  diagnostics: DropDiagnostic[]
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
      rec.startTime = Date.now()
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
    if (typeof rec.run_id !== "string" || rec.run_id.trim().length === 0) {
      rec.run_id = runId
      patched = true
    }
    if (typeof rec.schema_version !== "string" || rec.schema_version.trim().length === 0) {
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

function buildLegacyCompatibleReportInput(
  state: AuditState,
  context: ToolContext,
  diagnostics: ReturnType<typeof createDropDiagnosticsCollector>,
  expectedRunId?: string,
): ReportInput {
  diagnostics.warn(
    "REPORT_INPUT_DEPRECATED_LEGACY_PAYLOAD",
    "Legacy audit_state payload is deprecated; pass report_input with canonical ReportInput schema.",
    "audit_state",
  )

  const runId = expectedRunId || state.sessionId || context.sessionID || "legacy-run"
  const sessionId = state.sessionId || context.sessionID || runId

  if (expectedRunId && state.sessionId.startsWith("ses_")) {
    diagnostics.warn(
      "REPORT_INPUT_LEGACY_SESSION_NORMALIZED",
      "Legacy audit_state sessionId resembled an OpenCode session id; normalized run_id from canonical context.",
      "run_id",
    )
  }

  if (!state.sessionId) {
    diagnostics.warn(
      "REPORT_INPUT_SYNTHESIZED_SESSION",
      "Legacy payload missing sessionId; synthesized session_id from tool context/run_id.",
      "session_id",
    )
  }
  if (!state.projectDir) {
    diagnostics.warn(
      "REPORT_INPUT_SYNTHESIZED_PROJECT_DIR",
      "Legacy payload missing projectDir; synthesized projectDir from tool context.",
      "projectDir",
    )
  }

  const canonicalFindings = state.findings
    .map((finding, index) => {
      const normalized = normalizeToCanonicalFinding(finding, runId, index + 1)
      for (const diag of normalized.diagnostics) {
        diagnostics.warn(
          "REPORT_INPUT_LEGACY_FINDING_NORMALIZED",
          `[index:${index}] ${diag.message}`,
          diag.field,
        )
      }
      return normalized.data
    })
    .filter((finding) => finding.check.length > 0 && finding.file.length > 0)

  return {
    run_id: runId,
    seq: state.toolsExecuted.length + canonicalFindings.length,
    session_id: sessionId,
    tool_call_id: "legacy-adapter",
    source: "report-generator-legacy-adapter",
    schema_version: SCHEMA_VERSION,
    projectDir: state.projectDir || resolveProjectDir(context),
    findings: canonicalFindings,
    toolsExecuted: state.toolsExecuted.map((toolExec) => ({
      ...toolExec,
      run_id: runId,
      schema_version: SCHEMA_VERSION,
    })),
    scope: state.scope,
    soloditResults: state.soloditResults,
    fuzzCounterexamples: state.fuzzCounterexamples,
    coverageReport: state.coverageReport,
    gasHotspots: state.gasHotspots,
    proxyContracts: state.proxyContracts,
    patternVersion: state.patternVersion,
    skillsLoaded: state.skillsLoaded,
  }
}

function resolveExpectedRunId(
  args: ReportGeneratorArgs,
  context: ToolContext,
  deps: ReportGenerationDependencies,
): string | undefined {
  if (typeof args.run_id === "string" && args.run_id.trim().length > 0) {
    return args.run_id.trim()
  }

  const sessionId = context.sessionID
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return undefined
  }

  const projectDir = resolveProjectDir(context)
  const resolveCanonicalRunId = deps.resolveCanonicalRunId ?? resolveRunIdFromOpencodeSession
  const resolved = resolveCanonicalRunId(sessionId, projectDir)
  if (typeof resolved === "string" && resolved.trim().length > 0) {
    return resolved
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

  if (typeof args.report_input === "string" && args.report_input.trim().length > 0) {
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
      if (typeof args.audit_state === "string" && args.audit_state.trim().length > 0) {
        diagnostics.warn(
          "REPORT_INPUT_LEGACY_FIELD_IGNORED",
          "Both report_input and audit_state were provided; audit_state is ignored.",
          "audit_state",
        )
      }

      return finalizeReportInputSelection(validation.data, diagnostics, expectedRunId)
    }
  }

  if (typeof args.audit_state === "string" && args.audit_state.trim().length > 0) {
    const legacy = parseAuditStateWithDiagnostics(args.audit_state, { dropPolicy: "warn" })
    for (const diagnostic of legacy.diagnostics) {
      diagnostics.warn(diagnostic.reason.code, diagnostic.reason.message, diagnostic.reason.field)
    }
    const reportInput = buildLegacyCompatibleReportInput(
      legacy.state,
      context,
      diagnostics,
      expectedRunId,
    )
    return finalizeReportInputSelection(reportInput, diagnostics, expectedRunId)
  }

  if (typeof args.run_id === "string" && args.run_id.trim().length > 0) {
    const projectDir = resolveProjectDir(context)
    const resolver = createAuditArtifactResolver(args.run_id, projectDir)
    const reportInputFile = resolver.paths().reportInputFile
    if (existsSync(reportInputFile)) {
      diagnostics.warn(
        "REPORT_INPUT_DISK_FALLBACK",
        "No report_input or audit_state provided; reading materialized report-input.json from disk.",
        "report_input",
      )
      let parsed: unknown
      try {
        parsed = JSON.parse(readFileSync(reportInputFile, "utf-8"))
      } catch {
        diagnostics.error(
          "REPORT_INPUT_DISK_CORRUPT",
          `Materialized report-input.json for run ${args.run_id} is not valid JSON.`,
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
    "Missing report_input payload. Provide report_input (preferred), run_id for disk fallback, or legacy audit_state.",
    "report_input",
  )
  throwContractMismatch(
    "ReportInput contract mismatch: missing required payload",
    diagnostics.getDiagnostics(),
  )
}

function emitDropDiagnosticsForFindings(
  rawItems: unknown[],
  normalized: Record<string, unknown>[],
  validFindings: Finding[],
  diag: ReturnType<typeof createDropDiagnosticsCollector>,
): void {
  const droppedCount = rawItems.length - validFindings.length
  if (droppedCount <= 0) return

  for (const item of normalized) {
    if (hasMinimumFindingFields(item)) continue
    const missing: string[] = []
    if (typeof item.check !== "string" || (item.check as string).length === 0) missing.push("check")
    if (typeof item.file !== "string") missing.push("file")
    if (!Array.isArray(item.lines) || (item.lines as unknown[]).length !== 2) missing.push("lines")
    diag.error(
      "MISSING_REQUIRED_FIELD",
      `Finding dropped: missing ${missing.join(", ") || "unknown fields"} after normalization`,
      missing[0],
    )
  }
}

export function parseAuditState(auditState: string, options?: ParseAuditStateOptions): AuditState {
  const policy = options?.dropPolicy ?? "warn"
  const diag = createDropDiagnosticsCollector(policy, "report-generator")

  let parsed: unknown
  try {
    parsed = JSON.parse(auditState)
  } catch {
    diag.error("MALFORMED_JSON", "audit_state is not valid JSON")
    diag.throwIfStrict()
    throw new Error(
      "audit_state is not valid JSON — expected an AuditState object or Finding[] array",
    )
  }

  if (Array.isArray(parsed)) {
    const rawItems = parsed as unknown[]
    const normalized = rawItems
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => normalizeRawFinding(item))
    const validFindings = normalized
      .filter(hasMinimumFindingFields)
      .map((f) => normalizeFinding(f as Record<string, unknown>))
    emitDropDiagnosticsForFindings(rawItems, normalized, validFindings, diag)
    diag.throwIfStrict()
    return emptyAuditState(validFindings)
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as AuditState).findings)
  ) {
    const state = parsed as AuditState
    const rawFindings = state.findings as unknown[]
    const normalized = rawFindings
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => normalizeRawFinding(item))
    const validFindings = normalized
      .filter(hasMinimumFindingFields)
      .map((f) => normalizeFinding(f as Record<string, unknown>))
    emitDropDiagnosticsForFindings(rawFindings, normalized, validFindings, diag)
    diag.throwIfStrict()
    return {
      ...emptyAuditState(),
      ...state,
      findings: validFindings,
    }
  }

  return emptyAuditState()
}

export function parseAuditStateWithDiagnostics(
  auditState: string,
  options?: ParseAuditStateOptions,
): ParseAuditStateResult {
  const policy = options?.dropPolicy ?? "warn"
  const diag = createDropDiagnosticsCollector(policy, "report-generator")

  let parsed: unknown
  try {
    parsed = JSON.parse(auditState)
  } catch {
    diag.error("MALFORMED_JSON", "audit_state is not valid JSON")
    diag.throwIfStrict()
    return { state: emptyAuditState(), diagnostics: diag.getDiagnostics() }
  }

  if (Array.isArray(parsed)) {
    const rawItems = parsed as unknown[]
    const normalized = rawItems
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => normalizeRawFinding(item))
    const validFindings = normalized
      .filter(hasMinimumFindingFields)
      .map((f) => normalizeFinding(f as Record<string, unknown>))
    emitDropDiagnosticsForFindings(rawItems, normalized, validFindings, diag)
    diag.throwIfStrict()
    return { state: emptyAuditState(validFindings), diagnostics: diag.getDiagnostics() }
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as AuditState).findings)
  ) {
    const auditStateObj = parsed as AuditState
    const rawFindings = auditStateObj.findings as unknown[]
    const normalized = rawFindings
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => normalizeRawFinding(item))
    const validFindings = normalized
      .filter(hasMinimumFindingFields)
      .map((f) => normalizeFinding(f as Record<string, unknown>))
    emitDropDiagnosticsForFindings(rawFindings, normalized, validFindings, diag)
    diag.throwIfStrict()
    return {
      state: { ...emptyAuditState(), ...auditStateObj, findings: validFindings },
      diagnostics: diag.getDiagnostics(),
    }
  }

  return { state: emptyAuditState(), diagnostics: diag.getDiagnostics() }
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

function shouldIncludeFinding(finding: Finding, threshold: SeverityThreshold): boolean {
  return FINDING_WEIGHT[finding.severity] >= THRESHOLD_WEIGHT[threshold]
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
  if (typeof extended.impact === "string" && extended.impact.trim().length > 0) {
    return extended.impact.trim()
  }
  return MISSING_IMPACT_TEXT
}

function getFindingRecommendation(finding: Finding): string {
  const extended = getExtendedFinding(finding)
  if (typeof extended.recommendation === "string" && extended.recommendation.trim().length > 0) {
    return extended.recommendation.trim()
  }
  if (typeof finding.remediation === "string" && finding.remediation.trim().length > 0) {
    return finding.remediation.trim()
  }
  return MISSING_RECOMMENDATION_TEXT
}

function getPocEvidence(finding: Finding): string | undefined {
  const extended = getExtendedFinding(finding)
  if (typeof extended.proofOfConcept === "string" && extended.proofOfConcept.trim().length > 0) {
    return extended.proofOfConcept.trim()
  }
  if (typeof finding.exploitReference === "string" && finding.exploitReference.trim().length > 0) {
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

function buildFindingsSection(findings: Finding[]): string {
  if (findings.length === 0) {
    return "## Findings\nNo findings meet the configured severity threshold."
  }

  const lines: string[] = ["## Findings"]

  for (const severity of SEVERITY_ORDER) {
    const severityFindings = findings.filter((finding) => finding.severity === severity)
    if (severityFindings.length === 0) {
      continue
    }

    lines.push(`### ${severity}`)

    severityFindings.forEach((finding, index) => {
      const prefix = SEVERITY_PREFIX[severity]
      const findingId = `[${prefix}-${index + 1}]`
      const title = normalizeTitle(finding.check)
      const recommendation = getFindingRecommendation(finding)
      const impact = getFindingImpact(finding)

      lines.push(`### ${findingId} ${title}`)
      lines.push(`**Severity**: ${finding.severity}`)
      lines.push(`**Confidence**: ${finding.confidence}`)
      lines.push(`**Location**: ${formatLocation(finding)}`)
      lines.push("")
      lines.push(`**Description**: ${finding.description}`)
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
    })
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
  includedCount: number,
): string {
  const lines: string[] = ["## Appendix: Data Provenance"]

  lines.push("- Data source: `report_input` payload (legacy `audit_state` supported via adapter)")
  lines.push(`- Severity threshold applied: ${threshold}`)
  lines.push(`- Findings included in report: ${includedCount}`)

  if (state.findings.length > 0) {
    const sourceCounts: Record<string, number> = {}
    for (const f of state.findings) {
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

export async function executeReportGeneration(
  args: ReportGeneratorArgs,
  context: ToolContext,
  deps: ReportGenerationDependencies = {},
): Promise<ReportGenerationResult> {
  const includeExecutiveSummary = args.include_executive_summary ?? true
  const threshold = args.severity_threshold ?? "low"
  const qualityGatePolicy = args.quality_gate_policy ?? "warn"
  const isLegacyPath = !args.report_input && !!args.audit_state
  const toolCoveragePolicy = args.tool_coverage_policy ?? (isLegacyPath ? "warn" : "enforce")
  const expectedRunId = resolveExpectedRunId(args, context, deps)
  const { reportInput, diagnostics } = parseReportInputPayload(args, context, expectedRunId)

  const preflightPolicy = args.preflight_policy ?? "warn"
  let preflightWarningSection: string | null = null
  const warningBullets: string[] = []

  // Hard gate: refuse to generate a report if key audit tools have not been executed
  if (toolCoveragePolicy !== "skip") {
    const missingTools = computeMissingKeyTools(reportInput.toolsExecuted)
    if (missingTools.length > 0) {
      const toolList = missingTools.join(", ")
      if (toolCoveragePolicy === "enforce") {
        throw new Error(
          `Tool coverage gate failed: the following key audit tools have not been executed: ${toolList}. ` +
            "Run the missing tools before generating a report, or pass tool_coverage_policy: \"warn\" to override.",
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
    const parity = compareIssueFingerprintSets(eventFindings, inputFindings)

    if (!parity.matches) {
      const mismatchSummary = `missing=${parity.missing.length}, extra=${parity.extra.length}`
      if (preflightPolicy === "strict-fail") {
        throw new Error(
          `Preflight failed (strict-fail): finding parity mismatch (${mismatchSummary})`,
        )
      }

      warningBullets.push(`- Finding parity mismatch: ${mismatchSummary}`)
      if (parity.missing.length > 0) {
        warningBullets.push(`- Missing issue fingerprints: ${parity.missing.join(", ")}`)
      }
      if (parity.extra.length > 0) {
        warningBullets.push(`- Extra issue fingerprints: ${parity.extra.join(", ")}`)
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

  const state = reportInputToAuditState(reportInput)
  const scope = args.scope.length > 0 ? args.scope : reportInput.scope
  const finalFindings = dedupeFindingsForFinalOutput(reportInput.findings)
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
  const auditDate = new Date().toISOString().slice(0, 10)

  context.metadata({ title: `Generate audit report: ${args.project_name}` })

  const sections: string[] = [`# Security Audit Report — ${args.project_name}`]

  if (includeExecutiveSummary) {
    sections.push("## Executive Summary")
    sections.push(
      `This report summarizes security findings identified for ${args.project_name} based on static analysis, testing, and pattern-based review.`,
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
    "Approach: Findings are normalized, deterministically ordered by severity/file/line, and validated against report quality gates before emission.",
  )

  sections.push(buildFindingsSection(findings))

  sections.push("## Recommendations")
  for (const item of buildRecommendations(counts)) {
    sections.push(`- ${item}`)
  }

  if (preflightWarningSection) {
    sections.push(preflightWarningSection)
  }

  sections.push(buildProvenanceAppendix(state, threshold, findings.length))

  // Embed report metadata for single-writer policy enforcement
  const runId = expectedRunId ?? reportInput.run_id
  if (runId.startsWith("ses_")) {
    throw new Error("Report generation requires canonical run_id; received OpenCode session id")
  }
  if (runId) {
    sections.push(buildReportMetadataComment(runId))
  }

  const reportMarkdown = sections.join("\n\n")
  const contentHash = stableHash(reportMarkdown)
  const { filename: canonicalFilename } = resolveReportPath({
    contractName: args.project_name,
    date: new Date(auditDate),
    outputDir: ".opencode/reports/",
    runId: runId || undefined,
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

  try {
    const loadConfig = deps.loadConfig ?? loadArgusConfig
    const projectDir = resolveProjectDir(context)
    const config = loadConfig(projectDir)
    const outputDir = config.reporting?.output_dir ?? ".argus/reports/"
    const fullPath = path.join(projectDir, outputDir, canonicalFilename)

    // Single-writer policy: check for duplicate writes with same run_id
    if (runId) {
      const duplicateError = await checkDuplicateWrite(fullPath, runId)
      if (duplicateError) {
        result.error = duplicateError
        return result
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
    "Generate a professional markdown security audit report from versioned ReportInput payloads with legacy audit_state compatibility.",
  args: {
    project_name: tool.schema.string(),
    scope: tool.schema.array(tool.schema.string()),
    include_executive_summary: tool.schema.boolean().default(true),
    severity_threshold: tool.schema
      .enum(["critical", "high", "medium", "low", "informational"])
      .default("low"),
    // report_input and audit_state are intentionally excluded from the schema
    // to prevent agents from passing inline payloads (which consistently fail
    // validation). The tool always reads from the materialized disk artifact
    // via run_id. Runtime handling for these fields is kept as defense-in-depth.
    preflight_policy: tool.schema.enum(["warn", "strict-fail"]).optional(),
    tool_coverage_policy: tool.schema
      .enum(["enforce", "warn", "skip"])
      .optional()
      .describe(
        "Controls whether report generation requires key audit tools to have been executed. " +
          "Defaults to 'enforce' for canonical report_input path, 'warn' for legacy audit_state path.",
      ),
    run_id: tool.schema
      .string()
      .optional()
      .describe(
        "Run ID for disk fallback. When report_input is omitted, reads materialized report-input.json from disk.",
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
