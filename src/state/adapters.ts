import {
  type CanonicalFinding,
  SCHEMA_VERSION,
  type ValidationError,
  validateCanonicalFinding,
} from "./schemas"
import type { AuditPhase, Finding, FindingSeverity } from "./types"

export interface Diagnostic {
  level: "warn" | "error"
  code: string
  message: string
  field?: string
}

export type AdapterResult<T> = { data: T; diagnostics: Diagnostic[] }

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

const KNOWN_INPUT_FIELDS = new Set([
  "id",
  "check",
  "detector",
  "severity",
  "confidence",
  "description",
  "impact",
  "first_markdown_element",
  "file",
  "lines",
  "line",
  "line_start",
  "line_end",
  "source",
  "remediation",
  "exploitReference",
  "provenance",
  "run_id",
  "seq",
  "session_id",
  "tool_call_id",
  "schema_version",
  "elements",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeSeverity(value: unknown): CanonicalFinding["severity"] {
  if (typeof value !== "string") return "Informational"
  const lower = value.toLowerCase()
  const map: Record<string, CanonicalFinding["severity"]> = {
    critical: "Critical",
    high: "High",
    medium: "Medium",
    low: "Low",
    informational: "Informational",
    info: "Informational",
  }
  return map[lower] ?? "Informational"
}

function normalizeConfidence(value: unknown): CanonicalFinding["confidence"] {
  if (typeof value !== "string") return "Low"
  const lower = value.toLowerCase()
  const map: Record<string, CanonicalFinding["confidence"]> = {
    high: "High",
    medium: "Medium",
    low: "Low",
  }
  return map[lower] ?? "Low"
}

function normalizeLines(
  value: unknown,
  input: Record<string, unknown>,
): [number, number] | undefined {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    return [value[0], value[1]]
  }

  if (typeof input.line === "number") {
    return [input.line, input.line]
  }

  if (typeof input.line_start === "number" && typeof input.line_end === "number") {
    return [input.line_start, input.line_end]
  }

  return undefined
}

function slitherElementFileAlias(input: Record<string, unknown>): string | undefined {
  if (!Array.isArray(input.elements) || input.elements.length === 0) {
    return undefined
  }

  const first = input.elements[0]
  if (!isRecord(first)) return undefined
  const sourceMapping = first.source_mapping
  if (!isRecord(sourceMapping)) return undefined
  const filenameRelative = sourceMapping.filename_relative
  return typeof filenameRelative === "string" && filenameRelative.length > 0
    ? filenameRelative
    : undefined
}

function pushValidationDiagnostics(errors: ValidationError[]): Diagnostic[] {
  return errors.map((error) => ({
    level: "error",
    code: `validation.${error.code}`,
    message: error.message,
    field: error.field,
  }))
}

export function normalizeToCanonicalFinding(
  raw: Finding | Record<string, unknown>,
  runId: string,
  seq: number,
): AdapterResult<CanonicalFinding> {
  const diagnostics: Diagnostic[] = []
  const input = isRecord(raw) ? raw : {}

  for (const key of Object.keys(input)) {
    if (!KNOWN_INPUT_FIELDS.has(key)) {
      diagnostics.push({
        level: "warn",
        code: "field.dropped",
        message: `Dropped unknown field: ${key}`,
        field: key,
      })
    }
  }

  const check =
    typeof input.check === "string" && input.check.length > 0
      ? input.check
      : typeof input.detector === "string" && input.detector.length > 0
        ? input.detector
        : ""

  const description =
    typeof input.description === "string" && input.description.length > 0
      ? input.description
      : typeof input.impact === "string" && input.impact.length > 0
        ? input.impact
        : typeof input.first_markdown_element === "string" &&
            input.first_markdown_element.length > 0
          ? input.first_markdown_element
          : check

  const file =
    typeof input.file === "string" && input.file.length > 0
      ? input.file
      : (slitherElementFileAlias(input) ?? "")

  const lines = normalizeLines(input.lines, input)
  const severity = normalizeSeverity(input.severity)
  const confidence = normalizeConfidence(input.confidence)
  const source =
    typeof input.source === "string" &&
    VALID_SOURCES.has(input.source as CanonicalFinding["source"])
      ? (input.source as CanonicalFinding["source"])
      : "manual"

  const canonical: CanonicalFinding = {
    id:
      typeof input.id === "string" && input.id.length > 0
        ? input.id
        : `${check}:${file}:${lines?.[0] ?? 0}`,
    check,
    severity: VALID_SEVERITIES.has(severity) ? severity : "Informational",
    confidence: VALID_CONFIDENCES.has(confidence) ? confidence : "Low",
    description,
    file,
    lines: lines ?? [0, 0],
    source,
    remediation: typeof input.remediation === "string" ? input.remediation : undefined,
    exploitReference:
      typeof input.exploitReference === "string" ? input.exploitReference : undefined,
    provenance: isRecord(input.provenance)
      ? {
          timestamp:
            typeof input.provenance.timestamp === "number"
              ? input.provenance.timestamp
              : Date.now(),
          toolVersion:
            typeof input.provenance.toolVersion === "string"
              ? input.provenance.toolVersion
              : undefined,
          phase:
            typeof input.provenance.phase === "string"
              ? (input.provenance.phase as AuditPhase)
              : undefined,
        }
      : undefined,
    run_id: runId,
    seq,
    schema_version:
      typeof input.schema_version === "string" && input.schema_version.length > 0
        ? input.schema_version
        : SCHEMA_VERSION,
  }

  const validation = validateCanonicalFinding(canonical)
  if (!validation.success) {
    diagnostics.push(...pushValidationDiagnostics(validation.errors))
  }

  return { data: canonical, diagnostics }
}

export function normalizeLegacyFindingsArray(
  raw: unknown[],
  runId: string,
): { findings: CanonicalFinding[]; diagnostics: Diagnostic[] } {
  const findings: CanonicalFinding[] = []
  const diagnostics: Diagnostic[] = []

  for (const [index, item] of raw.entries()) {
    const normalized = normalizeToCanonicalFinding(isRecord(item) ? item : {}, runId, index + 1)
    diagnostics.push(
      ...normalized.diagnostics.map((d) => ({
        ...d,
        message: `[index:${index}] ${d.message}`,
      })),
    )

    const hasErrors = normalized.diagnostics.some((d) => d.level === "error")
    if (!hasErrors) {
      findings.push(normalized.data)
    }
  }

  return { findings, diagnostics }
}
