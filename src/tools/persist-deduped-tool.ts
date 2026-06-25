import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { type ToolContext, tool } from "@opencode-ai/plugin"
import { ensureRunArtifactsMaterialized } from "../features/persistent-state/findings-materializer"
import { createAuditArtifactResolver } from "../shared/audit-artifact-resolver"
import {
  DROPPED_OBSERVATION_REASONS,
  type DroppedObservation,
} from "../shared/dropped-observations"
import { validateFindingLineage } from "../shared/lineage-validator"
import { createLogger } from "../shared/logger"
import { resolveProjectDir } from "../shared/project-utils"
import { isNonEmptyString } from "../shared/type-guards"
import { reconcileRubricVerdict } from "../shared/validation-constants"
import { maxConfidenceScore, selectPrimaryObservation } from "../state/finding-aggregation"
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

// Phantom observation_ids are references in the deduped set that do not exist in the
// run's canonical findings.json. Classifying each id by its minting format points the
// caller at the artifact it likely came from instead of just rejecting opaquely.
function diagnosePhantomObservationIds(
  phantomIds: string[],
  runId: string,
): Array<{ id: string; likely_source: string }> {
  const classify = (id: string): string => {
    if (id.startsWith("ses_")) {
      return "OpenCode session id — a subagent session reference, not a canonical observation_id"
    }
    if (id.startsWith(`${runId}:`)) {
      return "adapter fallback id (runId:seq:hash) — likely a stale seq from this run's journal"
    }
    if (id.includes(":")) {
      return "tool-call-scoped id (toolCallId:index) — may belong to a different session or run"
    }
    return "unrecognized provenance — not minted by this run"
  }
  return phantomIds.map((id) => ({ id, likely_source: classify(id) }))
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
  return stableHash({ findings, dropped_observations: droppedObservations })
}

function rederiveVerdictsFromLineage(
  findings: CanonicalFinding[],
  rawFindings: CanonicalFinding[],
): CanonicalFinding[] {
  const rawByObservationId = new Map(
    rawFindings.map((finding) => [finding.observation_id, finding]),
  )
  return findings.map((finding) => {
    const observations = (finding.observation_ids ?? [])
      .map((id) => rawByObservationId.get(id))
      .filter((observation): observation is CanonicalFinding => observation !== undefined)
    if (observations.length === 0) return finding
    const primary = selectPrimaryObservation(observations)
    const confidenceScore = maxConfidenceScore(observations)
    const gateDemoted = observations.some((observation) => observation.gate_demoted === true)
    const rubricVerdict = reconcileRubricVerdict(primary.rubric_verdict, confidenceScore, {
      gateDemoted,
    })
    return {
      ...finding,
      ...(confidenceScore !== undefined ? { confidence_score: confidenceScore } : {}),
      ...(rubricVerdict ? { rubric_verdict: rubricVerdict } : {}),
      ...(gateDemoted ? { gate_demoted: true } : {}),
    }
  })
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
  await ensureRunArtifactsMaterialized(args.run_id, projectDir, context.sessionID, {
    reportInput: false,
    warn: (msg) => logger.debug(msg),
  })
  const rawFindings = await loadRawFindings(args.run_id, projectDir)

  if (!rawFindings) {
    return missingRawFindings(args.run_id)
  }

  const lineage = validateFindingLineage(rawFindings, findings, droppedObservations)
  if (!lineage.valid) {
    const phantomDiagnostic =
      lineage.phantom_observation_ids.length > 0
        ? diagnosePhantomObservationIds(lineage.phantom_observation_ids, args.run_id)
        : undefined
    return JSON.stringify({
      success: false,
      error: "LineageError",
      ...(phantomDiagnostic
        ? {
            phantom_diagnostic: phantomDiagnostic,
            hint: `Call argus_read_findings(run_id="${args.run_id}") to obtain the canonical observation_ids; deduped findings may only reference ids present in .argus/runs/${args.run_id}/findings.json.`,
          }
        : {}),
      ...(lineage.cross_file_merges.length > 0
        ? {
            cross_file_hint:
              "A deduped finding merged observations from different files. Dedup groups by a single code location — split cross-file observations into separate findings, each with its own observation_ids.",
          }
        : {}),
      lineage: {
        raw_count: lineage.raw_count,
        mapped_count: lineage.mapped_count,
        duplicate_observation_ids: lineage.duplicate_observation_ids,
        phantom_observation_ids: lineage.phantom_observation_ids,
        missing_observation_ids: lineage.missing_observation_ids,
        duplicate_dropped_observation_ids: lineage.duplicate_dropped_observation_ids,
        phantom_dropped_observation_ids: lineage.phantom_dropped_observation_ids,
        overlapping_mapped_dropped_observation_ids:
          lineage.overlapping_mapped_dropped_observation_ids,
        invalid_dropped_observations: lineage.invalid_dropped_observations,
        count_mismatches: lineage.count_mismatches,
        cross_file_merges: lineage.cross_file_merges,
      },
    })
  }

  findings = rederiveVerdictsFromLineage(findings, rawFindings)

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
        'Serialized JSON array of deduplicated and enriched findings, or a serialized JSON object { "findings": [...], "dropped_observations": [...] } when raw observations are intentionally excluded from final findings. Each finding should have: check, severity, confidence, description, file, lines, source, impact, recommendation, proofOfConcept, observation_ids, and observation_count. Each dropped observation should have observation_id, reason (out-of-scope|false-positive|merged-into|non-actionable-noise), and optional note.',
      ),
  },
  async execute(args, context) {
    return executePersistDeduped(args, context)
  },
})
