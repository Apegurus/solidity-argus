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
      diagnostics.some((d) => d.code === "field.dropped" && d.field === "rubric_verdict"),
    ).toBe(false)
  })

  test("drops invalid rubric_verdict value with warn diagnostic", () => {
    const { data, diagnostics } = normalizeToCanonicalFinding(
      { ...minimalInput, rubric_verdict: "REJECTED" },
      "run-1",
      1,
      { reportedByAgent: "sentinel" },
    )
    expect(data.rubric_verdict).toBeUndefined()
    expect(
      diagnostics.some(
        (d) => d.level === "warn" && d.code === "field.invalid" && d.field === "rubric_verdict",
      ),
    ).toBe(true)
  })

  test("drops non-string rubric_verdict value with warn diagnostic", () => {
    const { data, diagnostics } = normalizeToCanonicalFinding(
      { ...minimalInput, rubric_verdict: 42 },
      "run-1",
      1,
      { reportedByAgent: "sentinel" },
    )
    expect(data.rubric_verdict).toBeUndefined()
    expect(
      diagnostics.some(
        (d) => d.level === "warn" && d.code === "field.invalid" && d.field === "rubric_verdict",
      ),
    ).toBe(true)
  })
})

describe("normalizeToCanonicalFinding — confidence_score validation", () => {
  const minimalInput = {
    check: "test",
    severity: "Low",
    confidence: "Medium",
    description: "desc",
    file: "src/A.sol",
    lines: [1, 1],
    source: "manual",
  }

  test("passes through valid confidence_score (0)", () => {
    const { data } = normalizeToCanonicalFinding(
      { ...minimalInput, confidence_score: 0 },
      "run-1",
      1,
      { reportedByAgent: "sentinel" },
    )
    expect(data.confidence_score).toBe(0)
  })

  test("passes through valid confidence_score (100)", () => {
    const { data } = normalizeToCanonicalFinding(
      { ...minimalInput, confidence_score: 100 },
      "run-1",
      1,
      { reportedByAgent: "sentinel" },
    )
    expect(data.confidence_score).toBe(100)
  })

  test("drops out-of-range confidence_score (101) with warn diagnostic", () => {
    const { data, diagnostics } = normalizeToCanonicalFinding(
      { ...minimalInput, confidence_score: 101 },
      "run-1",
      1,
      { reportedByAgent: "sentinel" },
    )
    expect(data.confidence_score).toBeUndefined()
    expect(
      diagnostics.some(
        (d) => d.level === "warn" && d.code === "field.invalid" && d.field === "confidence_score",
      ),
    ).toBe(true)
  })

  test("drops negative confidence_score with warn diagnostic", () => {
    const { data, diagnostics } = normalizeToCanonicalFinding(
      { ...minimalInput, confidence_score: -1 },
      "run-1",
      1,
      { reportedByAgent: "sentinel" },
    )
    expect(data.confidence_score).toBeUndefined()
    expect(
      diagnostics.some((d) => d.code === "field.invalid" && d.field === "confidence_score"),
    ).toBe(true)
  })

  test("drops floating-point confidence_score with warn diagnostic", () => {
    const { data, diagnostics } = normalizeToCanonicalFinding(
      { ...minimalInput, confidence_score: 50.5 },
      "run-1",
      1,
      { reportedByAgent: "sentinel" },
    )
    expect(data.confidence_score).toBeUndefined()
    expect(
      diagnostics.some((d) => d.code === "field.invalid" && d.field === "confidence_score"),
    ).toBe(true)
  })

  test("drops NaN confidence_score with warn diagnostic", () => {
    const { data, diagnostics } = normalizeToCanonicalFinding(
      { ...minimalInput, confidence_score: Number.NaN },
      "run-1",
      1,
      { reportedByAgent: "sentinel" },
    )
    expect(data.confidence_score).toBeUndefined()
    expect(
      diagnostics.some((d) => d.code === "field.invalid" && d.field === "confidence_score"),
    ).toBe(true)
  })

  test("drops Infinity confidence_score with warn diagnostic", () => {
    const { data, diagnostics } = normalizeToCanonicalFinding(
      { ...minimalInput, confidence_score: Number.POSITIVE_INFINITY },
      "run-1",
      1,
      { reportedByAgent: "sentinel" },
    )
    expect(data.confidence_score).toBeUndefined()
    expect(
      diagnostics.some((d) => d.code === "field.invalid" && d.field === "confidence_score"),
    ).toBe(true)
  })

  test("drops null confidence_score with warn diagnostic", () => {
    const { data, diagnostics } = normalizeToCanonicalFinding(
      { ...minimalInput, confidence_score: null },
      "run-1",
      1,
      { reportedByAgent: "sentinel" },
    )
    expect(data.confidence_score).toBeUndefined()
    expect(
      diagnostics.some((d) => d.code === "field.invalid" && d.field === "confidence_score"),
    ).toBe(true)
  })

  test("drops string confidence_score with warn diagnostic", () => {
    const { data, diagnostics } = normalizeToCanonicalFinding(
      { ...minimalInput, confidence_score: "85" },
      "run-1",
      1,
      { reportedByAgent: "sentinel" },
    )
    expect(data.confidence_score).toBeUndefined()
    expect(
      diagnostics.some((d) => d.code === "field.invalid" && d.field === "confidence_score"),
    ).toBe(true)
  })
})
