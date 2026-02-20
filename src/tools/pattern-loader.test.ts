import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  extractDetectionRulesFromSkills,
} from "./pattern-loader"

const TEST_SKILLS_DIR = join(import.meta.dir, "__test-skills__")

function writeSkill(relativeDir: string, content: string): void {
  const dir = join(TEST_SKILLS_DIR, relativeDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "SKILL.md"), content, "utf-8")
}

beforeEach(() => {
  mkdirSync(TEST_SKILLS_DIR, { recursive: true })
})

afterEach(() => {
  rmSync(TEST_SKILLS_DIR, { recursive: true, force: true })
})

describe("extractDetectionRulesFromSkills", () => {
  it("extracts detection rules using pattern_category from frontmatter", () => {
    writeSkill(
      "vulnerability-patterns/reentrancy",
      `---
name: reentrancy
description: Reentrancy patterns
pattern_category: reentrancy
detection_rules:
  - regex: '\\.call\\{value:'
    severity: High
    confidence: High
    swc: SWC-107
    description: call value
---

# Reentrancy`
    )

    const rules = extractDetectionRulesFromSkills(TEST_SKILLS_DIR)
    expect(rules).toHaveLength(1)
    expect(rules[0]?.name).toBe("reentrancy-rule-1")
    expect(rules[0]?.category).toBe("reentrancy")
    expect(rules[0]?.regex).toBe("\\.call\\{value:")
    expect(rules[0]?.swc).toBe("SWC-107")
  })

  it("ignores skills without detection_rules", () => {
    writeSkill(
      "vulnerability-patterns/reentrancy",
      `---
name: reentrancy
description: Reentrancy patterns
pattern_category: reentrancy
---

# Reentrancy`
    )

    const rules = extractDetectionRulesFromSkills(TEST_SKILLS_DIR)
    expect(rules).toEqual([])
  })

  it("ignores skills without pattern_category even if they have detection_rules", () => {
    writeSkill(
      "vulnerability-patterns/some-skill",
      `---
name: some-skill
description: A skill without pattern_category
detection_rules:
  - regex: 'something'
    severity: Medium
    description: test
---

# Some Skill`
    )

    const rules = extractDetectionRulesFromSkills(TEST_SKILLS_DIR)
    expect(rules).toEqual([])
  })

  it("discovers skills dynamically from any pattern_category", () => {
    writeSkill(
      "vulnerability-patterns/my-dos-skill",
      `---
name: my-dos-skill
description: DoS pattern
pattern_category: dos
detection_rules:
  - regex: 'while\\s*\\(true\\)'
    severity: High
    description: Infinite loop
---

# DoS`
    )
    writeSkill(
      "vulnerability-patterns/my-sig-skill",
      `---
name: my-sig-skill
description: Signature pattern
pattern_category: signature
detection_rules:
  - regex: 'ecrecover'
    severity: Medium
    description: ecrecover usage
---

# Signatures`
    )

    const rules = extractDetectionRulesFromSkills(TEST_SKILLS_DIR)
    expect(rules).toHaveLength(2)

    const dosRule = rules.find((r) => r.category === "dos")
    expect(dosRule?.name).toBe("my-dos-skill-rule-1")
    expect(dosRule?.regex).toBe("while\\s*\\(true\\)")

    const sigRule = rules.find((r) => r.category === "signature")
    expect(sigRule?.name).toBe("my-sig-skill-rule-1")
    expect(sigRule?.regex).toBe("ecrecover")
  })

  it("extracts multiple rules from a single skill", () => {
    writeSkill(
      "vulnerability-patterns/multi-rule",
      `---
name: multi-rule
description: Multiple rules
pattern_category: access-control
detection_rules:
  - regex: 'onlyOwner'
    severity: High
    description: Owner check
  - regex: 'tx\\.origin'
    severity: High
    description: tx.origin auth
---

# Multi`
    )

    const rules = extractDetectionRulesFromSkills(TEST_SKILLS_DIR)
    expect(rules).toHaveLength(2)
    expect(rules[0]?.name).toBe("multi-rule-rule-1")
    expect(rules[0]?.category).toBe("access-control")
    expect(rules[1]?.name).toBe("multi-rule-rule-2")
    expect(rules[1]?.category).toBe("access-control")
  })
})

describe("production skill detection rules (skills/vulnerability-patterns/)", () => {
  const PRODUCTION_SKILLS_DIR = resolve(import.meta.dir, "../../skills")

  it("extracts detection rules from all skills with pattern_category", () => {
    const rules = extractDetectionRulesFromSkills(PRODUCTION_SKILLS_DIR)
    expect(rules.length).toBeGreaterThanOrEqual(46)
  })

  it("covers at least 9 distinct pattern categories from skills", () => {
    const rules = extractDetectionRulesFromSkills(PRODUCTION_SKILLS_DIR)
    const categories = new Set(rules.map((r) => r.category))
    expect(categories.size).toBeGreaterThanOrEqual(9)
  })

  it("all extracted rules have valid regex", () => {
    const rules = extractDetectionRulesFromSkills(PRODUCTION_SKILLS_DIR)
    for (const rule of rules) {
      expect(() => new RegExp(rule.regex)).not.toThrow()
    }
  })
})


