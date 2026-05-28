import { describe, expect, test } from "bun:test"
import path from "node:path"
import { aggregate } from "./metrics"
import { type AuditDriver, loadFixture, runFixture } from "./runner"
import type { PredictedFinding } from "./types"

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..")
const VAULT_FIXTURE_DIR = path.join(REPO_ROOT, "tests/eval/fixtures/vulnerable-vault")

describe("eval harness: fixture manifest schema", () => {
  test("vulnerable-vault fixture.yaml loads and validates", () => {
    const fixture = loadFixture(VAULT_FIXTURE_DIR)
    expect(fixture.slug).toBe("vulnerable-vault")
    expect(fixture.source.license).toBe("MIT")
    expect(fixture.project.foundry).toBe(true)
    expect(fixture.expected_findings.length).toBeGreaterThanOrEqual(7)
    for (const f of fixture.expected_findings) {
      expect(f.id).toMatch(/^vv-\d{3}-/)
      expect(f.lines[0]).toBeLessThanOrEqual(f.lines[1])
      expect(f.acceptance_criteria.length).toBeGreaterThan(0)
    }
  })
})

describe("eval harness: matching + metrics", () => {
  test("perfect-prediction driver scores precision=1, recall=1, f1=1", async () => {
    const fixture = loadFixture(VAULT_FIXTURE_DIR)
    const perfectDriver: AuditDriver = {
      async audit(f) {
        const predicted: PredictedFinding[] = f.expected_findings.map((g) => ({
          check: g.id,
          severity: g.severity,
          confidence: "High",
          confidence_score: 95,
          file: g.file,
          lines: g.lines,
          source: "manual",
        }))
        return { predicted, tokens_used: 100_000 }
      },
    }
    const metrics = await runFixture({ fixture, driver: perfectDriver })
    expect(metrics.true_positives).toBe(fixture.expected_findings.length)
    expect(metrics.false_positives).toBe(0)
    expect(metrics.false_negatives).toBe(0)
    expect(metrics.precision).toBe(1)
    expect(metrics.recall).toBe(1)
    expect(metrics.f1).toBe(1)
    expect(metrics.tokens_used).toBe(100_000)
    expect(metrics.wall_time_ms).toBeGreaterThanOrEqual(0)
  })

  test("empty-prediction driver scores precision=0, recall=0, f1=0", async () => {
    const fixture = loadFixture(VAULT_FIXTURE_DIR)
    const emptyDriver: AuditDriver = {
      async audit() {
        return { predicted: [] }
      },
    }
    const metrics = await runFixture({ fixture, driver: emptyDriver })
    expect(metrics.true_positives).toBe(0)
    expect(metrics.false_negatives).toBeGreaterThan(0)
    expect(metrics.precision).toBe(0)
    expect(metrics.recall).toBe(0)
    expect(metrics.f1).toBe(0)
  })

  test("noise-only driver scores precision=0, recall=0", async () => {
    const fixture = loadFixture(VAULT_FIXTURE_DIR)
    const noiseDriver: AuditDriver = {
      async audit() {
        const predicted: PredictedFinding[] = [
          {
            check: "noise-1",
            severity: "High",
            confidence: "High",
            file: "src/NonExistent.sol",
            lines: [1, 10],
            source: "slither",
          },
        ]
        return { predicted }
      },
    }
    const metrics = await runFixture({ fixture, driver: noiseDriver })
    expect(metrics.true_positives).toBe(0)
    expect(metrics.false_positives).toBe(1)
    expect(metrics.precision).toBe(0)
  })

  test("partial-coverage driver: 2/N findings predicted correctly", async () => {
    const fixture = loadFixture(VAULT_FIXTURE_DIR)
    const partialDriver: AuditDriver = {
      async audit(f) {
        const [first, second] = f.expected_findings
        if (!first || !second) throw new Error("fixture has too few findings for this test")
        return {
          predicted: [
            {
              check: first.id,
              severity: first.severity,
              confidence: "High",
              confidence_score: 90,
              file: first.file,
              lines: first.lines,
              source: "manual",
            },
            {
              check: second.id,
              severity: second.severity,
              confidence: "Medium",
              confidence_score: 80,
              file: second.file,
              lines: second.lines,
              source: "manual",
            },
          ],
        }
      },
    }
    const metrics = await runFixture({ fixture, driver: partialDriver })
    expect(metrics.true_positives).toBe(2)
    expect(metrics.false_positives).toBe(0)
    expect(metrics.false_negatives).toBe(fixture.expected_findings.length - 2)
    expect(metrics.precision).toBe(1)
    expect(metrics.recall).toBeCloseTo(2 / fixture.expected_findings.length, 5)
  })

  test("confidence threshold filters predictions below cutoff", async () => {
    const fixture = loadFixture(VAULT_FIXTURE_DIR)
    const mixedDriver: AuditDriver = {
      async audit(f) {
        return {
          predicted: f.expected_findings.map((g, i) => ({
            check: g.id,
            severity: g.severity,
            confidence: "High" as const,
            confidence_score: i % 2 === 0 ? 90 : 60,
            file: g.file,
            lines: g.lines,
            source: "manual" as const,
          })),
        }
      },
    }
    const metrics = await runFixture({ fixture, driver: mixedDriver, confidence_threshold: 80 })
    const halfCount = Math.ceil(fixture.expected_findings.length / 2)
    expect(metrics.true_positives).toBe(halfCount)
    expect(metrics.false_positives).toBe(0)
    expect(metrics.false_negatives).toBe(fixture.expected_findings.length - halfCount)
  })
})

describe("eval harness: aggregate", () => {
  test("aggregate across two identical runs returns same micro and macro values", async () => {
    const fixture = loadFixture(VAULT_FIXTURE_DIR)
    const driver: AuditDriver = {
      async audit(f) {
        return {
          predicted: f.expected_findings.map((g) => ({
            check: g.id,
            severity: g.severity,
            confidence: "High" as const,
            confidence_score: 95,
            file: g.file,
            lines: g.lines,
            source: "manual" as const,
          })),
        }
      },
    }
    const a = await runFixture({ fixture, driver })
    const b = await runFixture({ fixture, driver })
    const agg = aggregate([a, b])
    expect(agg.total_fixtures).toBe(2)
    expect(agg.micro_precision).toBe(1)
    expect(agg.micro_recall).toBe(1)
    expect(agg.micro_f1).toBe(1)
    expect(agg.macro_precision).toBe(1)
    expect(agg.macro_recall).toBe(1)
    expect(agg.macro_f1).toBe(1)
    expect(agg.total_wall_time_ms).toBeGreaterThanOrEqual(0)
  })
})
