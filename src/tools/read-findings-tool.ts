import { readdirSync, readFileSync, statSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { type ToolContext, tool } from "@opencode-ai/plugin"
import { createAuditArtifactResolver } from "../shared/audit-artifact-resolver"
import { createLogger } from "../shared/logger"
import { defaultRootResolver } from "../shared/path-root-resolver"
import { resolveProjectDir } from "../shared/project-utils"
import type { CanonicalFinding, CanonicalToolExecution, ReportInput } from "../state/schemas"
import { SCHEMA_VERSION } from "../state/schemas"
import type { AuditState } from "../state/types"

type ReadFindingsArgs = {
  run_id: string
}

type ReportFinding = Omit<
  CanonicalFinding,
  | "run_id"
  | "seq"
  | "schema_version"
  | "observation_id"
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
  "observation_id",
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

function buildCompactInput(reportInput: ReportInput): CompactReportInput {
  return {
    run_id: reportInput.run_id,
    projectDir: reportInput.projectDir,
    findings: reportInput.findings.map(
      (f) => stripInternalKeys(f, FINDING_INTERNAL_KEYS) as ReportFinding,
    ),
    toolsExecuted: reportInput.toolsExecuted.map(
      (t) => stripInternalKeys(t, TOOL_EXECUTION_INTERNAL_KEYS) as ReportToolExecution,
    ),
    scope: reportInput.scope,
    ...(reportInput.soloditResults && { soloditResults: reportInput.soloditResults }),
    ...(reportInput.fuzzCounterexamples && {
      fuzzCounterexamples: reportInput.fuzzCounterexamples,
    }),
    ...(reportInput.coverageReport && { coverageReport: reportInput.coverageReport }),
    ...(reportInput.gasHotspots && { gasHotspots: reportInput.gasHotspots }),
    ...(reportInput.proxyContracts && { proxyContracts: reportInput.proxyContracts }),
    ...(reportInput.patternVersion && { patternVersion: reportInput.patternVersion }),
    ...(reportInput.skillsLoaded && { skillsLoaded: reportInput.skillsLoaded }),
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

function readAuditStateAsReportInput(projectDir: string, runId: string): ReportInput {
  const logger = createLogger()
  const argusRoot = defaultRootResolver.writeRoot(projectDir)

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
  const reportInput = readAuditStateAsReportInput(projectDir, runId)
  const compactInput = buildCompactInput(reportInput)

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
    instructions: `Output exceeds safe inline size (${Buffer.byteLength(inlineJson, "utf-8")} bytes). Full compact data written to: ${compactFilePath}. Use the read tool to access the file contents before generating the report.`,
  }

  return JSON.stringify(fileResult)
}

export const readFindingsTool = tool({
  description:
    "Read the materialized ReportInput artifact from disk for a given run. Returns the canonical findings, tools executed, scope, and all enrichment data. Scribe should call this before generating the report.",
  args: {
    run_id: tool.schema.string().describe("The run ID to read findings for."),
  },
  async execute(args, context) {
    return executeReadFindings(args, context)
  },
})
