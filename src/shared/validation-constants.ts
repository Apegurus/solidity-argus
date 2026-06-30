import type { ArgusAgentName, Finding, FindingSeverity } from "../state/types"
import { ARGUS_FAMILY } from "./agent-names"

export function countBySeverity(findings: Finding[]): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
    Informational: 0,
  }
  for (const finding of findings) {
    counts[finding.severity]++
  }
  return counts
}

export const VALID_SEVERITIES: ReadonlySet<FindingSeverity> = new Set([
  "Critical",
  "High",
  "Medium",
  "Low",
  "Informational",
])

export const VALID_CONFIDENCES: ReadonlySet<Finding["confidence"]> = new Set([
  "High",
  "Medium",
  "Low",
])

export const VALID_SOURCES: ReadonlySet<Finding["source"]> = new Set([
  "slither",
  "manual",
  "pattern",
  "scvd",
  "solodit",
  "fuzz",
])

export const VALID_AGENTS: ReadonlySet<ArgusAgentName> = new Set([
  ...ARGUS_FAMILY,
  "unknown",
] as ArgusAgentName[])

export const VALID_RUBRIC_VERDICTS: ReadonlySet<NonNullable<Finding["rubric_verdict"]>> = new Set([
  "CONFIRMED",
  "DEMOTED",
  "REJECTED_DEMOTED",
])

export function isValidConfidenceScore(
  value: unknown,
): value is NonNullable<Finding["confidence_score"]> {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100
}

export function isValidRubricVerdict(
  value: unknown,
): value is NonNullable<Finding["rubric_verdict"]> {
  return (
    typeof value === "string" &&
    VALID_RUBRIC_VERDICTS.has(value as NonNullable<Finding["rubric_verdict"]>)
  )
}

export const RUBRIC_CONFIRMED_MIN_SCORE = 80

// CONFIRMED requires confidence_score >= RUBRIC_CONFIRMED_MIN_SCORE; a CONFIRMED finding
// carrying an explicit sub-threshold score is auto-demoted so verdict-first tiering cannot
// route a low-confidence finding into the Findings tier.
export function reconcileRubricVerdict(
  verdict: Finding["rubric_verdict"],
  score: Finding["confidence_score"],
  options: { gateDemoted?: boolean } = {},
): Finding["rubric_verdict"] {
  if (options.gateDemoted && verdict === "CONFIRMED") {
    return "DEMOTED"
  }
  if (verdict === "CONFIRMED" && typeof score === "number" && score < RUBRIC_CONFIRMED_MIN_SCORE) {
    return "DEMOTED"
  }
  return verdict
}

export const SEVERITY_RANK: Record<FindingSeverity, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
  Informational: 4,
}
