import { stableHash } from "../../state/projectors"
import type { CanonicalFinding } from "../../state/schemas"
import type { Finding, FindingSeverity } from "../../state/types"

const SEVERITIES: readonly FindingSeverity[] = [
  "Critical",
  "High",
  "Medium",
  "Low",
  "Informational",
] as const

export interface SeverityDistribution {
  Critical: number
  High: number
  Medium: number
  Low: number
  Informational: number
}

export interface ParityMetrics {
  legacyFindingCount: number
  canonicalFindingCount: number
  findingCountDiff: number
  legacySeverityDistribution: SeverityDistribution
  canonicalSeverityDistribution: SeverityDistribution
  severityDiffs: Partial<Record<FindingSeverity, number>>
  legacyContentHash: string
  canonicalContentHash: string
  hashMatch: boolean
  onlyInLegacy: string[]
  onlyInCanonical: string[]
  timestamp: number
}

function computeSeverityDistribution(
  findings: Array<{ severity: FindingSeverity }>,
): SeverityDistribution {
  const dist: SeverityDistribution = {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
    Informational: 0,
  }
  for (const f of findings) {
    if (f.severity in dist) {
      dist[f.severity]++
    }
  }
  return dist
}

function findingIds(findings: Array<{ id: string }>): Set<string> {
  return new Set(findings.map((f) => f.id))
}

export function computeParityMetrics(
  legacyFindings: Finding[],
  canonicalFindings: CanonicalFinding[],
): ParityMetrics {
  const legacySeverity = computeSeverityDistribution(legacyFindings)
  const canonicalSeverity = computeSeverityDistribution(canonicalFindings)

  const severityDiffs: Partial<Record<FindingSeverity, number>> = {}
  for (const sev of SEVERITIES) {
    const diff = canonicalSeverity[sev] - legacySeverity[sev]
    if (diff !== 0) {
      severityDiffs[sev] = diff
    }
  }

  const legacyIds = findingIds(legacyFindings)
  const canonicalIds = findingIds(canonicalFindings)

  const onlyInLegacy = [...legacyIds].filter((id) => !canonicalIds.has(id))
  const onlyInCanonical = [...canonicalIds].filter((id) => !legacyIds.has(id))

  const legacyContentHash = stableHash(
    legacyFindings.map((f) => ({ id: f.id, check: f.check, severity: f.severity, file: f.file })),
  )
  const canonicalContentHash = stableHash(
    canonicalFindings.map((f) => ({
      id: f.id,
      check: f.check,
      severity: f.severity,
      file: f.file,
    })),
  )

  return {
    legacyFindingCount: legacyFindings.length,
    canonicalFindingCount: canonicalFindings.length,
    findingCountDiff: canonicalFindings.length - legacyFindings.length,
    legacySeverityDistribution: legacySeverity,
    canonicalSeverityDistribution: canonicalSeverity,
    severityDiffs,
    legacyContentHash,
    canonicalContentHash,
    hashMatch: legacyContentHash === canonicalContentHash,
    onlyInLegacy,
    onlyInCanonical,
    timestamp: Date.now(),
  }
}

export function formatParityReport(metrics: ParityMetrics): string {
  const lines: string[] = [
    "=== Migration Parity Report ===",
    `Finding count: legacy=${metrics.legacyFindingCount} canonical=${metrics.canonicalFindingCount} diff=${metrics.findingCountDiff}`,
    `Content hash match: ${metrics.hashMatch}`,
  ]

  const sevDiffs = Object.entries(metrics.severityDiffs)
  if (sevDiffs.length > 0) {
    lines.push(
      `Severity diffs: ${sevDiffs.map(([k, v]) => `${k}=${v > 0 ? "+" : ""}${v}`).join(", ")}`,
    )
  }

  if (metrics.onlyInLegacy.length > 0) {
    lines.push(
      `Only in legacy (${metrics.onlyInLegacy.length}): ${metrics.onlyInLegacy.join(", ")}`,
    )
  }
  if (metrics.onlyInCanonical.length > 0) {
    lines.push(
      `Only in canonical (${metrics.onlyInCanonical.length}): ${metrics.onlyInCanonical.join(", ")}`,
    )
  }

  return lines.join("\n")
}
