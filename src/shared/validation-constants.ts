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

export const SEVERITY_RANK: Record<FindingSeverity, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
  Informational: 4,
}
