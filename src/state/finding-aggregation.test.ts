import { describe, expect, test } from "bun:test"
import { applyConservationGate, dedupeFindingsForFinalOutput } from "./finding-aggregation"
import type { CanonicalFinding, CanonicalToolExecution } from "./schemas"
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

function forgeExecution(overrides: Partial<CanonicalToolExecution> = {}): CanonicalToolExecution {
  return {
    tool: "argus_forge_test",
    startTime: 1,
    success: true,
    findingsCount: 0,
    run_id: "run-1",
    schema_version: SCHEMA_VERSION,
    ...overrides,
  }
}

function forgeExecutionWithPassedTests(tests: string[]): CanonicalToolExecution {
  return {
    ...forgeExecution(),
    passed_tests: tests,
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

  test("auto-demotes a merged CONFIRMED whose final confidence_score is below 80", () => {
    const raw = [
      makeObs({ seq: 2, rubric_verdict: "CONFIRMED", confidence_score: 72 }),
      makeObs({ seq: 4, rubric_verdict: "DEMOTED", confidence_score: 55 }),
    ]

    const merged = dedupeOne(raw)

    expect(merged.rubric_verdict).toBe("DEMOTED")
    expect(merged.confidence_score).toBe(72)
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

  test("keeps gate-demoted verdict as a non-repromotable dedupe floor", () => {
    const raw = [
      makeObs({ seq: 2, rubric_verdict: "DEMOTED", confidence_score: 95, gate_demoted: true }),
      makeObs({ seq: 4, rubric_verdict: "CONFIRMED", confidence_score: 95 }),
    ]

    const merged = dedupeOne(raw)

    expect(merged.rubric_verdict).toBe("DEMOTED")
    expect(merged.gate_demoted).toBe(true)
    expect(merged.confidence_score).toBe(95)
  })
})

describe("applyConservationGate", () => {
  test("demotes confirmed High value-extraction claim without passing forge proof", () => {
    const [gated] = applyConservationGate(
      [
        makeObs({
          seq: 1,
          claims_value_extraction: true,
          rubric_verdict: "CONFIRMED",
          confidence_score: 90,
        }),
      ],
      [],
      { forgeAvailable: true },
    )

    expect(gated?.rubric_verdict).toBe("DEMOTED")
    expect(gated?.gate_demoted).toBe(true)
    expect(gated?.description).toStartWith("[gate] Demoted")
  })

  test("demotes confirmed value-extraction claim with only run-level forge success", () => {
    const [gated] = applyConservationGate(
      [
        makeObs({
          seq: 1,
          claims_value_extraction: true,
          net_gain_proof_ref: "test/Repro.t.sol:testNetGain",
          rubric_verdict: "CONFIRMED",
          confidence_score: 90,
        }),
      ],
      [forgeExecution()],
      { forgeAvailable: true },
    )

    expect(gated?.rubric_verdict).toBe("DEMOTED")
    expect(gated?.gate_demoted).toBe(true)
  })

  test("demotes confirmed value-extraction claim when proof ref does not match a passed forge test", () => {
    const [gated] = applyConservationGate(
      [
        makeObs({
          seq: 1,
          claims_value_extraction: true,
          net_gain_proof_ref: "test/Repro.t.sol:testNetGain",
          rubric_verdict: "CONFIRMED",
          confidence_score: 90,
        }),
      ],
      [forgeExecutionWithPassedTests(["test/Other.t.sol:testUnrelatedInvariant"])],
      { forgeAvailable: true },
    )

    expect(gated?.rubric_verdict).toBe("DEMOTED")
    expect(gated?.gate_demoted).toBe(true)
  })

  test("keeps confirmed value-extraction claim when proof ref matches a passed forge test", () => {
    const [gated] = applyConservationGate(
      [
        makeObs({
          seq: 1,
          claims_value_extraction: true,
          net_gain_proof_ref: "test/Repro.t.sol:testNetGain",
          rubric_verdict: "CONFIRMED",
          confidence_score: 90,
        }),
      ],
      [forgeExecutionWithPassedTests(["test/Repro.t.sol:testNetGain"])],
      { forgeAvailable: true },
    )

    expect(gated?.rubric_verdict).toBe("CONFIRMED")
    expect(gated?.gate_demoted).toBeUndefined()
  })

  test("demotes confirmed value-extraction claims when forge is unavailable", () => {
    const [gated] = applyConservationGate(
      [
        makeObs({
          seq: 1,
          claims_value_extraction: true,
          rubric_verdict: "CONFIRMED",
          confidence_score: 90,
        }),
      ],
      [],
      { forgeAvailable: false },
    )

    expect(gated?.rubric_verdict).toBe("DEMOTED")
    expect(gated?.gate_demoted).toBe(true)
    expect(gated?.unproven_forge_unavailable).toBe(true)
  })

  test("auto-derives value-extraction from a drain-class check and demotes when proof is absent", () => {
    const [gated] = applyConservationGate(
      [
        makeObs({
          seq: 1,
          check: "reentrancy-eth-drain",
          description: "Attacker can drain all vault ETH via reentrancy",
          rubric_verdict: "CONFIRMED",
          confidence_score: 95,
        }),
      ],
      [],
      { forgeAvailable: true },
    )

    expect(gated?.rubric_verdict).toBe("DEMOTED")
    expect(gated?.gate_demoted).toBe(true)
  })

  test("auto-derives value extraction from common inflections", () => {
    const [gated] = applyConservationGate(
      [
        makeObs({
          seq: 1,
          description: "An attacker is draining and siphoned funds from the vault.",
          rubric_verdict: "CONFIRMED",
          confidence_score: 95,
        }),
      ],
      [],
      { forgeAvailable: true },
    )

    expect(gated?.rubric_verdict).toBe("DEMOTED")
    expect(gated?.gate_demoted).toBe(true)
  })

  test("respects an explicit claims_value_extraction:false opt-out on a drain-worded finding", () => {
    const [gated] = applyConservationGate(
      [
        makeObs({
          seq: 1,
          check: "reentrancy-eth-drain",
          description: "drain wording but adjudicated as non-extraction",
          claims_value_extraction: false,
          rubric_verdict: "CONFIRMED",
          confidence_score: 95,
        }),
      ],
      [],
      { forgeAvailable: true },
    )

    expect(gated?.rubric_verdict).toBe("CONFIRMED")
    expect(gated?.gate_demoted).toBeUndefined()
  })

  test("does not auto-derive value extraction from negated or incidental drain wording", () => {
    const [gated] = applyConservationGate(
      [
        makeObs({
          seq: 1,
          check: "reentrancy-eth",
          description:
            "PoC proves no drain: attacker net gain is zero, so this is griefing rather than theft.",
          rubric_verdict: "CONFIRMED",
          confidence_score: 95,
        }),
      ],
      [],
      { forgeAvailable: true },
    )

    expect(gated?.rubric_verdict).toBe("CONFIRMED")
    expect(gated?.gate_demoted).toBeUndefined()
  })

  test("does not auto-derive value extraction from capitalized negation cues", () => {
    const [gated] = applyConservationGate(
      [
        makeObs({
          seq: 1,
          check: "reentrancy-eth",
          description: "No drain is possible; attacker net gain is zero.",
          rubric_verdict: "CONFIRMED",
          confidence_score: 95,
        }),
      ],
      [],
      { forgeAvailable: true },
    )

    expect(gated?.rubric_verdict).toBe("CONFIRMED")
    expect(gated?.gate_demoted).toBeUndefined()
  })
})

describe("dedupeFindingsForFinalOutput lineage preservation", () => {
  // Underpins the P0-1 report-parity fix: every raw observation_id must survive into
  // exactly one merged finding's observation_ids[] (no observation is lost or duplicated
  // by dedup), so validating report parity against the deduped universe never hides a
  // genuinely dropped observation.
  test("every raw observation_id appears in exactly one merged finding's observation_ids", () => {
    const raw = [
      makeObs({ seq: 2, observation_id: "o-2", issue_fingerprint: "issue-A" }),
      makeObs({
        seq: 3,
        observation_id: "o-3",
        issue_fingerprint: "issue-A",
        check: "reentrancy-cei",
      }),
      makeObs({
        seq: 4,
        observation_id: "o-4",
        issue_fingerprint: "issue-B",
        file: "src/Other.sol",
      }),
      makeObs({
        seq: 5,
        observation_id: "o-5",
        issue_fingerprint: "issue-B",
        file: "src/Other.sol",
      }),
      makeObs({
        seq: 6,
        observation_id: "o-6",
        issue_fingerprint: "issue-C",
        file: "src/Third.sol",
      }),
    ]

    const merged = dedupeFindingsForFinalOutput(raw)

    const rawIds = raw.map((f) => f.observation_id).sort()
    const mappedIds = merged.flatMap((f) => f.observation_ids ?? []).sort()
    expect(mappedIds).toEqual(rawIds)

    const survivingPrimaries = merged.map((f) => f.observation_id).sort()
    expect(new Set(survivingPrimaries).size).toBe(merged.length)
    for (const primary of survivingPrimaries) {
      expect(rawIds).toContain(primary)
    }
  })
})
