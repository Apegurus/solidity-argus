import { describe, expect, test } from "bun:test"
import { normalizeToCanonicalFinding } from "./adapters"
import {
  type CanonicalFinding,
  SCHEMA_VERSION,
  validateCanonicalFinding,
  validateReportInput,
} from "./schemas"

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
    observation_id: overrides.observation_id ?? "obs-1",
    issue_fingerprint: overrides.issue_fingerprint ?? "issue-fp-1",
    observation_fingerprint: overrides.observation_fingerprint ?? "obs-fp-1",
    reported_by_agent: overrides.reported_by_agent ?? "sentinel",
    reported_by_session_id: overrides.reported_by_session_id ?? "ses-1",
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

  test("fails when reported_by_agent is invalid", () => {
    const invalidAgent = makeCanonicalFinding({
      reported_by_agent: "invalid-agent" as CanonicalFinding["reported_by_agent"],
    })
    const result = validateCanonicalFinding(invalidAgent)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors.some((e) => e.field === "reported_by_agent" && e.code === "enum")).toBe(
        true,
      )
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

  test("preserves impact, recommendation, and proofOfConcept through normalization", () => {
    const raw = {
      check: "reentrancy-vault-drain",
      severity: "Critical",
      confidence: "High",
      description: "Vault withdraw is vulnerable to reentrancy",
      file: "src/Vault.sol",
      lines: [42, 58],
      source: "manual",
      impact: "Complete vault drain via recursive withdraw calls",
      recommendation: "Add nonReentrant modifier to withdraw function",
      proofOfConcept: "See test/ReentrancyPoC.t.sol::testReentrancyExploit",
    }

    const result = normalizeToCanonicalFinding(raw, "run-enrichment", 1)
    expect(result.data.impact).toBe("Complete vault drain via recursive withdraw calls")
    expect(result.data.recommendation).toBe("Add nonReentrant modifier to withdraw function")
    expect(result.data.proofOfConcept).toBe("See test/ReentrancyPoC.t.sol::testReentrancyExploit")
    expect(result.diagnostics.some((d) => d.code === "field.dropped")).toBe(false)
  })

  test("normalizes proof_of_concept snake_case alias to proofOfConcept", () => {
    const raw = {
      check: "access-control-bypass",
      severity: "High",
      confidence: "High",
      description: "Missing access control",
      file: "src/Admin.sol",
      lines: [10, 15],
      source: "manual",
      proof_of_concept: "Call setOwner from non-owner account",
    }

    const result = normalizeToCanonicalFinding(raw, "run-snake", 1)
    expect(result.data.proofOfConcept).toBe("Call setOwner from non-owner account")
    expect(result.diagnostics.some((d) => d.code === "field.dropped")).toBe(false)
  })

  test("preserves deduplication lineage fields", () => {
    const raw = {
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Merged reentrancy finding",
      file: "src/Vault.sol",
      lines: [10, 20],
      source: "manual",
      observation_ids: ["obs-b", "obs-a", "obs-a"],
      observation_count: 2,
      sources: ["manual", "slither"],
      reported_by_agents: ["sentinel", "scribe"],
    }

    const result = normalizeToCanonicalFinding(raw, "run-lineage", 1)

    expect(result.data.observation_ids).toEqual(["obs-a", "obs-b"])
    expect(result.data.observation_count).toBe(2)
    expect(result.data.sources).toEqual(["manual", "slither"])
    expect(result.data.reported_by_agents).toEqual(["scribe", "sentinel"])
    expect(result.diagnostics.some((d) => d.code === "field.dropped")).toBe(false)
  })
})

describe("validateReportInput", () => {
  function makeValidReportInput(overrides: Record<string, unknown> = {}) {
    return {
      run_id: "run-1",
      seq: 1,
      session_id: "ses-1",
      tool_call_id: "tc-1",
      source: "argus",
      schema_version: SCHEMA_VERSION,
      projectDir: "/tmp/project",
      scope: ["src/Vault.sol"],
      findings: [],
      toolsExecuted: [
        {
          tool: "slither",
          startTime: 1700000000,
          endTime: 1700000010,
          success: true,
          findingsCount: 3,
          run_id: "run-1",
          schema_version: SCHEMA_VERSION,
        },
      ],
      ...overrides,
    }
  }

  test("accepts valid toolsExecuted entry", () => {
    const result = validateReportInput(makeValidReportInput())
    expect(result.success).toBe(true)
  })

  test("returns field-indexed error when toolsExecuted entry missing success", () => {
    const result = validateReportInput(
      makeValidReportInput({
        toolsExecuted: [
          {
            tool: "slither",
            startTime: 1700000000,
            findingsCount: 3,
            run_id: "run-1",
            schema_version: SCHEMA_VERSION,
            // success intentionally omitted
          },
        ],
      }),
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors.some((e) => e.field === "toolsExecuted[0].success")).toBe(true)
    }
  })

  test("returns field-indexed error when toolsExecuted entry has negative findingsCount", () => {
    const result = validateReportInput(
      makeValidReportInput({
        toolsExecuted: [
          {
            tool: "slither",
            startTime: 1700000000,
            success: true,
            findingsCount: -1,
            run_id: "run-1",
            schema_version: SCHEMA_VERSION,
          },
        ],
      }),
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors.some((e) => e.field === "toolsExecuted[0].findingsCount")).toBe(true)
    }
  })
})

describe("normalizeToCanonicalFinding field aliases", () => {
  test("normalizes title alias to check", () => {
    const raw = {
      title: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Reentrancy in withdraw",
      file: "src/Vault.sol",
      lines: [10, 20],
      source: "manual",
    }
    const result = normalizeToCanonicalFinding(raw, "run-title", 1)
    expect(result.data.check).toBe("reentrancy-eth")
    expect(
      result.diagnostics.filter((d) => d.code === "field.dropped" && d.field === "title"),
    ).toHaveLength(0)
  })

  test("normalizes name alias to check", () => {
    const raw = {
      name: "unchecked-transfer",
      severity: "Medium",
      confidence: "Medium",
      description: "Unchecked return value",
      file: "src/Token.sol",
      lines: [5, 10],
      source: "manual",
    }
    const result = normalizeToCanonicalFinding(raw, "run-name", 1)
    expect(result.data.check).toBe("unchecked-transfer")
    expect(
      result.diagnostics.filter((d) => d.code === "field.dropped" && d.field === "name"),
    ).toHaveLength(0)
  })

  test("check field takes precedence over title alias", () => {
    const raw = {
      check: "the-real-check",
      title: "should-be-ignored",
      severity: "Low",
      confidence: "Low",
      description: "test",
      file: "src/A.sol",
      lines: [1, 2],
      source: "manual",
    }
    const result = normalizeToCanonicalFinding(raw, "run-precedence", 1)
    expect(result.data.check).toBe("the-real-check")
  })

  test("normalizes location alias to file and lines", () => {
    const raw = {
      check: "reentrancy",
      description: "State after call",
      location: "src/Vault.sol:10-15",
      severity: "High",
    }
    const result = normalizeToCanonicalFinding(raw, "run-loc", 1)
    expect(result.data.file).toBe("src/Vault.sol")
    expect(result.data.lines).toEqual([10, 15])
    expect(
      result.diagnostics.filter((d) => d.code === "field.dropped" && d.field === "location"),
    ).toHaveLength(0)
  })

  test("location without line numbers uses full string as file", () => {
    const raw = {
      check: "test",
      description: "test",
      location: "src/Token.sol",
      severity: "Low",
    }
    const result = normalizeToCanonicalFinding(raw, "run-loc2", 1)
    expect(result.data.file).toBe("src/Token.sol")
  })
})
