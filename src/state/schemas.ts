import {
  DROPPED_OBSERVATION_REASONS,
  type DroppedObservation,
} from "../shared/dropped-observations"
import { isRecord } from "../shared/type-guards"
import {
  isValidRubricVerdict,
  VALID_AGENTS,
  VALID_CONFIDENCES,
  VALID_SEVERITIES,
  VALID_SOURCES,
} from "../shared/validation-constants"
import type {
  ArgusAgentName,
  AuditPhase,
  CoverageAttemptState,
  Finding,
  FindingCounts,
  FindingSeverity,
  FuzzCounterexample,
  SoloditResult,
  ToolExecution,
} from "./types"

export const SCHEMA_VERSION = "2.0.0"

export type AuditEventType =
  | "session.created"
  | "session.idle"
  | "session.deleted"
  | "tool.started"
  | "tool.completed"
  | "finding.added"
  | "phase.changed"
  | "run.finalized"

export interface ValidationError {
  field: string
  code: string
  message: string
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: ValidationError[] }

export interface AuditEvent {
  type: AuditEventType
  run_id: string
  seq: number
  session_id: string
  tool_call_id?: string
  source: string
  schema_version: string
  timestamp: number
  payload: unknown
}

export interface CanonicalFinding extends Finding {
  run_id: string
  seq: number
  schema_version: string
  observation_id: string
  issue_fingerprint: string
  observation_fingerprint: string
  reported_by_agent: ArgusAgentName
  reported_by_session_id?: string
}

export interface CanonicalToolExecution extends ToolExecution {
  run_id: string
  schema_version: string
}

export interface CoverageReport {
  files: Array<{
    path: string
    linesPct: number
    statementsPct: number
    branchesPct: number
    functionsPct: number
  }>
}

export interface GasHotspot {
  contract: string
  function: string
  avgGas: number
}

export interface ProxyContract {
  file: string
  proxyType: string
  indicators: string[]
}

export interface AuditRunSnapshot {
  run_id: string
  seq: number
  session_id: string
  tool_call_id: string
  source: string
  schema_version: string
  findings: CanonicalFinding[]
  phase: AuditPhase
  tools: CanonicalToolExecution[]
  started_at: number
  finalized_at?: number
}

export interface ReportInput {
  run_id: string
  seq: number
  session_id: string
  tool_call_id: string
  source: string
  schema_version: string
  projectDir: string
  findings: CanonicalFinding[]
  dropped_observations?: DroppedObservation[]
  toolsExecuted: CanonicalToolExecution[]
  findingCounts?: FindingCounts
  scope: string[]
  soloditResults?: SoloditResult[]
  fuzzCounterexamples?: FuzzCounterexample[]
  coverageReport?: CoverageReport
  gasHotspots?: GasHotspot[]
  proxyContracts?: ProxyContract[]
  patternVersion?: string
  skillsLoaded?: string[]
  unavailableTools?: string[]
  coverageAttempt?: CoverageAttemptState
}

const FINDING_COUNT_FIELDS = [
  "rawObservations",
  "recordedFindings",
  "dedupedFindings",
  "actionableFindings",
  "nonActionableFindings",
] as const

const COVERAGE_ATTEMPT_STATUSES = new Set(["pending", "run", "skipped", "failed"])

function pushFindingCountsErrors(errors: ValidationError[], raw: unknown, prefix: string): void {
  if (raw == null) return
  if (!isRecord(raw)) {
    errors.push({
      field: prefix,
      code: "invalid",
      message: `${prefix} must be an object when provided`,
    })
    return
  }

  for (const field of FINDING_COUNT_FIELDS) {
    const value = raw[field]
    if (value == null) continue
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      errors.push({
        field: `${prefix}.${field}`,
        code: "invalid",
        message: `${prefix}.${field} must be a non-negative integer when provided`,
      })
    }
  }
}

function pushCoverageAttemptErrors(errors: ValidationError[], raw: unknown): void {
  if (raw == null) return
  if (!isRecord(raw)) {
    errors.push({
      field: "coverageAttempt",
      code: "invalid",
      message: "coverageAttempt must be an object when provided",
    })
    return
  }

  if (typeof raw.status !== "string" || !COVERAGE_ATTEMPT_STATUSES.has(raw.status)) {
    errors.push({
      field: "coverageAttempt.status",
      code: "enum",
      message: "coverageAttempt.status must be one of: pending, run, skipped, failed",
    })
  }

  if (
    raw.attemptedAt != null &&
    (typeof raw.attemptedAt !== "number" ||
      !Number.isInteger(raw.attemptedAt) ||
      raw.attemptedAt <= 0)
  ) {
    errors.push({
      field: "coverageAttempt.attemptedAt",
      code: "invalid",
      message: "coverageAttempt.attemptedAt must be a positive integer when provided",
    })
  }

  if (raw.reason != null && (typeof raw.reason !== "string" || raw.reason.trim().length === 0)) {
    errors.push({
      field: "coverageAttempt.reason",
      code: "invalid",
      message: "coverageAttempt.reason must be a non-empty string when provided",
    })
  }
}

function pushDroppedObservationsErrors(errors: ValidationError[], raw: unknown): void {
  if (raw == null) return
  if (!Array.isArray(raw)) {
    errors.push({
      field: "dropped_observations",
      code: "invalid",
      message: "dropped_observations must be an array when provided",
    })
    return
  }

  const validReasons = new Set<string>(DROPPED_OBSERVATION_REASONS)
  for (const [index, entry] of raw.entries()) {
    if (!isRecord(entry)) {
      errors.push({
        field: `dropped_observations[${index}]`,
        code: "type",
        message: "dropped_observations entries must be objects",
      })
      continue
    }
    if (typeof entry.observation_id !== "string" || entry.observation_id.trim().length === 0) {
      errors.push({
        field: `dropped_observations[${index}].observation_id`,
        code: "required",
        message: "observation_id is required and must be a non-empty string",
      })
    }
    if (typeof entry.reason !== "string" || !validReasons.has(entry.reason)) {
      errors.push({
        field: `dropped_observations[${index}].reason`,
        code: "enum",
        message:
          "reason must be one of: out-of-scope, false-positive, merged-into, non-actionable-noise",
      })
    }
    if (entry.note != null && typeof entry.note !== "string") {
      errors.push({
        field: `dropped_observations[${index}].note`,
        code: "invalid",
        message: "note must be a string when provided",
      })
    }
  }
}

function pushRequiredRootStringError(
  errors: ValidationError[],
  obj: Record<string, unknown>,
  field: keyof ReportInput,
): void {
  if (typeof obj[field] !== "string" || (obj[field] as string).trim().length === 0) {
    errors.push({
      field: String(field),
      code: "required",
      message: `${String(field)} is required and must be a non-empty string`,
    })
  }
}

function pushRequiredRootNumberError(
  errors: ValidationError[],
  obj: Record<string, unknown>,
  field: keyof ReportInput,
): void {
  if (typeof obj[field] !== "number" || !Number.isInteger(obj[field] as number)) {
    errors.push({
      field: String(field),
      code: "invalid",
      message: `${String(field)} is required and must be an integer`,
    })
  }
}

function pushRequiredStringError(
  errors: ValidationError[],
  obj: Record<string, unknown>,
  field: keyof CanonicalFinding,
): void {
  if (typeof obj[field] !== "string" || (obj[field] as string).trim().length === 0) {
    errors.push({
      field,
      code: "required",
      message: `${field} is required and must be a non-empty string`,
    })
  }
}

export function validateCanonicalFinding(raw: unknown): ValidationResult<CanonicalFinding> {
  if (!isRecord(raw)) {
    return {
      success: false,
      errors: [
        {
          field: "$root",
          code: "type",
          message: "canonical finding must be an object",
        },
      ],
    }
  }

  const errors: ValidationError[] = []

  pushRequiredStringError(errors, raw, "id")
  pushRequiredStringError(errors, raw, "check")
  pushRequiredStringError(errors, raw, "description")
  pushRequiredStringError(errors, raw, "file")
  pushRequiredStringError(errors, raw, "run_id")
  pushRequiredStringError(errors, raw, "schema_version")
  pushRequiredStringError(errors, raw, "observation_id")
  pushRequiredStringError(errors, raw, "issue_fingerprint")
  pushRequiredStringError(errors, raw, "observation_fingerprint")
  pushRequiredStringError(errors, raw, "reported_by_agent")

  if (typeof raw.seq !== "number" || !Number.isInteger(raw.seq) || raw.seq < 0) {
    errors.push({
      field: "seq",
      code: "invalid",
      message: "seq must be a non-negative integer",
    })
  }

  if (!Array.isArray(raw.lines) || raw.lines.length !== 2) {
    errors.push({
      field: "lines",
      code: "invalid",
      message: "lines must be a [start, end] tuple",
    })
  } else {
    const [start, end] = raw.lines
    if (typeof start !== "number" || typeof end !== "number") {
      errors.push({
        field: "lines",
        code: "invalid",
        message: "lines must contain numbers",
      })
    }
  }

  if (typeof raw.severity !== "string" || !VALID_SEVERITIES.has(raw.severity as FindingSeverity)) {
    errors.push({
      field: "severity",
      code: "enum",
      message: "severity must be one of: Critical, High, Medium, Low, Informational",
    })
  }

  if (
    typeof raw.confidence !== "string" ||
    !VALID_CONFIDENCES.has(raw.confidence as CanonicalFinding["confidence"])
  ) {
    errors.push({
      field: "confidence",
      code: "enum",
      message: "confidence must be one of: High, Medium, Low",
    })
  }

  if ("confidence_score" in (raw as Record<string, unknown>)) {
    if (
      raw.confidence_score === null ||
      typeof raw.confidence_score !== "number" ||
      !Number.isInteger(raw.confidence_score) ||
      raw.confidence_score < 0 ||
      raw.confidence_score > 100
    ) {
      errors.push({
        field: "confidence_score",
        code: "invalid",
        message: "confidence_score must be an integer between 0 and 100 when provided",
      })
    }
  }

  if ("rubric_verdict" in (raw as Record<string, unknown>)) {
    if (!isValidRubricVerdict(raw.rubric_verdict)) {
      errors.push({
        field: "rubric_verdict",
        code: "enum",
        message:
          "rubric_verdict must be one of: CONFIRMED, DEMOTED, REJECTED_DEMOTED when provided",
      })
    }
  }

  if ("supersedes_observation_id" in (raw as Record<string, unknown>)) {
    if (
      raw.supersedes_observation_id != null &&
      (typeof raw.supersedes_observation_id !== "string" ||
        raw.supersedes_observation_id.trim().length === 0)
    ) {
      errors.push({
        field: "supersedes_observation_id",
        code: "invalid",
        message: "supersedes_observation_id must be a non-empty string when provided",
      })
    }
  }

  if ("supersedes_observation_ids" in (raw as Record<string, unknown>)) {
    if (
      !Array.isArray(raw.supersedes_observation_ids) ||
      raw.supersedes_observation_ids.some((id) => typeof id !== "string" || id.trim().length === 0)
    ) {
      errors.push({
        field: "supersedes_observation_ids",
        code: "invalid",
        message: "supersedes_observation_ids must be an array of non-empty strings when provided",
      })
    }
  }

  if (
    typeof raw.source !== "string" ||
    !VALID_SOURCES.has(raw.source as CanonicalFinding["source"])
  ) {
    errors.push({
      field: "source",
      code: "enum",
      message: "source must be one of: slither, manual, pattern, scvd, solodit, fuzz",
    })
  }

  if (
    typeof raw.reported_by_agent !== "string" ||
    !VALID_AGENTS.has(raw.reported_by_agent as ArgusAgentName)
  ) {
    errors.push({
      field: "reported_by_agent",
      code: "enum",
      message:
        "reported_by_agent must be one of: argus, sentinel, pythia, audit-specialist, scribe, unknown",
    })
  }

  if (
    raw.reported_by_session_id != null &&
    (typeof raw.reported_by_session_id !== "string" ||
      raw.reported_by_session_id.trim().length === 0)
  ) {
    errors.push({
      field: "reported_by_session_id",
      code: "invalid",
      message: "reported_by_session_id must be a non-empty string when provided",
    })
  }

  if (raw.schema_version !== SCHEMA_VERSION) {
    errors.push({
      field: "schema_version",
      code: "version_mismatch",
      message: `schema_version must be ${SCHEMA_VERSION}`,
    })
  }

  if (errors.length > 0) {
    return { success: false, errors }
  }

  return { success: true, data: raw as unknown as CanonicalFinding }
}

export function validateCanonicalToolExecution(
  raw: unknown,
): ValidationResult<CanonicalToolExecution> {
  if (!isRecord(raw)) {
    return {
      success: false,
      errors: [
        {
          field: "$root",
          code: "type",
          message: "canonical tool execution must be an object",
        },
      ],
    }
  }

  const errors: ValidationError[] = []

  if (typeof raw.tool !== "string" || raw.tool.trim().length === 0) {
    errors.push({
      field: "tool",
      code: "required",
      message: "tool is required and must be a non-empty string",
    })
  }

  if (typeof raw.startTime !== "number" || !Number.isInteger(raw.startTime) || raw.startTime <= 0) {
    errors.push({
      field: "startTime",
      code: "invalid",
      message: "startTime must be a positive integer",
    })
  }

  if (raw.endTime != null && (typeof raw.endTime !== "number" || !Number.isInteger(raw.endTime))) {
    errors.push({
      field: "endTime",
      code: "invalid",
      message: "endTime must be an integer when provided",
    })
  }

  if (typeof raw.success !== "boolean") {
    errors.push({
      field: "success",
      code: "required",
      message: "success is required and must be a boolean",
    })
  }

  if (
    typeof raw.findingsCount !== "number" ||
    !Number.isInteger(raw.findingsCount) ||
    raw.findingsCount < 0
  ) {
    errors.push({
      field: "findingsCount",
      code: "invalid",
      message: "findingsCount must be a non-negative integer",
    })
  }

  pushFindingCountsErrors(errors, raw.findingCounts, "findingCounts")

  if (typeof raw.run_id !== "string" || raw.run_id.trim().length === 0) {
    errors.push({
      field: "run_id",
      code: "required",
      message: "run_id is required and must be a non-empty string",
    })
  }

  if (typeof raw.schema_version !== "string" || raw.schema_version.trim().length === 0) {
    errors.push({
      field: "schema_version",
      code: "required",
      message: "schema_version is required and must be a non-empty string",
    })
  }

  if (errors.length > 0) {
    return { success: false, errors }
  }

  return { success: true, data: raw as unknown as CanonicalToolExecution }
}
export function validateReportInput(raw: unknown): ValidationResult<ReportInput> {
  if (!isRecord(raw)) {
    return {
      success: false,
      errors: [
        {
          field: "$root",
          code: "type",
          message: "report input must be an object",
        },
      ],
    }
  }

  const errors: ValidationError[] = []

  pushRequiredRootStringError(errors, raw, "run_id")
  pushRequiredRootNumberError(errors, raw, "seq")
  pushRequiredRootStringError(errors, raw, "session_id")
  pushRequiredRootStringError(errors, raw, "tool_call_id")
  pushRequiredRootStringError(errors, raw, "source")
  pushRequiredRootStringError(errors, raw, "schema_version")
  pushRequiredRootStringError(errors, raw, "projectDir")

  if (raw.schema_version !== SCHEMA_VERSION) {
    errors.push({
      field: "schema_version",
      code: "version_mismatch",
      message: `schema_version must be ${SCHEMA_VERSION}`,
    })
  }

  pushFindingCountsErrors(errors, raw.findingCounts, "findingCounts")
  pushCoverageAttemptErrors(errors, raw.coverageAttempt)
  pushDroppedObservationsErrors(errors, raw.dropped_observations)

  if (!Array.isArray(raw.scope) || !raw.scope.every((item) => typeof item === "string")) {
    errors.push({
      field: "scope",
      code: "invalid",
      message: "scope must be an array of strings",
    })
  }

  if (!Array.isArray(raw.toolsExecuted)) {
    errors.push({
      field: "toolsExecuted",
      code: "invalid",
      message: "toolsExecuted must be an array",
    })
  } else {
    for (const [index, entry] of raw.toolsExecuted.entries()) {
      const toolValidation = validateCanonicalToolExecution(entry)
      if (toolValidation.success) continue
      for (const toolError of toolValidation.errors) {
        errors.push({
          field: `toolsExecuted[${index}].${toolError.field}`,
          code: toolError.code,
          message: toolError.message,
        })
      }
    }
  }

  if (raw.patternVersion != null && typeof raw.patternVersion !== "string") {
    errors.push({
      field: "patternVersion",
      code: "invalid",
      message: "patternVersion must be a string when provided",
    })
  }

  if (
    raw.skillsLoaded != null &&
    (!Array.isArray(raw.skillsLoaded) ||
      !raw.skillsLoaded.every((item) => typeof item === "string"))
  ) {
    errors.push({
      field: "skillsLoaded",
      code: "invalid",
      message: "skillsLoaded must be an array of strings when provided",
    })
  }

  if (!Array.isArray(raw.findings)) {
    errors.push({
      field: "findings",
      code: "invalid",
      message: "findings must be an array",
    })
  } else {
    for (const [index, finding] of raw.findings.entries()) {
      const findingValidation = validateCanonicalFinding(finding)
      if (findingValidation.success) continue
      for (const findingError of findingValidation.errors) {
        errors.push({
          field: `findings[${index}].${findingError.field}`,
          code: findingError.code,
          message: findingError.message,
        })
      }
    }
  }

  if (errors.length > 0) {
    return { success: false, errors }
  }

  return { success: true, data: raw as unknown as ReportInput }
}
