import { reconcileRubricVerdict, SEVERITY_RANK } from "../shared/validation-constants"
import type { CanonicalFinding, CanonicalToolExecution } from "./schemas"

const GATE_DEMOTION_NOTE =
  "[gate] Demoted: value-extraction claim lacks a passing forge net-gain PoC."

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

function primaryRank(obs: CanonicalFinding): number {
  return obs.gate_demoted === true ? RUBRIC_VERDICT_RANK.DEMOTED : rubricRank(obs.rubric_verdict)
}

export function selectPrimaryObservation(observations: CanonicalFinding[]): CanonicalFinding {
  return observations.reduce((best, obs) => {
    const rankDelta = primaryRank(obs) - primaryRank(best)
    if (rankDelta !== 0) return rankDelta < 0 ? obs : best
    const scoreDelta = (obs.confidence_score ?? -1) - (best.confidence_score ?? -1)
    if (scoreDelta !== 0) return scoreDelta > 0 ? obs : best
    if (obs.seq !== best.seq) return obs.seq < best.seq ? obs : best
    return obs.observation_id.localeCompare(best.observation_id) < 0 ? obs : best
  })
}

export function maxConfidenceScore(observations: CanonicalFinding[]): number | undefined {
  let max: number | undefined
  for (const obs of observations) {
    if (typeof obs.confidence_score === "number") {
      max = max === undefined ? obs.confidence_score : Math.max(max, obs.confidence_score)
    }
  }
  return max
}

function passedForgeTests(toolExecutions: CanonicalToolExecution[]): string[] {
  return toolExecutions.flatMap((execution) =>
    execution.tool === "argus_forge_test" && execution.success
      ? (execution.passed_tests ?? [])
      : [],
  )
}

// Value-extraction class markers (theft/drain/profit). Class-level by design, never a
// single exploit's token (maintenance guardrail #5), so the gate auto-derives
// claims_value_extraction and omitting the flag cannot bypass it.
const VALUE_EXTRACTION_TERMS = [
  "drain",
  "steal",
  "stolen",
  "theft",
  "siphon",
  "exfiltrate",
  "attacker profit",
  "attacker gain",
  "attacker net gain",
  "net attacker gain",
  "withdraw more than",
  "unbacked",
  "infinite mint",
  "mint unlimited",
  "loss of funds",
  "loss of user funds",
]

// Rationale: negation cues keep refutation narratives from being classified as
// extraction claims while preserving class-level theft/drain/profit matching.
const VALUE_EXTRACTION_NEGATION_PATTERN =
  /\b(no|not|never|without|zero|cannot|can't|does not|doesn't|impossible|false positive|non-extraction)\b|\brather than theft\b/i

const VALUE_EXTRACTION_TERM_PATTERNS = VALUE_EXTRACTION_TERMS.map(
  (term) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`, "i"),
)

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function splitClaimSentences(value: string): string[] {
  return value
    .split(/[.!?\n;]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
}

// Explicit flag wins both ways (true forces, false is an auditable opt-out); only an
// absent flag falls back to class detection.
function claimsValueExtraction(finding: CanonicalFinding): boolean {
  if (typeof finding.claims_value_extraction === "boolean") {
    return finding.claims_value_extraction
  }
  const haystack = `${finding.check}. ${finding.description}`
  return splitClaimSentences(haystack).some((sentence) => {
    if (VALUE_EXTRACTION_NEGATION_PATTERN.test(sentence)) return false
    return VALUE_EXTRACTION_TERM_PATTERNS.some((pattern) => pattern.test(sentence))
  })
}

function requiresConservationGate(finding: CanonicalFinding): boolean {
  return (
    (finding.severity === "Critical" || finding.severity === "High") &&
    finding.rubric_verdict === "CONFIRMED" &&
    claimsValueExtraction(finding)
  )
}

function proofRefMatchesPassedForgeTest(finding: CanonicalFinding, passedTests: string[]): boolean {
  if (typeof finding.net_gain_proof_ref !== "string") return false
  const proofRef = finding.net_gain_proof_ref.trim()
  if (proofRef.length === 0) return false

  const proofTokens = proofRef
    .split(/[\s,`'"()]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
  const proofTestNames = proofTokens
    .flatMap((token) => token.split(/::|:/))
    .map((token) => token.trim())
    .filter((token) => /^test\w*/.test(token))

  return passedTests.some((passedTest) => {
    if (passedTest === proofRef || proofTokens.includes(passedTest)) return true
    const passedTestName = passedTest.split(/::|:/).at(-1)
    return passedTestName ? proofTestNames.includes(passedTestName) : false
  })
}

function prependGateNote(description: string): string {
  return description.startsWith(GATE_DEMOTION_NOTE)
    ? description
    : `${GATE_DEMOTION_NOTE} ${description}`
}

export function applyConservationGate(
  findings: CanonicalFinding[],
  toolExecutions: CanonicalToolExecution[],
  options: { forgeAvailable: boolean },
): CanonicalFinding[] {
  const passedTests = passedForgeTests(toolExecutions)
  return findings.map((finding) => {
    if (!requiresConservationGate(finding)) return finding
    if (!options.forgeAvailable) {
      return { ...finding, unproven_forge_unavailable: true }
    }
    if (proofRefMatchesPassedForgeTest(finding, passedTests)) return finding
    return {
      ...finding,
      rubric_verdict: "DEMOTED",
      gate_demoted: true,
      description: prependGateNote(finding.description),
    }
  })
}

export function finalizeProjectedFindings(
  findings: CanonicalFinding[],
  toolExecutions: CanonicalToolExecution[],
  options: { forgeAvailable: boolean },
): CanonicalFinding[] {
  return dedupeFindingsForFinalOutput(applyConservationGate(findings, toolExecutions, options))
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
    const gateDemoted = sortedObservations.some((obs) => obs.gate_demoted === true)
    if (gateDemoted) {
      mergedFinding.gate_demoted = true
      mergedFinding.rubric_verdict = "DEMOTED"
    }
    if (sortedObservations.some((obs) => obs.unproven_forge_unavailable === true)) {
      mergedFinding.unproven_forge_unavailable = true
    }

    // base is the strongest-verdict observation, so its rubric_verdict already wins;
    // confidence_score is taken as the max across the group so the strongest evidence
    // seen for the issue survives even if it sat on a non-primary observation.
    const mergedConfidence = maxConfidenceScore(sortedObservations)
    if (mergedConfidence !== undefined) {
      mergedFinding.confidence_score = mergedConfidence
    }
    mergedFinding.rubric_verdict = reconcileRubricVerdict(
      mergedFinding.rubric_verdict,
      mergedFinding.confidence_score,
      { gateDemoted },
    )

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
