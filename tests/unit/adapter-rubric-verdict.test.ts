import { describe, expect, test } from "bun:test"
import { normalizeToCanonicalFinding } from "../../src/state/adapters"

describe("normalizeToCanonicalFinding — rubric_verdict passthrough", () => {
  const minimalInput = {
    check: "test",
    severity: "Low",
    confidence: "Medium",
    description: "desc",
    file: "src/A.sol",
    lines: [1, 1],
    source: "manual",
  }

  test("passes through rubric_verdict='REJECTED_DEMOTED'", () => {
    const { data } = normalizeToCanonicalFinding(
      { ...minimalInput, rubric_verdict: "REJECTED_DEMOTED" },
      "run-1",
      1,
      { reportedByAgent: "sentinel" },
    )
    expect(data.rubric_verdict).toBe("REJECTED_DEMOTED")
  })

  test("passes through rubric_verdict='CONFIRMED'", () => {
    const { data } = normalizeToCanonicalFinding(
      { ...minimalInput, rubric_verdict: "CONFIRMED" },
      "run-1",
      1,
      { reportedByAgent: "sentinel" },
    )
    expect(data.rubric_verdict).toBe("CONFIRMED")
  })

  test("omits rubric_verdict when not provided", () => {
    const { data } = normalizeToCanonicalFinding(minimalInput, "run-1", 1, {
      reportedByAgent: "sentinel",
    })
    expect(data.rubric_verdict).toBeUndefined()
  })

  test("does NOT emit field.dropped diagnostic for rubric_verdict", () => {
    const { diagnostics } = normalizeToCanonicalFinding(
      { ...minimalInput, rubric_verdict: "DEMOTED" },
      "run-1",
      1,
      { reportedByAgent: "sentinel" },
    )
    expect(
      diagnostics.some(
        (d) => d.code === "field.dropped" && d.field === "rubric_verdict",
      ),
    ).toBe(false)
  })
})
