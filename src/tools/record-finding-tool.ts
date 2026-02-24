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
  findings: Array<{ id: string; check: string; severity: string; file: string }>
  schema_version: string
  note: string
}

function parseFindingObject(raw: string, label: "finding" | "findings"): Record<string, unknown>[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }

  if (label === "finding") {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("finding must be a JSON object")
    }
    return [parsed as Record<string, unknown>]
  }

  if (!Array.isArray(parsed)) {
    throw new Error("findings must be a JSON array")
  }

  return parsed.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  )
}

function normalizeAgent(value: string): ArgusAgentName {
  if (value === "argus" || value === "sentinel" || value === "pythia" || value === "scribe") {
    return value
  }

  return "unknown"
}

export async function executeRecordFinding(
  args: RecordFindingArgs,
  context: ToolContext,
): Promise<string> {
  const rawFindings: Record<string, unknown>[] = []

  if (typeof args.finding === "string" && args.finding.trim().length > 0) {
    rawFindings.push(...parseFindingObject(args.finding, "finding"))
  }
  if (typeof args.findings === "string" && args.findings.trim().length > 0) {
    rawFindings.push(...parseFindingObject(args.findings, "findings"))
  }

  if (rawFindings.length === 0) {
    throw new Error("Provide at least one finding via finding or findings")
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
    throw new Error(`Failed to record finding(s): ${errors.join("; ")}`)
  }

  const response: RecordFindingResponse = {
    success: true,
    count: findings.length,
    findings: findings.map((f) => ({
      id: f.id,
      check: f.check,
      severity: f.severity,
      file: f.file,
    })),
    schema_version: SCHEMA_VERSION,
    note: "Findings recorded to event journal. The system assigns the canonical run_id automatically — use the run_id from <argus-context> for Scribe dispatch.",
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
      .describe("Serialized JSON object containing a single finding payload."),
    findings: tool.schema
      .string()
      .optional()
      .describe("Serialized JSON array containing one or more finding payload objects."),
  },
  async execute(args, context) {
    return executeRecordFinding(args, context)
  },
})
