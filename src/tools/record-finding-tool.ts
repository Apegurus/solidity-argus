import { type ToolContext, tool } from "@opencode-ai/plugin"
import { normalizeToCanonicalFinding } from "../state/adapters"
import { SCHEMA_VERSION } from "../state/schemas"
import type { ArgusAgentName } from "../state/types"

type RecordFindingArgs = {
  finding?: string
  findings?: string
}

type RecordFindingResponse = {
  success: boolean
  count: number
  findings: Array<{
    id: string
    check: string
    severity: string
    file: string
    description: string
    lines: [number, number]
    source: string
  }>
  schema_version: string
  note: string
}

type ParseResult = { ok: true; data: Record<string, unknown>[] } | { ok: false; error: string }

function parseFindingObject(raw: string, label: "finding" | "findings"): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: `${label} must be valid JSON` }
  }

  if (label === "finding") {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: "finding must be a JSON object" }
    }
    return { ok: true, data: [parsed as Record<string, unknown>] }
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: "findings must be a JSON array" }
  }

  return {
    ok: true,
    data: parsed.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    ),
  }
}

function normalizeAgent(value: string): ArgusAgentName {
  if (value === "argus" || value === "sentinel" || value === "pythia" || value === "scribe") {
    return value
  }

  return "unknown"
}

function errorResponse(error: string): string {
  return JSON.stringify({
    success: false,
    count: 0,
    findings: [],
    schema_version: SCHEMA_VERSION,
    note: error,
    error,
  })
}

export async function executeRecordFinding(
  args: RecordFindingArgs,
  context: ToolContext,
): Promise<string> {
  const rawFindings: Record<string, unknown>[] = []

  if (typeof args.finding === "string" && args.finding.trim().length > 0) {
    const result = parseFindingObject(args.finding, "finding")
    if (!result.ok) return errorResponse(result.error)
    rawFindings.push(...result.data)
  }
  if (typeof args.findings === "string" && args.findings.trim().length > 0) {
    const result = parseFindingObject(args.findings, "findings")
    if (!result.ok) return errorResponse(result.error)
    rawFindings.push(...result.data)
  }

  if (rawFindings.length === 0) {
    return errorResponse("Provide at least one finding via finding or findings")
  }

  const reportedByAgent = normalizeAgent(context.agent)
  const reportedBySessionId = context.sessionID
  const runId = "tool-local"

  const findings: ReturnType<typeof normalizeToCanonicalFinding>["data"][] = []
  const errors: string[] = []

  for (const [index, rawFinding] of rawFindings.entries()) {
    const normalized = normalizeToCanonicalFinding(rawFinding, runId, index + 1, {
      reportedByAgent,
      reportedBySessionId,
      observationId: `${reportedBySessionId}:${index + 1}`,
    })

    const diagnosticsErrors = normalized.diagnostics.filter((diag) => diag.level === "error")
    if (diagnosticsErrors.length > 0) {
      errors.push(
        ...diagnosticsErrors.map(
          (diag) => `[index:${index}] ${diag.field ?? "$root"}: ${diag.message}`,
        ),
      )
      continue
    }

    findings.push(normalized.data)
  }

  if (errors.length > 0) {
    return errorResponse(`Failed to record finding(s): ${errors.join("; ")}`)
  }

  // Warn when Critical/High findings are missing enrichment fields
  const enrichmentWarnings: string[] = []
  const HIGH_SEVERITIES = new Set(["Critical", "High"])
  for (const f of findings) {
    if (!HIGH_SEVERITIES.has(f.severity)) continue
    const missing: string[] = []
    if (!f.impact) missing.push("impact")
    if (!f.recommendation) missing.push("recommendation")
    if (!f.proofOfConcept) missing.push("proofOfConcept")
    if (missing.length > 0) {
      enrichmentWarnings.push(
        `[${f.severity}] ${f.check} in ${f.file} is missing: ${missing.join(", ")}. Quality gate will flag this.`,
      )
    }
  }

  const response: RecordFindingResponse = {
    success: true,
    count: findings.length,
    findings: findings.map((f) => ({
      id: f.id,
      check: f.check,
      severity: f.severity,
      file: f.file,
      description: f.description,
      lines: f.lines,
      source: f.source,
    })),
    schema_version: SCHEMA_VERSION,
    note: "Findings recorded to event journal. The system assigns the canonical run_id automatically — use the run_id from <argus-context> for Scribe dispatch.",
    ...(enrichmentWarnings.length > 0
      ? {
          enrichment_warnings: enrichmentWarnings,
          enrichment_hint:
            "Critical and High findings MUST include impact, recommendation, and proofOfConcept fields. Re-submit with these fields to pass the quality gate.",
        }
      : {}),
  }

  return JSON.stringify(response)
}

export const recordFindingTool = tool({
  description:
    "Record manually identified findings in canonical format for durable event-backed tracking.",
  args: {
    finding: tool.schema
      .string()
      .optional()
      .describe(
        'Serialized JSON object for a single finding. Required fields: check (string, e.g. "reentrancy-eth"), severity (Critical|High|Medium|Low|Informational), confidence (High|Medium|Low), description (string), file (relative path, e.g. "src/Vault.sol"), lines ([startLine, endLine] tuple), source ("manual"). Optional: impact, recommendation, proofOfConcept (mandatory for Critical/High).',
      ),
    findings: tool.schema
      .string()
      .optional()
      .describe(
        "Serialized JSON array of finding objects. Each object requires the same fields as the finding parameter: check, severity, confidence, description, file, lines, source. Do NOT use title, location, or other non-canonical field names.",
      ),
  },
  async execute(args, context) {
    return executeRecordFinding(args, context)
  },
})
