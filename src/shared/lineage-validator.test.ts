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
    duplicate_observation_ids: [],
    phantom_observation_ids: [],
    missing_observation_ids: [],
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
    duplicate_observation_ids: ["obs-a"],
    phantom_observation_ids: ["obs-missing"],
    missing_observation_ids: ["obs-b", "obs-c"],
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
