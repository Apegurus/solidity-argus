import type {
  AuditPhase,
  Finding,
  FindingSeverity,
  FuzzCounterexample,
  SoloditResult,
  ToolExecution,
} from "./types"

export const SCHEMA_VERSION = "1.0.0"

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
  toolsExecuted: CanonicalToolExecution[]
  scope: string[]
  soloditResults?: SoloditResult[]
  fuzzCounterexamples?: FuzzCounterexample[]
  coverageReport?: CoverageReport
  gasHotspots?: GasHotspot[]
  proxyContracts?: ProxyContract[]
  patternVersion?: string
  skillsLoaded?: string[]
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

const VALID_SEVERITIES: ReadonlySet<FindingSeverity> = new Set([
  "Critical",
  "High",
  "Medium",
  "Low",
  "Informational",
])
const VALID_CONFIDENCES: ReadonlySet<CanonicalFinding["confidence"]> = new Set([
  "High",
  "Medium",
  "Low",
])
const VALID_SOURCES: ReadonlySet<CanonicalFinding["source"]> = new Set([
  "slither",
  "manual",
  "pattern",
  "scvd",
  "solodit",
  "fuzz",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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
