import { describe, expect, it } from "bun:test"
import type { SkillDoc } from "./normalize"
import type { SimilarityPair, SimilarityScore } from "./similarity"
import {
  DEFAULT_GATE_CONFIG,
  checkExactRegexConflicts,
  evaluatePair,
  formatReportJson,
  formatReportText,
  generateReport,
} from "./gates"
import type { SkillReport } from "./gates"

function makeScore(overrides: Partial<SimilarityScore>): SimilarityScore {
  return {
    composite: 0,
    bodyTfidf: 0,
    bodyShingle: 0,
    nameDesc: 0,
    detectionRules: 0,
    ...overrides,
  }
}

function makePair(skillA: string, skillB: string, score: Partial<SimilarityScore>): SimilarityPair {
  return {
    skillA,
    skillB,
    score: makeScore(score),
  }
}

function makeDoc(overrides: Partial<SkillDoc>): SkillDoc {
  return {
    name: "skill",
    description: "",
    category: undefined,
    detectionRules: [],
    bodyText: "",
    bodyTokens: [],
    nameDescTokens: [],
    ruleTokens: [],
    ...overrides,
  }
}

describe("gates", () => {
  describe("evaluatePair", () => {
    it("returns block for composite >= 0.90", () => {
      const verdict = evaluatePair(
        makePair("alpha", "beta", {
          composite: 0.91,
          bodyTfidf: 0.95,
          nameDesc: 0.82,
          bodyShingle: 0.6,
          detectionRules: 0.4,
        }),
      )

      expect(verdict.level).toBe("block")
    })

    it("returns warn for composite 0.78-0.89", () => {
      const verdict = evaluatePair(
        makePair("alpha", "beta", {
          composite: 0.8,
          bodyTfidf: 0.85,
          nameDesc: 0.7,
        }),
      )

      expect(verdict.level).toBe("warn")
    })

    it("returns info for composite 0.65-0.77", () => {
      const verdict = evaluatePair(
        makePair("alpha", "beta", {
          composite: 0.7,
          bodyTfidf: 0.72,
          nameDesc: 0.67,
        }),
      )

      expect(verdict.level).toBe("info")
    })

    it("returns pass for composite below 0.65", () => {
      const verdict = evaluatePair(
        makePair("alpha", "beta", {
          composite: 0.4,
          bodyTfidf: 0.45,
          nameDesc: 0.3,
        }),
      )

      expect(verdict.level).toBe("pass")
    })

    it("respects custom thresholds", () => {
      const verdict = evaluatePair(
        makePair("alpha", "beta", {
          composite: 0.76,
          bodyTfidf: 0.76,
          nameDesc: 0.76,
        }),
        {
          ...DEFAULT_GATE_CONFIG,
          blockThreshold: 0.95,
          warnThreshold: 0.75,
          infoThreshold: 0.5,
        },
      )

      expect(verdict.level).toBe("warn")
    })
  })

  describe("checkExactRegexConflicts", () => {
    it("finds shared exact regex across different skills", () => {
      const docs = [
        makeDoc({ name: "skill-a", detectionRules: ["\\.call\\{value:"] }),
        makeDoc({ name: "skill-b", detectionRules: ["\\.call\\{value:"] }),
      ]

      const conflicts = checkExactRegexConflicts(docs)
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0]).toEqual({
        skillA: "skill-a",
        skillB: "skill-b",
        sharedRegex: "\\.call\\{value:",
      })
    })

    it("ignores same-skill rules", () => {
      const docs = [
        makeDoc({ name: "skill-a", detectionRules: ["tx\\.origin"] }),
        makeDoc({ name: "skill-a", detectionRules: ["tx\\.origin"] }),
      ]

      const conflicts = checkExactRegexConflicts(docs)
      expect(conflicts).toHaveLength(0)
    })

    it("normalizes whitespace when comparing regexes", () => {
      const docs = [
        makeDoc({ name: "skill-a", detectionRules: ["foo   bar"] }),
        makeDoc({ name: "skill-b", detectionRules: ["foo bar"] }),
      ]

      const conflicts = checkExactRegexConflicts(docs)
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0]?.sharedRegex).toBe("foo bar")
    })
  })

  describe("generateReport", () => {
    it("includes block/warn/info and excludes pass", () => {
      const docs = [
        makeDoc({ name: "a" }),
        makeDoc({ name: "b" }),
        makeDoc({ name: "c" }),
        makeDoc({ name: "d" }),
      ]
      const pairs = [
        makePair("a", "b", { composite: 0.92, bodyTfidf: 0.95, nameDesc: 0.88 }),
        makePair("a", "c", { composite: 0.8, bodyTfidf: 0.82, nameDesc: 0.74 }),
        makePair("b", "c", { composite: 0.7, bodyTfidf: 0.71, nameDesc: 0.68 }),
        makePair("c", "d", { composite: 0.4, bodyTfidf: 0.4, nameDesc: 0.4 }),
      ]

      const report = generateReport(docs, pairs, {
        ...DEFAULT_GATE_CONFIG,
        blockExactRegexConflict: false,
      })

      expect(report.findings).toHaveLength(3)
      expect(
        report.findings.map((finding: { verdict: { level: string } }) => finding.verdict.level),
      ).toEqual(["block", "warn", "info"])
    })

    it("sorts findings by level then score", () => {
      const docs = [makeDoc({ name: "a" }), makeDoc({ name: "b" }), makeDoc({ name: "c" }), makeDoc({ name: "d" })]

      const pairs = [
        makePair("b", "c", { composite: 0.79, bodyTfidf: 0.8 }),
        makePair("a", "b", { composite: 0.95, bodyTfidf: 0.95 }),
        makePair("a", "c", { composite: 0.82, bodyTfidf: 0.84 }),
        makePair("c", "d", { composite: 0.66, bodyTfidf: 0.66 }),
      ]

      const report = generateReport(docs, pairs, {
        ...DEFAULT_GATE_CONFIG,
        blockExactRegexConflict: false,
      })

      expect(report.findings[0]?.verdict.level).toBe("block")
      expect(report.findings[1]?.verdict.level).toBe("warn")
      expect(report.findings[1]?.score.composite).toBeGreaterThanOrEqual(report.findings[2]?.score.composite ?? 0)
      expect(report.findings[3]?.verdict.level).toBe("info")
    })

    it("returns correct summary counts", () => {
      const docs = [makeDoc({ name: "a" }), makeDoc({ name: "b" }), makeDoc({ name: "c" })]
      const pairs = [
        makePair("a", "b", { composite: 0.91, bodyTfidf: 0.91 }),
        makePair("a", "c", { composite: 0.8, bodyTfidf: 0.8 }),
        makePair("b", "c", { composite: 0.7, bodyTfidf: 0.7 }),
      ]

      const report = generateReport(docs, pairs, {
        ...DEFAULT_GATE_CONFIG,
        blockExactRegexConflict: false,
      })

      expect(report.summary).toEqual({ block: 1, warn: 1, info: 1 })
    })
  })

  describe("formatters", () => {
    it("formatReportText includes header with counts", () => {
      const report: SkillReport = {
        totalSkills: 3,
        findings: [
          {
            skillA: "a",
            skillB: "b",
            score: makeScore({ composite: 0.91, bodyTfidf: 0.95, nameDesc: 0.88 }),
            verdict: { level: "block", reason: "duplicate" },
          },
        ],
        summary: { block: 1, warn: 0, info: 0 },
      }

      const text = formatReportText(report)
      expect(text).toContain("Skills: 3 | Blocks: 1 | Warnings: 0 | Info: 0")
    })

    it("formatReportText includes level prefixes", () => {
      const report: SkillReport = {
        totalSkills: 4,
        findings: [
          {
            skillA: "a",
            skillB: "b",
            score: makeScore({ composite: 0.93, bodyTfidf: 0.95, nameDesc: 0.88 }),
            verdict: { level: "block", reason: "duplicate" },
          },
          {
            skillA: "a",
            skillB: "c",
            score: makeScore({ composite: 0.8, bodyTfidf: 0.82, nameDesc: 0.74 }),
            verdict: { level: "warn", reason: "near duplicate" },
          },
          {
            skillA: "b",
            skillB: "c",
            score: makeScore({ composite: 0.7, bodyTfidf: 0.71, nameDesc: 0.68 }),
            verdict: { level: "info", reason: "related" },
          },
        ],
        summary: { block: 1, warn: 1, info: 1 },
      }

      const text = formatReportText(report)
      expect(text).toContain("[BLOCK]")
      expect(text).toContain("[WARN]")
      expect(text).toContain("[INFO]")
    })

    it("formatReportJson returns parseable SkillReport JSON", () => {
      const report: SkillReport = {
        totalSkills: 2,
        findings: [
          {
            skillA: "a",
            skillB: "b",
            score: makeScore({ composite: 0.91, bodyTfidf: 0.95, nameDesc: 0.88 }),
            verdict: { level: "block", reason: "duplicate" },
          },
        ],
        summary: { block: 1, warn: 0, info: 0 },
      }

      const json = formatReportJson(report)
      const parsed = JSON.parse(json) as typeof report

      expect(parsed.totalSkills).toBe(report.totalSkills)
      expect(parsed.summary.block).toBe(1)
      expect(parsed.findings).toHaveLength(1)
      expect(parsed.findings[0]?.verdict.level).toBe("block")
    })
  })
})
