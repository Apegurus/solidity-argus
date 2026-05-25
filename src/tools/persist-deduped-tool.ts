import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { type ToolContext, tool } from "@opencode-ai/plugin"
import { createAuditArtifactResolver } from "../shared/audit-artifact-resolver"
import {
  DROPPED_OBSERVATION_REASONS,
  type DroppedObservation,
} from "../shared/dropped-observations"
import { validateFindingLineage } from "../shared/lineage-validator"
import { createLogger } from "../shared/logger"
import { resolveProjectDir } from "../shared/project-utils"
import { isNonEmptyString } from "../shared/type-guards"
import { stableHash } from "../state/projectors"
import type { CanonicalFinding } from "../state/schemas"
import { SCHEMA_VERSION } from "../state/schemas"

type PersistDedupedArgs = {
  run_id: string
  deduped_findings: string
}

export interface DedupedFindingsArtifact {
  run_id: string
  schema_version: string
  deduped_at: number
  deduped_by: string
  findings_count: number
  findings: CanonicalFinding[]
  dropped_observations_count: number
  dropped_observations: DroppedObservation[]
  content_hash: string
  revision: number
}

async function loadRawFindings(
  runId: string,
  projectDir: string,
): Promise<CanonicalFinding[] | null> {
  const findingsFile = createAuditArtifactResolver(runId, projectDir).paths().findingsFile
  try {
    const parsed = JSON.parse(await readFile(findingsFile, "utf8"))
    if (!parsed || !Array.isArray(parsed.findings)) return null
    return parsed.findings
  } catch {
    return null
  }
}

function missingRawFindings(runId: string): string {
  return JSON.stringify({
    success: false,
    error: "MissingRawFindingsError",
    message: `Cannot verify deduped lineage because .argus/runs/${runId}/findings.json is missing or invalid`,
  })
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

function semanticHash(
  findings: CanonicalFinding[],
  droppedObservations: DroppedObservation[],
): string {
  return stableHash(JSON.stringify({ findings, dropped_observations: droppedObservations }))
}

async function loadExistingArtifact(path: string): Promise<DedupedFindingsArtifact | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"))
    if (!parsed || typeof parsed !== "object") return null
    return parsed as DedupedFindingsArtifact
  } catch {
    return null
  }
}

export async function executePersistDeduped(
  args: PersistDedupedArgs,
  context: ToolContext,
): Promise<string> {
  const logger = createLogger()

  if (!isNonEmptyString(args.run_id)) {
    return JSON.stringify({ success: false, error: "run_id is required" })
  }
  if (!isNonEmptyString(args.deduped_findings)) {
    return JSON.stringify({ success: false, error: "deduped_findings is required" })
  }

  let findings: CanonicalFinding[]
  let droppedObservations: DroppedObservation[] = []
  try {
    const parsed = JSON.parse(args.deduped_findings)
    findings = Array.isArray(parsed) ? parsed : parsed.findings
    if (!Array.isArray(findings)) {
      return JSON.stringify({
        success: false,
        error: "deduped_findings must be a JSON array or an object with a findings array",
      })
    }
    if (!Array.isArray(parsed)) {
      const parsedDropped = parseDroppedObservations(parsed.dropped_observations)
      if (!parsedDropped) {
        return JSON.stringify({
          success: false,
          error:
            "dropped_observations must be an array of { observation_id, reason, note? } entries with a valid reason",
        })
      }
      droppedObservations = parsedDropped
    }
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  const projectDir = resolveProjectDir(context)
  const resolver = createAuditArtifactResolver(args.run_id, projectDir)
  const dedupedPath = resolver.paths().dedupedFindingsFile
  const rawFindings = await loadRawFindings(args.run_id, projectDir)

  if (!rawFindings) {
    return missingRawFindings(args.run_id)
  }

  const lineage = validateFindingLineage(rawFindings, findings, droppedObservations)
  if (!lineage.valid) {
    return JSON.stringify({
      success: false,
      error: "LineageError",
      lineage: {
        raw_count: lineage.raw_count,
        mapped_count: lineage.mapped_count,
        duplicate_observation_ids: lineage.duplicate_observation_ids,
        phantom_observation_ids: lineage.phantom_observation_ids,
        missing_observation_ids: lineage.missing_observation_ids,
        duplicate_dropped_observation_ids: lineage.duplicate_dropped_observation_ids,
        phantom_dropped_observation_ids: lineage.phantom_dropped_observation_ids,
        invalid_dropped_observations: lineage.invalid_dropped_observations,
        count_mismatches: lineage.count_mismatches,
      },
    })
  }

  const contentHash = semanticHash(findings, droppedObservations)
  const existingArtifact = await loadExistingArtifact(dedupedPath)
  if (existingArtifact?.content_hash === contentHash) {
    return JSON.stringify({
      success: true,
      idempotent: true,
      path: dedupedPath,
      findings_count: findings.length,
      dropped_observations_count: droppedObservations.length,
      schema_version: SCHEMA_VERSION,
      content_hash: contentHash,
      revision: existingArtifact.revision ?? 1,
    })
  }

  const artifact: DedupedFindingsArtifact = {
    run_id: args.run_id,
    schema_version: SCHEMA_VERSION,
    deduped_at: Date.now(),
    deduped_by: context.agent ?? "scribe",
    findings_count: findings.length,
    findings,
    dropped_observations_count: droppedObservations.length,
    dropped_observations: droppedObservations,
    content_hash: contentHash,
    revision: (existingArtifact?.revision ?? 0) + 1,
  }

  await mkdir(dirname(dedupedPath), { recursive: true })
  await writeFile(dedupedPath, JSON.stringify(artifact, null, 2))
  logger.debug(`Persisted ${findings.length} deduped findings to ${dedupedPath}`)

  return JSON.stringify({
    success: true,
    path: dedupedPath,
    findings_count: findings.length,
    dropped_observations_count: droppedObservations.length,
    schema_version: SCHEMA_VERSION,
    content_hash: contentHash,
    revision: artifact.revision,
  })
}

export const persistDedupedTool = tool({
  description:
    "Persist deduplicated and enriched findings to disk as the source-of-truth JSON artifact. Call this BEFORE argus_generate_report so the report tool can read from disk instead of requiring inline data.",
  args: {
    run_id: tool.schema.string().describe("The canonical run ID from <argus-context>."),
    deduped_findings: tool.schema
      .string()
      .describe(
        "Serialized JSON array of deduplicated and enriched findings. Each finding should have: check, severity, confidence, description, file, lines, source, impact, recommendation, proofOfConcept, and observation_ids lineage proving which raw findings were merged.",
      ),
  },
  async execute(args, context) {
    return executePersistDeduped(args, context)
  },
})
