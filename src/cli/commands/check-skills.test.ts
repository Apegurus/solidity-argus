import { describe, test, expect } from "bun:test"
import { runAnalysis, loadAndNormalizeSkills } from "./check-skills"
import { normalizeSkill, type SkillDoc } from "../../skills/analysis/normalize"
import { DEFAULT_GATE_CONFIG } from "../../skills/analysis/gates"

const SKILL_A = `---
name: reentrancy-basic
description: "Basic reentrancy detection"
category: vulnerability-pattern
detection_rules:
  - regex: '\\.call\\{value:'
    severity: High
---

# Reentrancy

Reentrancy occurs when an external call allows the callee to re-enter the calling function before the first execution completes.

## Detection
Check for state changes after external calls.
`

const SKILL_B = `---
name: oracle-manipulation
description: "Oracle price manipulation detection"
category: vulnerability-pattern
detection_rules:
  - regex: 'latestRoundData'
    severity: High
---

# Oracle Manipulation

Oracle manipulation attacks exploit price feed dependencies to manipulate protocol economics.

## Detection
Check for stale price data and TWAP usage.
`

const SKILL_A_NEAR_DUPLICATE = `---
name: reentrancy-advanced
description: "Advanced reentrancy detection patterns"
category: vulnerability-pattern
detection_rules:
  - regex: '\\.call\\{value:'
    severity: High
---

# Reentrancy

Reentrancy occurs when an external call allows the callee to re-enter the calling function before the first execution completes.

## Detection
Check for state changes after external calls. Advanced patterns include cross-function reentrancy.
`

describe("check-skills", () => {
  describe("runAnalysis", () => {
    test("analyzes distinct skills with no blocks", () => {
      const docA = normalizeSkill(SKILL_A)!
      const docB = normalizeSkill(SKILL_B)!
      expect(docA).not.toBeNull()
      expect(docB).not.toBeNull()

      const report = runAnalysis([docA, docB], DEFAULT_GATE_CONFIG)
      expect(report.totalSkills).toBe(2)
      expect(report.summary.block).toBe(0)
    })

    test("scores near-duplicate skills higher than distinct skills", () => {
      const docA = normalizeSkill(SKILL_A)!
      const docDup = normalizeSkill(SKILL_A_NEAR_DUPLICATE)!
      const docB = normalizeSkill(SKILL_B)!

      const dupReport = runAnalysis([docA, docDup], DEFAULT_GATE_CONFIG)
      const distinctReport = runAnalysis([docA, docB], DEFAULT_GATE_CONFIG)

      const dupScore = dupReport.findings[0]?.score.composite ?? 0
      const distinctScore = distinctReport.findings[0]?.score.composite ?? 0

      expect(dupScore).toBeGreaterThan(distinctScore)
    })

    test("detects exact regex conflicts", () => {
      const docA = normalizeSkill(SKILL_A)!
      const docDup = normalizeSkill(SKILL_A_NEAR_DUPLICATE)!

      const report = runAnalysis([docA, docDup], {
        ...DEFAULT_GATE_CONFIG,
        blockExactRegexConflict: true,
      })

      const blockFindings = report.findings.filter((f) => f.verdict.level === "block")
      expect(blockFindings.length).toBeGreaterThan(0)
    })

    test("returns empty report for single skill", () => {
      const docA = normalizeSkill(SKILL_A)!
      const report = runAnalysis([docA], DEFAULT_GATE_CONFIG)
      expect(report.totalSkills).toBe(1)
      expect(report.findings).toEqual([])
      expect(report.summary).toEqual({ block: 0, warn: 0, info: 0 })
    })

    test("returns empty report for empty array", () => {
      const report = runAnalysis([], DEFAULT_GATE_CONFIG)
      expect(report.totalSkills).toBe(0)
      expect(report.findings).toEqual([])
    })
  })

  describe("loadAndNormalizeSkills", () => {
    test("loads skills from project directory", () => {
      const docs = loadAndNormalizeSkills(process.cwd())
      expect(docs.length).toBeGreaterThan(50)
    })
  })
})
