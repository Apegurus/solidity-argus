import { describe, expect, test } from "bun:test"
import { dedupeFindingsForFinalOutput } from "./finding-aggregation"
import type { CanonicalFinding } from "./schemas"
import { SCHEMA_VERSION } from "./schemas"

function makeObs(overrides: Partial<CanonicalFinding> & { seq: number }): CanonicalFinding {
  return {
    id: `obs-${overrides.seq}`,
    check: "reentrancy-eth",
    severity: "High",
    confidence: "High",
    description: `observation ${overrides.seq}`,
    file: "src/Vault.sol",
    lines: [10, 12],
    source: "pattern",
    run_id: "run-1",
    schema_version: SCHEMA_VERSION,
    observation_id: `o-${overrides.seq}`,
    issue_fingerprint: "issue-A",
    observation_fingerprint: `of-${overrides.seq}`,
    reported_by_agent: "sentinel",
    ...overrides,
  }
}

function dedupeOne(raw: CanonicalFinding[]): CanonicalFinding {
  const [first] = dedupeFindingsForFinalOutput(raw)
  if (!first) throw new Error("expected exactly one merged finding")
  return first
}

describe("dedupeFindingsForFinalOutput rubric propagation", () => {
  test("carries the adjudicated verdict, confidence, and narrative from a later observation", () => {
    const raw = [
      makeObs({ seq: 2, source: "pattern", description: "raw pattern hit" }),
      makeObs({
        seq: 7,
        source: "manual",
        reported_by_agent: "audit-specialist",
        rubric_verdict: "CONFIRMED",
        confidence_score: 85,
        description: "**Rubric Trace** Verdict: CONFIRMED · Confidence: 85",
      }),
    ]

    const merged = dedupeOne(raw)

    expect(merged.rubric_verdict).toBe("CONFIRMED")
    expect(merged.confidence_score).toBe(85)
    expect(merged.description).toContain("Rubric Trace")
    expect(merged.observation_count).toBe(2)
    expect(merged.observation_ids).toEqual(["o-2", "o-7"])
  })

  test("propagates the strongest verdict (CONFIRMED) over a weaker earlier one", () => {
    const raw = [
      makeObs({ seq: 3, rubric_verdict: "REJECTED_DEMOTED", confidence_score: 20 }),
      makeObs({ seq: 9, rubric_verdict: "CONFIRMED", confidence_score: 90 }),
      makeObs({ seq: 5, rubric_verdict: "DEMOTED", confidence_score: 55 }),
    ]

    const merged = dedupeOne(raw)

    expect(merged.rubric_verdict).toBe("CONFIRMED")
    expect(merged.confidence_score).toBe(90)
  })

  test("takes the max confidence_score even when it sits on a non-primary observation", () => {
    const raw = [
      makeObs({ seq: 2, rubric_verdict: "CONFIRMED", confidence_score: 70 }),
      makeObs({ seq: 4, rubric_verdict: "DEMOTED", confidence_score: 95 }),
    ]

    const merged = dedupeOne(raw)

    expect(merged.rubric_verdict).toBe("CONFIRMED")
    expect(merged.confidence_score).toBe(95)
  })

  test("all-demoted group keeps a non-CONFIRMED verdict so it routes to Leads", () => {
    const raw = [
      makeObs({ seq: 2, rubric_verdict: "DEMOTED", confidence_score: 40 }),
      makeObs({ seq: 6, rubric_verdict: "REJECTED_DEMOTED", confidence_score: 15 }),
    ]

    const merged = dedupeOne(raw)

    expect(merged.rubric_verdict).toBe("DEMOTED")
    expect(merged.rubric_verdict).not.toBe("CONFIRMED")
  })

  test("legacy findings without rubric data stay undefined (backward compatible)", () => {
    const raw = [
      makeObs({ seq: 2 }),
      makeObs({ seq: 3, observation_id: "o-3b", observation_fingerprint: "of-3b" }),
    ]

    const merged = dedupeOne(raw)

    expect(merged.rubric_verdict).toBeUndefined()
    expect(merged.confidence_score).toBeUndefined()
    expect(merged.observation_count).toBe(2)
  })
})
