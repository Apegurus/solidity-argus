import type { AuditPhase } from "../state/types"

export const PHASE_ORDER: readonly AuditPhase[] = [
  "reconnaissance",
  "scanning",
  "manual-review",
  "attack-surface",
  "research",
  "testing",
  "reporting",
  "complete",
] as const
