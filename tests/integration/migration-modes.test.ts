import { describe, expect, test } from "bun:test"
import { ArgusConfigSchema } from "../../src/config/schema"
import {
  adaptLegacyFindings,
  adaptLegacyStateToReportInput,
  computeParityMetrics,
  formatParityReport,
  validateStrictCompatibility,
} from "../../src/features/migration"
import { DropDiagnosticsError } from "../../src/shared/drop-diagnostics"
import type { AuditState, Finding } from "../../src/state/types"

const RUN_ID = "run-migration-test"

function makeValidFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: overrides.id ?? "finding-1",
    check: overrides.check ?? "reentrancy-eth",
    severity: overrides.severity ?? "High",
    confidence: overrides.confidence ?? "High",
    description: overrides.description ?? "Reentrancy vulnerability in withdraw()",
    file: overrides.file ?? "src/Vault.sol",
    lines: overrides.lines ?? [42, 55],
    source: overrides.source ?? "slither",
    remediation: overrides.remediation,
    exploitReference: overrides.exploitReference,
    provenance: overrides.provenance,
  }
}

function makeIncompleteFinding(): Record<string, unknown> {
  return {
    id: "incomplete-1",
    severity: "High",
    description: "Missing required check and file fields",
  }
}

function makeAuditState(findings: Finding[] = [makeValidFinding()]): AuditState {
  return {
    sessionId: "session-migration",
    projectDir: "/tmp/migration-project",
    contractsReviewed: ["src/Vault.sol"],
    findings,
    toolsExecuted: [
      { tool: "slither", startTime: 1000, endTime: 2000, success: true, findingsCount: 1 },
    ],
    currentPhase: "complete",
    scope: ["src/Vault.sol"],
    startTime: 1000,
  }
}

describe("Migration Modes", () => {
  describe("Config Schema", () => {
    test("defaults to undefined when not specified", () => {
      const config = ArgusConfigSchema.parse({})
      expect(config.migration).toBeUndefined()
    })

    test("defaults mode to legacy when migration object provided", () => {
      const config = ArgusConfigSchema.parse({ migration: {} })
      expect(config.migration?.mode).toBe("legacy")
    })

    test("accepts dual mode", () => {
      const config = ArgusConfigSchema.parse({ migration: { mode: "dual" } })
      expect(config.migration?.mode).toBe("dual")
    })

    test("accepts strict mode", () => {
      const config = ArgusConfigSchema.parse({ migration: { mode: "strict" } })
      expect(config.migration?.mode).toBe("strict")
    })

    test("rejects invalid mode", () => {
      expect(() => ArgusConfigSchema.parse({ migration: { mode: "invalid" } })).toThrow()
    })
  })

  describe("Legacy mode passes through unchanged", () => {
    test("returns legacy findings without canonical conversion", () => {
      const state = makeAuditState()
      const result = adaptLegacyFindings(state, "legacy", RUN_ID)

      expect(result.legacyFindings).toEqual(state.findings)
      expect(result.canonicalFindings).toHaveLength(0)
      expect(result.diagnostics).toHaveLength(0)
    })

    test("does not modify original findings array", () => {
      const findings = [makeValidFinding()]
      const originalJson = JSON.stringify(findings)
      const state = makeAuditState(findings)

      adaptLegacyFindings(state, "legacy", RUN_ID)

      expect(JSON.stringify(state.findings)).toBe(originalJson)
    })
  })

  describe("Dual mode emits parity metrics without breaking legacy flow", () => {
    test("produces both legacy and canonical findings", () => {
      const state = makeAuditState([
        makeValidFinding({ id: "f1", severity: "High" }),
        makeValidFinding({ id: "f2", severity: "Medium", check: "unchecked-return" }),
      ])
      const result = adaptLegacyFindings(state, "dual", RUN_ID)

      expect(result.legacyFindings).toHaveLength(2)
      expect(result.canonicalFindings).toHaveLength(2)
      expect(result.canonicalFindings[0]?.run_id).toBe(RUN_ID)
      expect(result.canonicalFindings[0]?.schema_version).toBe("1.0.0")
    })

    test("computes parity metrics comparing legacy and canonical", () => {
      const state = makeAuditState([
        makeValidFinding({ id: "f1", severity: "High" }),
        makeValidFinding({ id: "f2", severity: "Medium", check: "unchecked-return" }),
      ])
      const { legacyFindings, canonicalFindings } = adaptLegacyFindings(state, "dual", RUN_ID)
      const metrics = computeParityMetrics(legacyFindings, canonicalFindings)

      expect(metrics.legacyFindingCount).toBe(2)
      expect(metrics.canonicalFindingCount).toBe(2)
      expect(metrics.findingCountDiff).toBe(0)
      expect(typeof metrics.legacyContentHash).toBe("string")
      expect(typeof metrics.canonicalContentHash).toBe("string")
      expect(metrics.timestamp).toBeGreaterThan(0)
    })

    test("detects severity distribution diffs between legacy and canonical", () => {
      const legacyFindings: Finding[] = [
        makeValidFinding({ id: "f1", severity: "High" }),
        makeValidFinding({ id: "f2", severity: "Low" }),
      ]
      const canonicalFindings = [
        {
          ...makeValidFinding({ id: "f1", severity: "High" }),
          run_id: RUN_ID,
          seq: 1,
          schema_version: "1.0.0",
        },
        {
          ...makeValidFinding({ id: "f2", severity: "Medium" }),
          run_id: RUN_ID,
          seq: 2,
          schema_version: "1.0.0",
        },
      ]
      const metrics = computeParityMetrics(legacyFindings, canonicalFindings)

      expect(metrics.severityDiffs).toHaveProperty("Medium", 1)
      expect(metrics.severityDiffs).toHaveProperty("Low", -1)
    })

    test("identifies findings only in one path", () => {
      const legacyFindings: Finding[] = [
        makeValidFinding({ id: "shared-1" }),
        makeValidFinding({ id: "legacy-only" }),
      ]
      const canonicalFindings = [
        {
          ...makeValidFinding({ id: "shared-1" }),
          run_id: RUN_ID,
          seq: 1,
          schema_version: "1.0.0",
        },
        {
          ...makeValidFinding({ id: "canonical-only" }),
          run_id: RUN_ID,
          seq: 2,
          schema_version: "1.0.0",
        },
      ]
      const metrics = computeParityMetrics(legacyFindings, canonicalFindings)

      expect(metrics.onlyInLegacy).toContain("legacy-only")
      expect(metrics.onlyInCanonical).toContain("canonical-only")
      expect(metrics.hashMatch).toBe(false)
    })

    test("formats human-readable parity report", () => {
      const state = makeAuditState([makeValidFinding()])
      const { legacyFindings, canonicalFindings } = adaptLegacyFindings(state, "dual", RUN_ID)
      const metrics = computeParityMetrics(legacyFindings, canonicalFindings)
      const report = formatParityReport(metrics)

      expect(report).toContain("Migration Parity Report")
      expect(report).toContain("Finding count:")
      expect(report).toContain("Content hash match:")
    })

    test("does not throw even with normalization warnings", () => {
      const state = makeAuditState([makeValidFinding()])
      const result = adaptLegacyFindings(state, "dual", RUN_ID)

      expect(result.legacyFindings).toHaveLength(1)
      expect(result.canonicalFindings).toHaveLength(1)
    })

    test("adapts legacy state to ReportInput", () => {
      const state = makeAuditState([makeValidFinding()])
      const { reportInput } = adaptLegacyStateToReportInput(state, "dual", RUN_ID)

      expect(reportInput.run_id).toBe(RUN_ID)
      expect(reportInput.schema_version).toBe("1.0.0")
      expect(reportInput.findings).toHaveLength(1)
      expect(reportInput.projectDir).toBe("/tmp/migration-project")
      expect(reportInput.scope).toEqual(["src/Vault.sol"])
      expect(reportInput.toolsExecuted).toHaveLength(1)
      expect(reportInput.toolsExecuted[0]?.run_id).toBe(RUN_ID)
    })
  })

  describe("Strict mode rejects legacy-only incompatible payload", () => {
    test("throws DropDiagnosticsError for findings missing required fields", () => {
      const incompleteFinding = makeIncompleteFinding() as unknown as Finding
      const state = makeAuditState([incompleteFinding])

      expect(() => adaptLegacyFindings(state, "strict", RUN_ID)).toThrow(DropDiagnosticsError)
    })

    test("error contains diagnostic details", () => {
      const incompleteFinding = makeIncompleteFinding() as unknown as Finding
      const state = makeAuditState([incompleteFinding])

      try {
        adaptLegacyFindings(state, "strict", RUN_ID)
        expect.unreachable("should have thrown")
      } catch (err) {
        expect(err).toBeInstanceOf(DropDiagnosticsError)
        const diagErr = err as DropDiagnosticsError
        expect(diagErr.diagnostics.length).toBeGreaterThan(0)
        expect(diagErr.diagnostics.some((d) => d.reason.policy === "strict-fail")).toBe(true)
      }
    })

    test("passes valid findings in strict mode", () => {
      const state = makeAuditState([makeValidFinding()])
      const result = adaptLegacyFindings(state, "strict", RUN_ID)

      expect(result.canonicalFindings).toHaveLength(1)
      expect(result.diagnostics.every((d) => d.reason.policy !== "strict-fail")).toBe(true)
    })

    test("validateStrictCompatibility reports incompatible findings", () => {
      const incompleteFinding = makeIncompleteFinding() as unknown as Finding
      const state = makeAuditState([incompleteFinding])
      const { compatible, errors } = validateStrictCompatibility(state, RUN_ID)

      expect(compatible).toBe(false)
      expect(errors.length).toBeGreaterThan(0)
    })

    test("validateStrictCompatibility confirms valid findings", () => {
      const state = makeAuditState([makeValidFinding()])
      const { compatible, errors } = validateStrictCompatibility(state, RUN_ID)

      expect(compatible).toBe(true)
      expect(errors).toHaveLength(0)
    })

    test("strict mode blocks legacy-only report input adaptation", () => {
      const incompleteFinding = makeIncompleteFinding() as unknown as Finding
      const state = makeAuditState([incompleteFinding])

      expect(() => adaptLegacyStateToReportInput(state, "strict", RUN_ID)).toThrow(
        DropDiagnosticsError,
      )
    })
  })

  describe("Parity telemetry edge cases", () => {
    test("handles empty findings arrays", () => {
      const metrics = computeParityMetrics([], [])

      expect(metrics.legacyFindingCount).toBe(0)
      expect(metrics.canonicalFindingCount).toBe(0)
      expect(metrics.findingCountDiff).toBe(0)
      expect(metrics.hashMatch).toBe(true)
      expect(metrics.onlyInLegacy).toHaveLength(0)
      expect(metrics.onlyInCanonical).toHaveLength(0)
    })

    test("severity distribution counts all severity levels", () => {
      const findings: Finding[] = [
        makeValidFinding({ id: "c1", severity: "Critical" }),
        makeValidFinding({ id: "h1", severity: "High" }),
        makeValidFinding({ id: "m1", severity: "Medium" }),
        makeValidFinding({ id: "l1", severity: "Low" }),
        makeValidFinding({ id: "i1", severity: "Informational" }),
      ]
      const metrics = computeParityMetrics(findings, [])

      expect(metrics.legacySeverityDistribution).toEqual({
        Critical: 1,
        High: 1,
        Medium: 1,
        Low: 1,
        Informational: 1,
      })
    })
  })
})
