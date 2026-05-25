export const DROPPED_OBSERVATION_REASONS = [
  "out-of-scope",
  "false-positive",
  "merged-into",
  "non-actionable-noise",
] as const

export type DroppedObservationReason = (typeof DROPPED_OBSERVATION_REASONS)[number]

export type DroppedObservation = {
  observation_id: string
  reason: DroppedObservationReason
  note?: string
}
