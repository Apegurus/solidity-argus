import { describe, expect, test } from "bun:test"
import { normalizeLegacyFindingsArray, normalizeToCanonicalFinding } from "./adapters"
import { type CanonicalFinding, SCHEMA_VERSION, validateCanonicalFinding } from "./schemas"

function makeCanonicalFinding(overrides: Partial<CanonicalFinding> = {}): CanonicalFinding {
  return {
    id: overrides.id ?? "finding-1",
    check: overrides.check ?? "reentrancy-eth",
    severity: overrides.severity ?? "High",
    confidence: overrides.confidence ?? "High",
    description: overrides.description ?? "Potential reentrancy in withdraw",
    file: overrides.file ?? "src/Vault.sol",
    lines: overrides.lines ?? [12, 17],
    source: overrides.source ?? "slither",
    remediation: overrides.remediation,
    exploitReference: overrides.exploitReference,
    provenance: overrides.provenance,
    run_id: overrides.run_id ?? "run-123",
    seq: overrides.seq ?? 1,
    schema_version: overrides.schema_version ?? SCHEMA_VERSION,
  }
}

describe("validateCanonicalFinding", () => {
  test("accepts valid full payload", () => {
    const valid = makeCanonicalFinding()
    const result = validateCanonicalFinding(valid)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.run_id).toBe("run-123")
      expect(result.data.seq).toBe(1)
      expect(result.data.schema_version).toBe(SCHEMA_VERSION)
    }
  })

  test("fails when severity is missing", () => {
    const missingSeverity = { ...makeCanonicalFinding(), severity: undefined }
    const result = validateCanonicalFinding(missingSeverity)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors.some((e) => e.field === "severity")).toBe(true)
    }
  })

  test('fails when severity enum is invalid ("Unknown")', () => {
    const invalidSeverity = makeCanonicalFinding({
      severity: "Unknown" as CanonicalFinding["severity"],
    })
    const result = validateCanonicalFinding(invalidSeverity)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors.some((e) => e.field === "severity" && e.code === "enum")).toBe(true)
    }
  })

  test("fails when run_id is missing", () => {
    const missingRunId = { ...makeCanonicalFinding(), run_id: "" }
    const result = validateCanonicalFinding(missingRunId)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors.some((e) => e.field === "run_id")).toBe(true)
    }
  })
})

describe("normalizeToCanonicalFinding", () => {
  test("normalizes clean existing Finding", () => {
    const raw = {
      id: "f-1",
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Potential reentrancy",
      file: "src/Vault.sol",
      lines: [10, 13],
      source: "slither",
    }

    const result = normalizeToCanonicalFinding(raw, "run-clean", 4)
    expect(result.data.run_id).toBe("run-clean")
    expect(result.data.seq).toBe(4)
    expect(result.data.schema_version).toBe(SCHEMA_VERSION)
    expect(result.diagnostics.some((d) => d.level === "error")).toBe(false)
  })

  test("normalizes legacy detector alias to check", () => {
    const raw = {
      detector: "unchecked-call",
      severity: "medium",
      confidence: "high",
      impact: "Unchecked external call",
      file: "src/Token.sol",
      lines: [22, 24],
      source: "slither",
    }

    const result = normalizeToCanonicalFinding(raw, "run-alias", 5)
    expect(result.data.check).toBe("unchecked-call")
    expect(result.data.description).toBe("Unchecked external call")
    expect(result.data.severity).toBe("Medium")
  })

  test("emits diagnostic for missing required file field", () => {
    const raw = {
      check: "missing-file",
      severity: "High",
      confidence: "Low",
      description: "No file path supplied",
      lines: [1, 2],
      source: "manual",
    }

    const result = normalizeToCanonicalFinding(raw, "run-missing-file", 1)
    expect(result.diagnostics.some((d) => d.level === "error" && d.field === "file")).toBe(true)
  })

  test("normalizes slither elements alias into file", () => {
    const raw = {
      detector: "reentrancy-eth",
      first_markdown_element: "Reentrancy with external call",
      severity: "high",
      confidence: "medium",
      lines: [40, 45],
      source: "slither",
      elements: [
        {
          source_mapping: {
            filename_relative: "contracts/Vault.sol",
          },
        },
      ],
    }

    const result = normalizeToCanonicalFinding(raw, "run-slither", 8)
    expect(result.data.file).toBe("contracts/Vault.sol")
    expect(result.data.description).toBe("Reentrancy with external call")
    expect(result.diagnostics.some((d) => d.level === "error")).toBe(false)
  })
})

describe("normalizeLegacyFindingsArray", () => {
  test("returns canonical findings and diagnostics for mixed payloads", () => {
    const mixed = [
      {
        check: "valid-finding",
        severity: "High",
        confidence: "High",
        description: "Valid finding",
        file: "src/A.sol",
        lines: [1, 2],
        source: "manual",
      },
      {
        detector: "missing-file",
        severity: "Medium",
        confidence: "Low",
        impact: "No file alias either",
        lines: [8, 9],
        source: "slither",
      },
      {
        check: "extra-field",
        severity: "Low",
        confidence: "Low",
        description: "Has unknown field",
        file: "src/B.sol",
        lines: [3, 3],
        source: "manual",
        unknown_payload: true,
      },
    ]

    const result = normalizeLegacyFindingsArray(mixed, "run-batch")
    expect(result.findings).toHaveLength(2)
    expect(result.findings[0]?.seq).toBe(1)
    expect(result.findings[1]?.seq).toBe(3)
    expect(
      result.diagnostics.some((d) => d.level === "error" && d.message.includes("index:1")),
    ).toBe(true)
    expect(
      result.diagnostics.some(
        (d) => d.level === "warn" && d.code === "field.dropped" && d.message.includes("index:2"),
      ),
    ).toBe(true)
  })
})
