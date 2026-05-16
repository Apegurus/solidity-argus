import { describe, expect, test } from "bun:test"
import { validateCanonicalFinding, SCHEMA_VERSION } from "../../src/state/schemas"

function baseFinding(extra: Record<string, unknown> = {}): unknown {
  return {
    id: "f-1",
    check: "reentrancy",
    description: "test",
    file: "Vault.sol",
    lines: [10, 20],
    severity: "High",
    confidence: "Medium",
    source: "manual",
    run_id: "r-1",
    seq: 0,
    schema_version: SCHEMA_VERSION,
    observation_id: "o-1",
    issue_fingerprint: "abc",
    observation_fingerprint: "def",
    reported_by_agent: "sentinel",
    ...extra,
  }
}

describe("confidence_score field validation", () => {
  test("absent confidence_score still validates (backward compat)", () => {
    const r = validateCanonicalFinding(baseFinding())
    expect(r.success).toBe(true)
  })

  test("confidence_score = 0 is valid", () => {
    const r = validateCanonicalFinding(baseFinding({ confidence_score: 0 }))
    expect(r.success).toBe(true)
  })

  test("confidence_score = 100 is valid", () => {
    const r = validateCanonicalFinding(baseFinding({ confidence_score: 100 }))
    expect(r.success).toBe(true)
  })

  test("confidence_score = 75 is valid", () => {
    const r = validateCanonicalFinding(baseFinding({ confidence_score: 75 }))
    expect(r.success).toBe(true)
  })

  test("confidence_score = -1 is invalid", () => {
    const r = validateCanonicalFinding(baseFinding({ confidence_score: -1 }))
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.errors.some((e) => e.field === "confidence_score")).toBe(true)
    }
  })

  test("confidence_score = 101 is invalid", () => {
    const r = validateCanonicalFinding(baseFinding({ confidence_score: 101 }))
    expect(r.success).toBe(false)
  })

  test("confidence_score = 50.5 is invalid (must be integer)", () => {
    const r = validateCanonicalFinding(baseFinding({ confidence_score: 50.5 }))
    expect(r.success).toBe(false)
  })

  test("confidence_score = '50' is invalid (must be number)", () => {
    const r = validateCanonicalFinding(baseFinding({ confidence_score: "50" }))
    expect(r.success).toBe(false)
  })

  test("confidence_score = null is invalid (must be number or absent)", () => {
    const r = validateCanonicalFinding(baseFinding({ confidence_score: null }))
    expect(r.success).toBe(false)
  })

  test("SCHEMA_VERSION remains 2.0.0 (additive change)", () => {
    expect(SCHEMA_VERSION).toBe("2.0.0")
  })
})
