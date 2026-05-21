import type { CanonicalFinding } from "../state/schemas"
import type { Finding } from "../state/types"

export type LineageCountMismatch = {
  check: string
  observation_count?: number
  observation_ids_length: number
}

export type FindingLineageResult = {
  valid: boolean
  raw_count: number
  mapped_count: number
  duplicate_observation_ids: string[]
  phantom_observation_ids: string[]
  missing_observation_ids: string[]
  count_mismatches: LineageCountMismatch[]
}

type FindingLike = Pick<Finding, "check"> & {
  id?: string
  observation_id?: string
  observation_ids?: unknown
  observation_count?: unknown
}

function sorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}

function observationIds(value: FindingLike): string[] {
  if (!Array.isArray(value.observation_ids)) return []
  return value.observation_ids.filter((id): id is string => typeof id === "string" && id.length > 0)
}

function rawObservationIds(rawFindings: CanonicalFinding[]): string[] {
  return rawFindings
    .map((finding) => finding.observation_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
}

export function validateFindingLineage(
  rawFindings: CanonicalFinding[],
  dedupedFindings: FindingLike[],
): FindingLineageResult {
  const rawIds = new Set(rawObservationIds(rawFindings))
  const mappedIds: string[] = []
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  const countMismatches: LineageCountMismatch[] = []

  for (const finding of dedupedFindings) {
    const ids = observationIds(finding)
    const suppliedCount = finding.observation_count

    if (ids.length === 0 || (suppliedCount != null && suppliedCount !== ids.length)) {
      countMismatches.push({
        check: finding.check || finding.id || "(unknown finding)",
        observation_count: typeof suppliedCount === "number" ? suppliedCount : undefined,
        observation_ids_length: ids.length,
      })
    }

    for (const id of ids) {
      mappedIds.push(id)
      if (seen.has(id)) {
        duplicates.add(id)
      }
      seen.add(id)
    }
  }

  const mappedSet = new Set(mappedIds)
  const phantom = mappedIds.filter((id) => !rawIds.has(id))
  const missing = Array.from(rawIds).filter((id) => !mappedSet.has(id))
  const duplicateIds = sorted(duplicates)
  const phantomIds = sorted(phantom)
  const missingIds = sorted(missing)

  countMismatches.sort((a, b) => a.check.localeCompare(b.check))

  return {
    valid:
      duplicateIds.length === 0 &&
      phantomIds.length === 0 &&
      missingIds.length === 0 &&
      countMismatches.length === 0 &&
      mappedIds.length === rawIds.size,
    raw_count: rawIds.size,
    mapped_count: mappedIds.length,
    duplicate_observation_ids: duplicateIds,
    phantom_observation_ids: phantomIds,
    missing_observation_ids: missingIds,
    count_mismatches: countMismatches,
  }
}
