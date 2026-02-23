import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { createAuditArtifactResolver } from "../../shared/audit-artifact-resolver"
import { projectFindings, projectToolExecutions, stableHash } from "../../state/projectors"
import type { CanonicalFinding, CanonicalToolExecution } from "../../state/schemas"
import { SCHEMA_VERSION } from "../../state/schemas"
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

export async function materializeFindings(
  runId: string,
  projectDir: string,
  sessionId?: string,
): Promise<FindingsArtifact> {
  const events = await readEvents(runId, projectDir)
  const findings = projectFindings(events)
  const toolsExecuted = projectToolExecutions(events)
  const contentHash = stableHash(JSON.stringify(findings))
  const generatedAt = events.at(-1)?.timestamp ?? 0

  const artifact: FindingsArtifact = {
    run_id: runId,
    session_id: sessionId ?? events[0]?.session_id ?? "",
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
