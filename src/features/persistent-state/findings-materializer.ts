import { existsSync, readdirSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { createAuditArtifactResolver } from "../../shared/audit-artifact-resolver"
import { defaultRootResolver } from "../../shared/path-root-resolver"
import { dedupeFindingsForFinalOutput } from "../../state/finding-aggregation"
import {
  projectFindings,
  projectReportInput,
  projectToolExecutions,
  stableHash,
} from "../../state/projectors"
import type {
  AuditEvent,
  CanonicalFinding,
  CanonicalToolExecution,
  ReportInput,
} from "../../state/schemas"
import { SCHEMA_VERSION, validateCanonicalFinding } from "../../state/schemas"
import { readEvents } from "./event-sink"

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

  const findings = dedupeFindingsForFinalOutput(projectFindings(events))
  const toolsExecuted = projectToolExecutions(events)
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

function listSiblingRunIds(runId: string, projectDir: string): string[] {
  const runsDir = join(defaultRootResolver.writeRoot(projectDir), "runs")
  if (!existsSync(runsDir)) return []
  try {
    return readdirSync(runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== runId)
      .map((d) => d.name)
  } catch {
    return []
  }
}

function collectSessionIds(events: AuditEvent[]): Set<string> {
  const ids = new Set<string>()
  for (const event of events) {
    if (event.session_id) ids.add(event.session_id)
  }
  return ids
}

function extractFindingsFromEvents(events: AuditEvent[]): CanonicalFinding[] {
  const findings: CanonicalFinding[] = []
  for (const event of events) {
    if (event.type !== "finding.added") continue
    const validation = validateCanonicalFinding(event.payload)
    if (validation.success) {
      findings.push({
        ...validation.data,
        seq: event.seq,
        run_id: event.run_id,
        schema_version: event.schema_version,
      })
    }
  }
  return findings
}

async function collectCrossRunFindings(
  primaryRunId: string,
  primarySessionIds: Set<string>,
  projectDir: string,
): Promise<CanonicalFinding[]> {
  const siblingIds = listSiblingRunIds(primaryRunId, projectDir)
  const crossFindings: CanonicalFinding[] = []

  for (const siblingId of siblingIds) {
    let siblingEvents: AuditEvent[]
    try {
      siblingEvents = await readEvents(siblingId, projectDir)
    } catch {
      continue
    }
    if (siblingEvents.length === 0) continue

    const siblingSessionIds = collectSessionIds(siblingEvents)
    let hasOverlap = false
    for (const sid of siblingSessionIds) {
      if (primarySessionIds.has(sid)) {
        hasOverlap = true
        break
      }
    }
    if (!hasOverlap) continue

    crossFindings.push(...extractFindingsFromEvents(siblingEvents))
  }

  return crossFindings
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

  if (reportInput.findings.length === 0) {
    const primarySessionIds = collectSessionIds(events)
    const crossFindings = await collectCrossRunFindings(runId, primarySessionIds, projectDir)
    if (crossFindings.length > 0) {
      reportInput.findings = dedupeFindingsForFinalOutput(crossFindings)
    }
  }

  const reportInputFile = createAuditArtifactResolver(runId, projectDir).paths().reportInputFile
  await mkdir(dirname(reportInputFile), { recursive: true })
  await writeFile(reportInputFile, JSON.stringify(reportInput, null, 2))

  return reportInput
}
