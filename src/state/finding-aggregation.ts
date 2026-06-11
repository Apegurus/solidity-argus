import { SEVERITY_RANK } from "../shared/validation-constants"
import type { CanonicalFinding } from "./schemas"

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right))
}

function compareObservations(left: CanonicalFinding, right: CanonicalFinding): number {
  if (left.seq !== right.seq) return left.seq - right.seq
  return left.observation_id.localeCompare(right.observation_id)
}

const RUBRIC_VERDICT_RANK: Record<NonNullable<CanonicalFinding["rubric_verdict"]>, number> = {
  CONFIRMED: 0,
  DEMOTED: 1,
  REJECTED_DEMOTED: 2,
}

function rubricRank(verdict: CanonicalFinding["rubric_verdict"]): number {
  return verdict ? RUBRIC_VERDICT_RANK[verdict] : 3
}

// The adjudicated observation (its rubric verdict, confidence, and 4-gate trace
// description) usually arrives AFTER the raw pattern/static observation it refutes,
// so picking the earliest-seq observation as the merged representative silently
// dropped the rubric data. Selecting the strongest-verdict observation instead keeps
// the rendered verdict, confidence, and trace aligned with the adjudication. Order:
// strongest verdict, then highest confidence_score, then earliest seq, then id.
function selectPrimaryObservation(observations: CanonicalFinding[]): CanonicalFinding {
  return observations.reduce((best, obs) => {
    const rankDelta = rubricRank(obs.rubric_verdict) - rubricRank(best.rubric_verdict)
    if (rankDelta !== 0) return rankDelta < 0 ? obs : best
    const scoreDelta = (obs.confidence_score ?? -1) - (best.confidence_score ?? -1)
    if (scoreDelta !== 0) return scoreDelta > 0 ? obs : best
    if (obs.seq !== best.seq) return obs.seq < best.seq ? obs : best
    return obs.observation_id.localeCompare(best.observation_id) < 0 ? obs : best
  })
}

function maxConfidenceScore(observations: CanonicalFinding[]): number | undefined {
  let max: number | undefined
  for (const obs of observations) {
    if (typeof obs.confidence_score === "number") {
      max = max === undefined ? obs.confidence_score : Math.max(max, obs.confidence_score)
    }
  }
  return max
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
    if (sortedObservations.length === 0) continue
    const base = selectPrimaryObservation(sortedObservations)

    const highestSeverityObservation = sortedObservations.reduce((best, obs) =>
      SEVERITY_RANK[obs.severity] < SEVERITY_RANK[best.severity] ? obs : best,
    )

    const reportedByAgents = uniqueSorted(
      sortedObservations.map((finding) => finding.reported_by_agent),
    )
    const sources = uniqueSorted(sortedObservations.map((finding) => finding.source))
    const observationIds = sortedObservations
      .map((finding) => finding.observation_id)
      .sort((left, right) => left.localeCompare(right))

    const mergedFinding: CanonicalFinding = {
      ...base,
      severity: highestSeverityObservation.severity,
      id: issueFingerprint,
      sources,
      reported_by_agents: reportedByAgents,
      observation_ids: observationIds,
      observation_count: sortedObservations.length,
    }

    // base is the strongest-verdict observation, so its rubric_verdict already wins;
    // confidence_score is taken as the max across the group so the strongest evidence
    // seen for the issue survives even if it sat on a non-primary observation.
    const mergedConfidence = maxConfidenceScore(sortedObservations)
    if (mergedConfidence !== undefined) {
      mergedFinding.confidence_score = mergedConfidence
    }

    merged.push(mergedFinding)
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
