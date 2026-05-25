import type { CanonicalFinding } from "../state/schemas"
import type { Finding } from "../state/types"
import { DROPPED_OBSERVATION_REASONS, type DroppedObservation } from "./dropped-observations"

export type LineageCountMismatch = {
  check: string
  observation_count?: number
  observation_ids_length: number
}

export type FindingLineageResult = {
  valid: boolean
  raw_count: number
  mapped_count: number
  dropped_count: number
  duplicate_observation_ids: string[]
  phantom_observation_ids: string[]
  missing_observation_ids: string[]
  duplicate_dropped_observation_ids: string[]
  phantom_dropped_observation_ids: string[]
  overlapping_mapped_dropped_observation_ids: string[]
  invalid_dropped_observations: Array<{ observation_id: string; reason: string }>
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
  droppedObservations: DroppedObservation[] = [],
): FindingLineageResult {
  const rawIds = new Set(rawObservationIds(rawFindings))
  const mappedIds: string[] = []
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  const droppedIds: string[] = []
  const seenDropped = new Set<string>()
  const duplicateDropped = new Set<string>()
  const invalidDropped: Array<{ observation_id: string; reason: string }> = []
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

  const validDropReasons = new Set<string>(DROPPED_OBSERVATION_REASONS)
  for (const dropped of droppedObservations) {
    const id = dropped.observation_id
    const reason = dropped.reason
    if (typeof id !== "string" || id.length === 0 || !validDropReasons.has(reason)) {
      invalidDropped.push({ observation_id: id, reason })
    }
    if (typeof id !== "string" || id.length === 0) continue
    droppedIds.push(id)
    if (seenDropped.has(id)) {
      duplicateDropped.add(id)
    }
    seenDropped.add(id)
  }

  const mappedSet = new Set(mappedIds)
  const droppedSet = new Set(droppedIds)
  const phantom = mappedIds.filter((id) => !rawIds.has(id))
  const phantomDropped = droppedIds.filter((id) => !rawIds.has(id))
  const overlappingMappedDropped = droppedIds.filter((id) => mappedSet.has(id))
  const missing = Array.from(rawIds).filter((id) => !mappedSet.has(id) && !droppedSet.has(id))
  const duplicateIds = sorted(duplicates)
  const phantomIds = sorted(phantom)
  const duplicateDroppedIds = sorted(duplicateDropped)
  const phantomDroppedIds = sorted(phantomDropped)
  const overlappingMappedDroppedIds = sorted(overlappingMappedDropped)
  const missingIds = sorted(missing)

  countMismatches.sort((a, b) => a.check.localeCompare(b.check))

  return {
    valid:
      duplicateIds.length === 0 &&
      phantomIds.length === 0 &&
      duplicateDroppedIds.length === 0 &&
      phantomDroppedIds.length === 0 &&
      overlappingMappedDroppedIds.length === 0 &&
      invalidDropped.length === 0 &&
      missingIds.length === 0 &&
      countMismatches.length === 0 &&
      mappedIds.length + droppedIds.length === rawIds.size,
    raw_count: rawIds.size,
    mapped_count: mappedIds.length,
    dropped_count: droppedIds.length,
    duplicate_observation_ids: duplicateIds,
    phantom_observation_ids: phantomIds,
    missing_observation_ids: missingIds,
    duplicate_dropped_observation_ids: duplicateDroppedIds,
    phantom_dropped_observation_ids: phantomDroppedIds,
    overlapping_mapped_dropped_observation_ids: overlappingMappedDroppedIds,
    invalid_dropped_observations: invalidDropped,
    count_mismatches: countMismatches,
  }
}
