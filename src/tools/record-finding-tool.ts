import { randomUUID } from "node:crypto"
import { type ToolContext, tool } from "@opencode-ai/plugin"
import { isNonEmptyString } from "../shared/type-guards"
import { type Diagnostic, normalizeToCanonicalFinding } from "../state/adapters"
import { type CanonicalFinding, SCHEMA_VERSION } from "../state/schemas"
import type { ArgusAgentName } from "../state/types"

type RecordFindingArgs = {
  finding?: string
  findings?: string
}

type RecordFindingResponse = {
  success: boolean
  count: number
  findings: CanonicalFinding[]
  schema_version: string
  note: string
  run_id: string
  canonical_run_id: string | null
  run_id_reconciliation: {
    returned_run_id: string
    canonical_run_id: string | null
    status: "pending_journal_reconciliation"
  }
  normalization_diagnostics: Array<Diagnostic & { index: number }>
  enrichment_warnings?: string[]
  enrichment_hint?: string
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
  if (
    value === "argus" ||
    value === "sentinel" ||
    value === "pythia" ||
    value === "audit-specialist" ||
    value === "scribe"
  ) {
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

function collectMissingEnrichmentFields(
  finding: ReturnType<typeof normalizeToCanonicalFinding>["data"],
): string[] {
  const missing: string[] = []
  if (!isNonEmptyString(finding.impact)) missing.push("impact")
  if (!isNonEmptyString(finding.recommendation)) missing.push("recommendation")
  if (!isNonEmptyString(finding.proofOfConcept)) missing.push("proofOfConcept")
  return missing
}

export async function executeRecordFinding(
  args: RecordFindingArgs,
  context: ToolContext,
): Promise<string> {
  const rawFindings: Record<string, unknown>[] = []

  if (isNonEmptyString(args.finding)) {
    const result = parseFindingObject(args.finding, "finding")
    if (!result.ok) return errorResponse(result.error)
    rawFindings.push(...result.data)
  }
  if (isNonEmptyString(args.findings)) {
    const result = parseFindingObject(args.findings, "findings")
    if (!result.ok) return errorResponse(result.error)
    rawFindings.push(...result.data)
  }

  if (rawFindings.length === 0) {
    return errorResponse("Provide at least one finding via finding or findings")
  }

  for (const f of rawFindings) {
    if (!f.check && typeof f.title === "string") f.check = f.title
    if (!f.check && typeof f.name === "string") f.check = f.name
    if (!f.file && typeof f.location === "string") {
      const loc = f.location as string
      const colonIdx = loc.lastIndexOf(":")
      if (colonIdx > 0 && /^\d+(-\d+)?$/.test(loc.substring(colonIdx + 1))) {
        f.file = loc.substring(0, colonIdx)
        if (!f.lines) {
          const match = loc.substring(colonIdx + 1).match(/^(\d+)(?:-(\d+))?$/)
          if (match) {
            f.lines = [
              Number.parseInt(match[1] ?? "0", 10),
              Number.parseInt(match[2] ?? match[1] ?? "0", 10),
            ]
          }
        }
      } else {
        f.file = loc
      }
    }
  }

  const reportedByAgent = normalizeAgent(context.agent)
  const reportedBySessionId = context.sessionID
  const runId = "tool-local"
  const callToken = randomUUID()
  const projectDir = context.directory ?? process.cwd()

  const findings: ReturnType<typeof normalizeToCanonicalFinding>["data"][] = []
  const normalizationDiagnostics: Array<Diagnostic & { index: number }> = []
  const errors: string[] = []

  for (const [index, rawFinding] of rawFindings.entries()) {
    const normalized = normalizeToCanonicalFinding(
      rawFinding,
      runId,
      index + 1,
      {
        reportedByAgent,
        reportedBySessionId,
        observationId: `${reportedBySessionId}:${callToken}:${index + 1}`,
      },
      projectDir,
    )

    const diagnosticsErrors = normalized.diagnostics.filter((diag) => diag.level === "error")
    normalizationDiagnostics.push(...normalized.diagnostics.map((diag) => ({ ...diag, index })))
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

  // Warn when report-quality enrichment is missing without dropping findings.
  const enrichmentWarnings: string[] = []
  const HIGH_SEVERITIES = new Set(["Critical", "High"])
  for (const f of findings) {
    const missing = collectMissingEnrichmentFields(f)
    if (missing.length > 0) {
      if (f.source === "slither") {
        enrichmentWarnings.push(
          `[${f.severity}] Slither finding ${f.check} in ${f.file} is missing: ${missing.join(", ")}. The finding was recorded, but Scribe must enrich it before final reporting.`,
        )
        continue
      }

      if (!HIGH_SEVERITIES.has(f.severity)) continue

      enrichmentWarnings.push(
        `[${f.severity}] ${f.check} in ${f.file} is missing: ${missing.join(", ")}. Quality gate will flag this.`,
      )
    }
  }

  const response: RecordFindingResponse = {
    success: true,
    count: findings.length,
    findings,
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    canonical_run_id: null,
    run_id_reconciliation: {
      returned_run_id: runId,
      canonical_run_id: null,
      status: "pending_journal_reconciliation",
    },
    normalization_diagnostics: normalizationDiagnostics,
    note: "Findings recorded to event journal. Each finding's run_id is a transient placeholder (tool-local) that the journal reconciles to the canonical run_id on persistence. Use the run_id from <argus-context> for Scribe dispatch.",
    ...(enrichmentWarnings.length > 0
      ? {
          enrichment_warnings: enrichmentWarnings,
          enrichment_hint:
            "Critical and High findings MUST include impact, recommendation, and proofOfConcept fields. Slither findings should include all three fields before Scribe persists deduped findings; incomplete Slither records are preserved but will be flagged by report quality gates if not enriched downstream.",
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
        'Serialized JSON object for a single finding. Required fields: check (string, e.g. "reentrancy-eth"), severity (Critical|High|Medium|Low|Informational), confidence (High|Medium|Low), description (string), file (relative path, e.g. "src/Vault.sol"), lines ([startLine, endLine] tuple), source ("manual"|"slither"|"pattern"|"scvd"|"solodit"|"fuzz"). Optional: confidence_score (integer 0-100 from refutation-rubric; findings with score >= reporting.confidenceThreshold, default 80, render in Findings; lower scores render in Leads), rubric_verdict ("CONFIRMED"|"DEMOTED"|"REJECTED_DEMOTED" — the structured 4-gate verdict from refutation-rubric; agents applying the rubric MUST set this alongside confidence_score so the reporter can group findings deterministically), impact, recommendation, proofOfConcept (mandatory for Critical/High final report findings; strongly recommended for Slither-source findings before Scribe persistence).',
      ),
    findings: tool.schema
      .string()
      .optional()
      .describe(
        'Serialized JSON array of finding objects. Each object requires the same fields as the finding parameter: check, severity, confidence, description, file, lines, source. Optional confidence_score is an integer 0-100 from refutation-rubric; findings with score >= reporting.confidenceThreshold (default 80) render in Findings, lower scores render in Leads. Optional rubric_verdict ("CONFIRMED"|"DEMOTED"|"REJECTED_DEMOTED") is the structured 4-gate verdict — agents applying the rubric MUST set this alongside confidence_score so the reporter can group findings deterministically. impact, recommendation, and proofOfConcept are mandatory for Critical/High final report findings and strongly recommended for Slither-source findings before Scribe persistence. Aliases title/name → check and location → file are accepted but canonical names are preferred.',
      ),
  },
  async execute(args, context) {
    return executeRecordFinding(args, context)
  },
})
