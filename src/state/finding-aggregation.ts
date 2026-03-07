import { SEVERITY_RANK } from "../shared/validation-constants"
import type { CanonicalFinding } from "./schemas"

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right))
}

function compareObservations(left: CanonicalFinding, right: CanonicalFinding): number {
  if (left.seq !== right.seq) return left.seq - right.seq
  return left.observation_id.localeCompare(right.observation_id)
}

function compareFinalFindings(left: CanonicalFinding, right: CanonicalFinding): number {
  const bySeverity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
  if (bySeverity !== 0) return bySeverity

  const byFile = left.file.localeCompare(right.file)
  if (byFile !== 0) return byFile

  const byLine = left.lines[0] - right.lines[0]
  if (byLine !== 0) return byLine

  return left.issue_fingerprint.localeCompare(right.issue_fingerprint)
}

export function dedupeFindingsForFinalOutput(findings: CanonicalFinding[]): CanonicalFinding[] {
  const byIssue = new Map<string, CanonicalFinding[]>()
  for (const finding of findings) {
    const group = byIssue.get(finding.issue_fingerprint)
    if (group) {
      group.push(finding)
    } else {
      byIssue.set(finding.issue_fingerprint, [finding])
    }
  }

  const merged: CanonicalFinding[] = []

  for (const [issueFingerprint, observations] of byIssue.entries()) {
    const sortedObservations = observations.slice().sort(compareObservations)
    const base = sortedObservations[0]
    if (!base) continue

    const reportedByAgents = uniqueSorted(
      sortedObservations.map((finding) => finding.reported_by_agent),
    )
    const sources = uniqueSorted(sortedObservations.map((finding) => finding.source))
    const observationIds = sortedObservations
      .map((finding) => finding.observation_id)
      .sort((left, right) => left.localeCompare(right))

    merged.push({
      ...base,
      id: issueFingerprint,
      sources,
      reported_by_agents: reportedByAgents,
      observation_ids: observationIds,
      observation_count: sortedObservations.length,
    })
  }

  return merged.sort(compareFinalFindings)
}

export function issueFingerprintSet(findings: CanonicalFinding[]): Set<string> {
  const set = new Set<string>()
  for (const finding of findings) {
    set.add(finding.issue_fingerprint)
  }
  return set
}

export function compareIssueFingerprintSets(
  expected: CanonicalFinding[],
  actual: CanonicalFinding[],
): { missing: string[]; extra: string[]; matches: boolean } {
  const expectedSet = issueFingerprintSet(expected)
  const actualSet = issueFingerprintSet(actual)

  const missing = Array.from(expectedSet)
    .filter((fingerprint) => !actualSet.has(fingerprint))
    .sort((left, right) => left.localeCompare(right))

  const extra = Array.from(actualSet)
    .filter((fingerprint) => !expectedSet.has(fingerprint))
    .sort((left, right) => left.localeCompare(right))

  return {
    missing,
    extra,
    matches: missing.length === 0 && extra.length === 0,
  }
}
