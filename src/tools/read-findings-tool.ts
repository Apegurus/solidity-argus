import { readdirSync, readFileSync, statSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { type ToolContext, tool } from "@opencode-ai/plugin"
import { ensureRunArtifactsMaterialized } from "../features/persistent-state/findings-materializer"
import { createAuditArtifactResolver } from "../shared/audit-artifact-resolver"
import {
  DROPPED_OBSERVATION_REASONS,
  type DroppedObservation,
} from "../shared/dropped-observations"
import { validateFindingLineage } from "../shared/lineage-validator"
import { createLogger } from "../shared/logger"
import { defaultRootResolver } from "../shared/path-root-resolver"
import { resolveProjectDir } from "../shared/project-utils"
import type { CanonicalFinding, CanonicalToolExecution, ReportInput } from "../state/schemas"
import { SCHEMA_VERSION } from "../state/schemas"
import type { AuditState } from "../state/types"

type ReadFindingsArgs = {
  run_id: string
  findings_offset?: number
  findings_limit?: number
}

type ReportFinding = Omit<
  CanonicalFinding,
  | "run_id"
  | "seq"
  | "schema_version"
  | "issue_fingerprint"
  | "observation_fingerprint"
  | "reported_by_agent"
  | "reported_by_session_id"
>

type ReportToolExecution = Omit<CanonicalToolExecution, "run_id" | "schema_version">

type CompactReportInput = Omit<
  ReportInput,
  | "findings"
  | "toolsExecuted"
  | "run_id"
  | "seq"
  | "session_id"
  | "tool_call_id"
  | "source"
  | "schema_version"
> & {
  run_id: string
  findings: ReportFinding[]
  toolsExecuted: ReportToolExecution[]
  findingsPage?: {
    offset: number
    limit: number
    total: number
  }
}

type ReadFindingsInlineResult = {
  success: boolean
  truncated: false
  source: "report-input.json"
  reportInput: CompactReportInput
}

type ReadFindingsFileResult = {
  success: boolean
  truncated: true
  source: "report-input.json"
  compactReportInputFile: string
  summary: {
    run_id: string
    findingsCount: number
    toolsExecutedCount: number
    scope: string[]
    severityDistribution: Record<string, number>
    topFindings: Array<{ title: string; severity: string; category: string }>
  }
  instructions: string
}

export type ReadFindingsResult = ReadFindingsInlineResult | ReadFindingsFileResult

/**
 * OpenCode truncates plugin tool output above ~50KB (exact threshold unknown,
 * but observed at 122KB). We use 40KB as a safe ceiling to avoid truncation.
 */
const OUTPUT_SIZE_THRESHOLD_BYTES = 40_000

const FINDING_INTERNAL_KEYS: ReadonlySet<string> = new Set([
  "run_id",
  "seq",
  "schema_version",
  "issue_fingerprint",
  "observation_fingerprint",
  "reported_by_agent",
  "reported_by_session_id",
])

const TOOL_EXECUTION_INTERNAL_KEYS: ReadonlySet<string> = new Set(["run_id", "schema_version"])

function stripInternalKeys(obj: object, keysToStrip: ReadonlySet<string>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (!keysToStrip.has(key)) {
      result[key] = value
    }
  }
  return result
}

function normalizePageArgs(args: ReadFindingsArgs): { offset: number; limit: number } | null {
  if (args.findings_offset == null && args.findings_limit == null) return null

  const offset = args.findings_offset ?? 0
  const limit = args.findings_limit ?? 50
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("findings_offset must be a non-negative integer")
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("findings_limit must be an integer between 1 and 500")
  }
  return { offset, limit }
}

function buildCompactInput(
  reportInput: ReportInput,
  page: { offset: number; limit: number } | null = null,
): CompactReportInput {
  const rawFindings = page
    ? reportInput.findings.slice(page.offset, page.offset + page.limit)
    : reportInput.findings
  return {
    run_id: reportInput.run_id,
    projectDir: reportInput.projectDir,
    findings: rawFindings.map((f) => stripInternalKeys(f, FINDING_INTERNAL_KEYS) as ReportFinding),
    toolsExecuted: reportInput.toolsExecuted.map(
      (t) => stripInternalKeys(t, TOOL_EXECUTION_INTERNAL_KEYS) as ReportToolExecution,
    ),
    scope: reportInput.scope,
    ...(reportInput.dropped_observations && {
      dropped_observations: reportInput.dropped_observations,
    }),
    ...(reportInput.soloditResults && { soloditResults: reportInput.soloditResults }),
    ...(reportInput.fuzzCounterexamples && {
      fuzzCounterexamples: reportInput.fuzzCounterexamples,
    }),
    ...(reportInput.coverageReport && { coverageReport: reportInput.coverageReport }),
    ...(reportInput.gasHotspots && { gasHotspots: reportInput.gasHotspots }),
    ...(reportInput.proxyContracts && { proxyContracts: reportInput.proxyContracts }),
    ...(reportInput.patternVersion && { patternVersion: reportInput.patternVersion }),
    ...(reportInput.skillsLoaded && { skillsLoaded: reportInput.skillsLoaded }),
    ...(page && {
      findingsPage: {
        offset: page.offset,
        limit: page.limit,
        total: reportInput.findings.length,
      },
    }),
  }
}

function buildSeverityDistribution(findings: ReportFinding[]): Record<string, number> {
  const dist: Record<string, number> = {}
  for (const f of findings) {
    const sev = (f as Record<string, unknown>).severity as string | undefined
    const key = sev ?? "Unknown"
    dist[key] = (dist[key] ?? 0) + 1
  }
  return dist
}

function buildTopFindings(
  findings: ReportFinding[],
  limit = 10,
): Array<{ title: string; severity: string; category: string }> {
  const severityOrder: Record<string, number> = {
    Critical: 0,
    High: 1,
    Medium: 2,
    Low: 3,
    Informational: 4,
  }
  const sorted = [...findings].sort((a, b) => {
    const ra = a as Record<string, unknown>
    const rb = b as Record<string, unknown>
    const sa = severityOrder[(ra.severity as string) ?? ""] ?? 5
    const sb = severityOrder[(rb.severity as string) ?? ""] ?? 5
    return sa - sb
  })
  return sorted.slice(0, limit).map((f) => {
    const r = f as Record<string, unknown>
    return {
      title: (r.title as string) ?? (r.description as string)?.slice(0, 80) ?? "Untitled",
      severity: (r.severity as string) ?? "Unknown",
      category: (r.category as string) ?? "Unknown",
    }
  })
}

function convertAuditStateToReportInput(
  state: AuditState,
  runId: string,
  projectDir: string,
): ReportInput {
  const findings: CanonicalFinding[] = (state.findings ?? []).map((f, i) => ({
    ...f,
    run_id: state.sessionId ?? runId,
    seq: i + 1,
    session_id: "audit",
    tool_call_id: "",
    source: f.source ?? ("unknown" as const),
    schema_version: SCHEMA_VERSION,
    issue_fingerprint: f.id ?? "",
    observation_fingerprint: f.id ?? "",
    observation_id: f.id ?? "",
    reported_by_agent: f.reported_by_agent ?? ("unknown" as const),
    reported_by_session_id: f.reported_by_session_id ?? "",
  }))

  return {
    run_id: state.sessionId ?? runId,
    seq: findings.length,
    session_id: "audit",
    tool_call_id: "",
    source: "audit-state",
    schema_version: SCHEMA_VERSION,
    projectDir: state.projectDir ?? projectDir,
    findings,
    toolsExecuted: (state.toolsExecuted ?? []).map((t) => ({
      ...t,
      run_id: state.sessionId ?? runId,
      schema_version: SCHEMA_VERSION,
    })),
    scope: state.scope?.length
      ? state.scope
      : [...new Set(findings.map((f) => f.file).filter(Boolean))],
    soloditResults: state.soloditResults,
    fuzzCounterexamples: state.fuzzCounterexamples,
    coverageReport: state.coverageReport,
    gasHotspots: state.gasHotspots,
    proxyContracts: state.proxyContracts,
  }
}

/**
 * Scan .argus/sessions/ for the newest state file with findings.
 * Mirrors the fallback logic in audit-state-manager.ts load().
 */
function readNewestSessionState(argusRoot: string): AuditState | null {
  const sessionsDir = join(argusRoot, "sessions")
  try {
    const entries = readdirSync(sessionsDir)
    const stateFiles = entries.filter((e) => e.startsWith("state-") && e.endsWith(".json"))
    if (stateFiles.length === 0) return null

    const ranked = stateFiles
      .map((name) => {
        const filePath = join(sessionsDir, name)
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
        const state = JSON.parse(readFileSync(entry.path, "utf8")) as AuditState
        if (state.findings && state.findings.length > 0) {
          return state
        }
      } catch {
        /* skip unreadable files */
      }
    }
  } catch {
    /* sessions dir doesn't exist */
  }
  return null
}

function readRawFindings(projectDir: string, runId: string): CanonicalFinding[] | null {
  const findingsFile = createAuditArtifactResolver(runId, projectDir).paths().findingsFile
  try {
    const parsed = JSON.parse(readFileSync(findingsFile, "utf8")) as { findings?: unknown }
    return Array.isArray(parsed.findings) ? (parsed.findings as CanonicalFinding[]) : null
  } catch {
    return null
  }
}

function parseDroppedObservations(raw: unknown): DroppedObservation[] | null {
  if (raw == null) return []
  if (!Array.isArray(raw)) return null

  const validReasons = new Set<string>(DROPPED_OBSERVATION_REASONS)
  const dropped: DroppedObservation[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null
    const record = item as Record<string, unknown>
    if (typeof record.observation_id !== "string" || record.observation_id.length === 0) return null
    if (typeof record.reason !== "string" || !validReasons.has(record.reason)) return null
    const drop: DroppedObservation = {
      observation_id: record.observation_id,
      reason: record.reason as DroppedObservation["reason"],
    }
    if (typeof record.note === "string" && record.note.length > 0) {
      drop.note = record.note
    }
    dropped.push(drop)
  }
  return dropped
}

function readAuditStateAsReportInput(projectDir: string, runId: string): ReportInput {
  const logger = createLogger()
  const argusRoot = defaultRootResolver.writeRoot(projectDir)

  const dedupedFile = createAuditArtifactResolver(runId, projectDir).paths().dedupedFindingsFile
  try {
    const dedupedRaw = JSON.parse(readFileSync(dedupedFile, "utf8")) as {
      findings?: unknown[]
      dropped_observations?: unknown[]
      run_id?: string
    }
    if (Array.isArray(dedupedRaw.findings) && dedupedRaw.findings.length > 0) {
      logger.debug(`Loaded deduped findings from: ${dedupedFile}`)
      const rawFindings = readRawFindings(projectDir, runId)
      if (!rawFindings) {
        throw new Error(
          `Cannot verify deduped lineage because .argus/runs/${runId}/findings.json is missing or invalid`,
        )
      }

      const droppedObservations = parseDroppedObservations(dedupedRaw.dropped_observations)
      if (!droppedObservations) {
        throw new Error(
          "Invalid deduped findings artifact: dropped_observations must be an array of valid dropped observation entries",
        )
      }

      const lineage = validateFindingLineage(
        rawFindings,
        dedupedRaw.findings as CanonicalFinding[],
        droppedObservations,
      )
      if (!lineage.valid) {
        throw new Error(
          `Invalid deduped findings lineage: missing=${lineage.missing_observation_ids.length}, extra=${lineage.phantom_observation_ids.length}, duplicates=${lineage.duplicate_observation_ids.length}, dropped_extra=${lineage.phantom_dropped_observation_ids.length}, dropped_duplicates=${lineage.duplicate_dropped_observation_ids.length}, mapped_dropped_overlap=${lineage.overlapping_mapped_dropped_observation_ids.length}, invalid_dropped=${lineage.invalid_dropped_observations.length}, count_mismatches=${lineage.count_mismatches.length}`,
        )
      }

      const perRunFile = createAuditArtifactResolver(runId, projectDir).paths().reportInputFile
      let baseReportInput: Partial<ReportInput> = {}
      try {
        baseReportInput = JSON.parse(readFileSync(perRunFile, "utf8")) as Partial<ReportInput>
      } catch {}

      return {
        ...baseReportInput,
        run_id: dedupedRaw.run_id ?? runId,
        findings: dedupedRaw.findings as CanonicalFinding[],
        dropped_observations: droppedObservations,
        toolsExecuted: baseReportInput.toolsExecuted ?? [],
        scope: baseReportInput.scope ?? [],
        projectDir: baseReportInput.projectDir ?? projectDir,
        seq: 0,
        session_id: "audit",
        tool_call_id: "",
        source: "deduped-findings",
        schema_version: SCHEMA_VERSION,
      } as ReportInput
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("Cannot verify deduped lineage") ||
        error.message.startsWith("Invalid deduped findings"))
    ) {
      throw error
    }
    logger.debug(`No deduped findings at ${dedupedFile}`)
  }

  // 1. Per-run report-input artifact (materialized by findings-materializer into runs/{runId}/)
  const perRunFile = createAuditArtifactResolver(runId, projectDir).paths().reportInputFile
  try {
    const data = JSON.parse(readFileSync(perRunFile, "utf8")) as ReportInput
    if (data.findings && data.findings.length > 0) {
      logger.debug(`Loaded report-input from per-run artifact: ${perRunFile}`)
      return data
    }
  } catch {
    logger.debug(`No per-run report-input at ${perRunFile}`)
  }

  // 2. Flat report-input at argus root (legacy location)
  const flatFile = join(argusRoot, "report-input.json")
  try {
    const data = JSON.parse(readFileSync(flatFile, "utf8")) as ReportInput
    if (data.findings && data.findings.length > 0) {
      logger.debug(`Loaded report-input from flat file: ${flatFile}`)
      return data
    }
  } catch {
    logger.debug(`No flat report-input at ${flatFile}`)
  }

  // 3. Per-session state files (per-session managers write to sessions/state-{sessionId}.json)
  const sessionState = readNewestSessionState(argusRoot)
  if (sessionState) {
    logger.debug("Loaded audit state from newest session state file")
    return convertAuditStateToReportInput(sessionState, runId, projectDir)
  }

  // 4. Shared audit state (legacy fallback)
  const sharedStateFile = join(argusRoot, "argus-state.json")
  try {
    const state = JSON.parse(readFileSync(sharedStateFile, "utf8")) as AuditState
    if (state.findings && state.findings.length > 0) {
      logger.debug(`Loaded audit state from shared file: ${sharedStateFile}`)
      return convertAuditStateToReportInput(state, runId, projectDir)
    }
  } catch {
    /* shared state not available */
  }

  throw new Error(
    `Cannot read findings from any source for run ${runId}. Checked: per-run artifact (${perRunFile}), flat file (${flatFile}), session state files, shared state (${sharedStateFile})`,
  )
}

export async function executeReadFindings(
  args: ReadFindingsArgs,
  context: ToolContext,
): Promise<string> {
  const runId = args.run_id
  if (!runId || runId.trim().length === 0) {
    throw new Error("run_id is required")
  }

  const projectDir = resolveProjectDir(context)
  const logger = createLogger()
  await ensureRunArtifactsMaterialized(runId, projectDir, context.sessionID, {
    warn: (msg) => logger.debug(msg),
  })
  const reportInput = readAuditStateAsReportInput(projectDir, runId)
  const page = normalizePageArgs(args)
  const compactInput = buildCompactInput(reportInput, page)

  const inlineJson = JSON.stringify({
    success: true,
    truncated: false,
    source: "report-input.json" as const,
    reportInput: compactInput,
  })

  if (Buffer.byteLength(inlineJson, "utf-8") <= OUTPUT_SIZE_THRESHOLD_BYTES) {
    return inlineJson
  }

  const resolver = createAuditArtifactResolver(runId, projectDir)
  const compactFilePath = resolver
    .paths()
    .reportInputFile.replace("report-input.json", "compact-report-input.json")
  await mkdir(dirname(compactFilePath), { recursive: true })
  await writeFile(compactFilePath, JSON.stringify(compactInput, null, 2))

  const fileResult: ReadFindingsFileResult = {
    success: true,
    truncated: true,
    source: "report-input.json",
    compactReportInputFile: compactFilePath,
    summary: {
      run_id: runId,
      findingsCount: compactInput.findings.length,
      toolsExecutedCount: compactInput.toolsExecuted.length,
      scope: compactInput.scope,
      severityDistribution: buildSeverityDistribution(compactInput.findings),
      topFindings: buildTopFindings(compactInput.findings),
    },
    instructions: `Output exceeds safe inline size (${Buffer.byteLength(inlineJson, "utf-8")} bytes). Full compact data written to: ${compactFilePath}. Use the read tool to access the file contents before generating the report. Deduped findings must reference each raw finding's canonical observation_id value in observation_ids; do not use id or session_id values as lineage.`,
  }

  return JSON.stringify(fileResult)
}

export const readFindingsTool = tool({
  description:
    "Read the materialized ReportInput artifact from disk for a given run. Returns the canonical findings, tools executed, scope, and all enrichment data. Scribe should call this before generating the report.",
  args: {
    run_id: tool.schema.string().describe("The run ID to read findings for."),
    findings_offset: tool.schema
      .number()
      .optional()
      .describe("Optional zero-based finding offset for paged inline retrieval."),
    findings_limit: tool.schema
      .number()
      .optional()
      .describe("Optional finding page size for inline retrieval (1-500)."),
  },
  async execute(args, context) {
    return executeReadFindings(args, context)
  },
})
