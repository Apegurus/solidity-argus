import { expect, test } from "bun:test"
import { type CanonicalFinding, SCHEMA_VERSION } from "../state/schemas"
import { validateFindingLineage } from "./lineage-validator"

function finding(overrides: Partial<CanonicalFinding> = {}): CanonicalFinding {
  const id = overrides.id ?? "finding-1"
  return {
    id,
    check: overrides.check ?? id,
    severity: overrides.severity ?? "Medium",
    confidence: overrides.confidence ?? "High",
    description: overrides.description ?? id,
    file: overrides.file ?? "src/Vault.sol",
    lines: overrides.lines ?? [1, 1],
    source: overrides.source ?? "manual",
    run_id: overrides.run_id ?? "run-1",
    seq: overrides.seq ?? 1,
    schema_version: overrides.schema_version ?? SCHEMA_VERSION,
    observation_id: overrides.observation_id ?? `obs-${id}`,
    issue_fingerprint: overrides.issue_fingerprint ?? `issue-${id}`,
    observation_fingerprint: overrides.observation_fingerprint ?? `obsfp-${id}`,
    reported_by_agent: overrides.reported_by_agent ?? "sentinel",
    observation_ids: overrides.observation_ids,
    observation_count: overrides.observation_count,
  }
}

test("validateFindingLineage accepts complete one-to-one lineage", () => {
  const raw = [finding({ id: "raw-a", observation_id: "obs-a" })]
  const deduped = [
    finding({ id: "dedup-a", check: "dedup-a", observation_ids: ["obs-a"], observation_count: 1 }),
  ]

  expect(validateFindingLineage(raw, deduped)).toEqual({
    valid: true,
    raw_count: 1,
    mapped_count: 1,
    dropped_count: 0,
    duplicate_observation_ids: [],
    phantom_observation_ids: [],
    missing_observation_ids: [],
    duplicate_dropped_observation_ids: [],
    phantom_dropped_observation_ids: [],
    overlapping_mapped_dropped_observation_ids: [],
    invalid_dropped_observations: [],
    count_mismatches: [],
  })
})

test("validateFindingLineage reports duplicate phantom missing and count mismatches deterministically", () => {
  const raw = [
    finding({ id: "raw-a", observation_id: "obs-a" }),
    finding({ id: "raw-b", observation_id: "obs-b" }),
    finding({ id: "raw-c", observation_id: "obs-c" }),
  ]
  const deduped = [
    finding({
      id: "dedup-z",
      check: "z-check",
      observation_ids: ["obs-a", "obs-missing"],
      observation_count: 3,
    }),
    finding({ id: "dedup-a", check: "a-check", observation_ids: ["obs-a"], observation_count: 1 }),
  ]

  expect(validateFindingLineage(raw, deduped)).toEqual({
    valid: false,
    raw_count: 3,
    mapped_count: 3,
    dropped_count: 0,
    duplicate_observation_ids: ["obs-a"],
    phantom_observation_ids: ["obs-missing"],
    missing_observation_ids: ["obs-b", "obs-c"],
    duplicate_dropped_observation_ids: [],
    phantom_dropped_observation_ids: [],
    overlapping_mapped_dropped_observation_ids: [],
    invalid_dropped_observations: [],
    count_mismatches: [{ check: "z-check", observation_count: 3, observation_ids_length: 2 }],
  })
})

test("validateFindingLineage requires non-empty observation_ids for every deduped finding", () => {
  const raw = [finding({ id: "raw-a", observation_id: "obs-a" })]
  const deduped = [finding({ id: "dedup-a", check: "dedup-a", observation_ids: [] })]

  const result = validateFindingLineage(raw, deduped)

  expect(result.valid).toBe(false)
  expect(result.missing_observation_ids).toEqual(["obs-a"])
  expect(result.count_mismatches).toEqual([
    { check: "dedup-a", observation_count: undefined, observation_ids_length: 0 },
  ])
})

test("validateFindingLineage treats explicitly dropped observations as complete", () => {
  const raw = [
    finding({ id: "raw-a", observation_id: "obs-a" }),
    finding({ id: "raw-b", observation_id: "obs-b" }),
  ]
  const deduped = [
    finding({ id: "dedup-a", check: "dedup-a", observation_ids: ["obs-a"], observation_count: 1 }),
  ]

  expect(
    validateFindingLineage(raw, deduped, [
      { observation_id: "obs-b", reason: "out-of-scope", note: "outside requested scope" },
    ]),
  ).toEqual({
    valid: true,
    raw_count: 2,
    mapped_count: 1,
    dropped_count: 1,
    duplicate_observation_ids: [],
    phantom_observation_ids: [],
    missing_observation_ids: [],
    duplicate_dropped_observation_ids: [],
    phantom_dropped_observation_ids: [],
    overlapping_mapped_dropped_observation_ids: [],
    invalid_dropped_observations: [],
    count_mismatches: [],
  })
})

test("validateFindingLineage reports observations that are both mapped and dropped", () => {
  const raw = [finding({ id: "raw-a", observation_id: "obs-a" })]
  const deduped = [
    finding({ id: "dedup-a", check: "dedup-a", observation_ids: ["obs-a"], observation_count: 1 }),
  ]

  const result = validateFindingLineage(raw, deduped, [
    { observation_id: "obs-a", reason: "false-positive" },
  ])

  expect(result.valid).toBe(false)
  expect(result.overlapping_mapped_dropped_observation_ids).toEqual(["obs-a"])
})

test("validateFindingLineage rejects invalid dropped observation reasons and duplicates", () => {
  const raw = [finding({ id: "raw-a", observation_id: "obs-a" })]
  const dropped = [
    { observation_id: "obs-a", reason: "invalid-reason" },
    { observation_id: "obs-a", reason: "false-positive" },
    { observation_id: "obs-phantom", reason: "false-positive" },
  ] as unknown as Parameters<typeof validateFindingLineage>[2]
  const result = validateFindingLineage(raw, [], dropped)

  expect(result.valid).toBe(false)
  expect(result.duplicate_dropped_observation_ids).toEqual(["obs-a"])
  expect(result.phantom_dropped_observation_ids).toEqual(["obs-phantom"])
  expect(result.overlapping_mapped_dropped_observation_ids).toEqual([])
  expect(result.invalid_dropped_observations).toEqual([
    { observation_id: "obs-a", reason: "invalid-reason" },
  ])
})

// Documents the P0-1 deduped-universe contract: report parity and persist-deduped both
// validate against the deduped findings.json, whose singular observation_id is the
// representative survivor. An observation collapsed into observation_ids[] is NOT part of
// the raw universe, so the deduped set may neither reference nor drop a collapsed id.
test("validateFindingLineage rejects dropping a collapsed (non-representative) observation", () => {
  const raw = [
    finding({
      id: "rep",
      observation_id: "obs-rep",
      observation_ids: ["obs-rep", "obs-collapsed"],
      observation_count: 2,
    }),
  ]
  const deduped = [
    finding({
      id: "rep",
      observation_id: "obs-rep",
      observation_ids: ["obs-rep"],
      observation_count: 1,
    }),
  ]

  expect(validateFindingLineage(raw, deduped).valid).toBe(true)

  const droppingCollapsed = validateFindingLineage(raw, deduped, [
    { observation_id: "obs-collapsed", reason: "merged-into" },
  ])
  expect(droppingCollapsed.valid).toBe(false)
  expect(droppingCollapsed.phantom_dropped_observation_ids).toEqual(["obs-collapsed"])
})
