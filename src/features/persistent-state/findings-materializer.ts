import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { createAuditArtifactResolver } from "../../shared/audit-artifact-resolver"
import { finalizeProjectedFindings } from "../../state/finding-aggregation"
import {
  projectFindings,
  projectReportInput,
  projectToolExecutions,
  stableHash,
} from "../../state/projectors"
import type { CanonicalFinding, CanonicalToolExecution, ReportInput } from "../../state/schemas"
import { SCHEMA_VERSION } from "../../state/schemas"
import { readEvents } from "./event-sink"

export type MaterializeFindingsTrigger =
  | "session.idle"
  | "session.deleted"
  | "tool.execute.after"
  | "on-demand"

export interface MaterializeFindingsForRunOptions {
  failFast?: boolean
  warn?: (message: string) => void
}

export interface FindingsArtifact {
  run_id: string
  session_id: string
  schema_version: string
  seq_first: number
  seq_last: number
  event_count: number
  content_hash: string
  generated_at: number
  findings: CanonicalFinding[]
  toolsExecuted: CanonicalToolExecution[]
}

export interface FindingsMaterializeOptions {
  validateSessionId?: boolean
  requireEvents?: boolean
}

function isForgeAvailable(unavailableTools?: string[]): boolean {
  return !(unavailableTools ?? []).includes("forge")
}

export async function materializeFindings(
  runId: string,
  projectDir: string,
  sessionId?: string,
  options: FindingsMaterializeOptions = {},
): Promise<FindingsArtifact> {
  const events = await readEvents(runId, projectDir)
  if (options.requireEvents && events.length === 0) {
    throw new Error(`No events found for run ${runId}`)
  }

  const sessionIdFromEvents = events[0]?.session_id ?? ""
  if (
    options.validateSessionId &&
    sessionId &&
    sessionIdFromEvents.length > 0 &&
    sessionId !== sessionIdFromEvents
  ) {
    throw new Error(
      `Session mismatch for run ${runId}: provided ${sessionId}, event stream has ${sessionIdFromEvents}`,
    )
  }

  const toolsExecuted = projectToolExecutions(events)
  const projectedReportInput = projectReportInput(events, runId, projectDir)
  const findings = finalizeProjectedFindings(projectFindings(events), toolsExecuted, {
    forgeAvailable: isForgeAvailable(projectedReportInput.unavailableTools),
  })
  const contentHash = stableHash(JSON.stringify(findings))
  const generatedAt = events.at(-1)?.timestamp ?? 0

  const artifact: FindingsArtifact = {
    run_id: runId,
    session_id: sessionId ?? sessionIdFromEvents,
    schema_version: SCHEMA_VERSION,
    seq_first: events[0]?.seq ?? 0,
    seq_last: events.at(-1)?.seq ?? 0,
    event_count: events.length,
    content_hash: contentHash,
    generated_at: generatedAt,
    findings,
    toolsExecuted,
  }

  const findingsFile = createAuditArtifactResolver(runId, projectDir).paths().findingsFile
  await mkdir(dirname(findingsFile), { recursive: true })
  await writeFile(findingsFile, JSON.stringify(artifact, null, 2))

  return artifact
}

export async function materializeFindingsForRun(
  runId: string,
  projectDir: string,
  sessionId: string | undefined,
  trigger: MaterializeFindingsTrigger,
  options: MaterializeFindingsForRunOptions = {},
): Promise<void> {
  if (!runId || runId.length === 0) return

  const { failFast = false, warn } = options
  try {
    await materializeFindings(runId, projectDir, sessionId, {
      validateSessionId: false,
      requireEvents: true,
    })
  } catch (error) {
    const message = `Failed to materialize findings artifact on ${trigger} for run ${runId}: ${error instanceof Error ? error.message : String(error)}`
    if (failFast) {
      throw new Error(message)
    }
    warn?.(message)
  }
}

export async function materializeReportInput(
  runId: string,
  projectDir: string,
  _sessionId?: string,
): Promise<ReportInput> {
  const events = await readEvents(runId, projectDir)
  if (events.length === 0) {
    throw new Error(`No events found for run ${runId}`)
  }

  const reportInput = projectReportInput(events, runId, projectDir)
  reportInput.findings = finalizeProjectedFindings(
    reportInput.findings,
    reportInput.toolsExecuted,
    {
      forgeAvailable: isForgeAvailable(reportInput.unavailableTools),
    },
  )

  if (reportInput.scope.length === 0 && reportInput.findings.length > 0) {
    reportInput.scope = [...new Set(reportInput.findings.map((f) => f.file).filter(Boolean))]
  }

  // Cross-run finding import removed: importing findings from sibling runs
  // risks contaminating fresh audits with stale data and breaks per-run provenance.
  // If the primary run has zero findings, the report reflects that accurately.

  const reportInputFile = createAuditArtifactResolver(runId, projectDir).paths().reportInputFile
  await mkdir(dirname(reportInputFile), { recursive: true })
  await writeFile(reportInputFile, JSON.stringify(reportInput, null, 2))

  return reportInput
}

export interface EnsureRunArtifactsOptions {
  findings?: boolean
  reportInput?: boolean
  warn?: (message: string) => void
}

// Refreshes a run's findings.json / report-input.json from the live event stream
// so Scribe can read/persist mid-audit (no teardown wait) and parity never sees a
// stale projection. Best-effort: failures are non-fatal and callers fall back to
// existing on-disk artifacts.
export async function ensureRunArtifactsMaterialized(
  runId: string,
  projectDir: string,
  sessionId: string | undefined,
  options: EnsureRunArtifactsOptions = {},
): Promise<void> {
  if (!runId || runId.length === 0) return

  const { findings = true, reportInput = true, warn } = options

  if (findings) {
    await materializeFindingsForRun(runId, projectDir, sessionId, "on-demand", { warn })
  }

  if (reportInput) {
    try {
      await materializeReportInput(runId, projectDir, sessionId)
    } catch (error) {
      warn?.(
        `Failed to materialize report-input on demand for run ${runId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
