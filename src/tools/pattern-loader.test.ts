import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  extractDetectionRulesFromResolvedSkills,
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

# Reentrancy`,
    )

    const { patterns: rules } = extractDetectionRulesFromSkills(TEST_SKILLS_DIR)
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

# Reentrancy`,
    )

    const { patterns } = extractDetectionRulesFromSkills(TEST_SKILLS_DIR)
    expect(patterns).toEqual([])
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

# Some Skill`,
    )

    const { patterns } = extractDetectionRulesFromSkills(TEST_SKILLS_DIR)
    expect(patterns).toEqual([])
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

# DoS`,
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

# Signatures`,
    )

    const { patterns: rules } = extractDetectionRulesFromSkills(TEST_SKILLS_DIR)
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

# Multi`,
    )

    const { patterns: rules } = extractDetectionRulesFromSkills(TEST_SKILLS_DIR)
    expect(rules).toHaveLength(2)
    expect(rules[0]?.name).toBe("multi-rule-rule-1")
    expect(rules[0]?.category).toBe("access-control")
    expect(rules[1]?.name).toBe("multi-rule-rule-2")
    expect(rules[1]?.category).toBe("access-control")
  })

  it("skips unsafe detection regexes", () => {
    writeSkill(
      "vulnerability-patterns/unsafe-regex",
      `---
name: unsafe-regex
description: Unsafe regex
pattern_category: logic-error
detection_rules:
  - regex: '(a+)+$'
    severity: High
    description: catastrophic backtracking
  - regex: 'safeCall\\('
    severity: Medium
    description: safe rule still loads
---

# Unsafe Regex`,
    )

    const { patterns, errors } = extractDetectionRulesFromSkills(TEST_SKILLS_DIR)
    expect(patterns).toHaveLength(1)
    expect(patterns[0]?.name).toBe("unsafe-regex-rule-2")
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain("Skipped unsafe detection rule unsafe-regex-rule-1")
  })

  it("skips lookaround and nested group ReDoS bypasses", () => {
    writeSkill(
      "vulnerability-patterns/lookaround-redos",
      `---
name: lookaround-redos
description: Lookaround ReDoS bypasses
pattern_category: logic-error
detection_rules:
  - regex: '(?=((a*)*)b)a'
    severity: High
    description: nested repeated groups inside lookahead
  - regex: '(?=(a+)+b)a'
    severity: High
    description: nested unbounded group inside lookahead
  - regex: '(outer(a*)*)b'
    severity: High
    description: nested repeated group inside unquantified outer group
  - regex: 'safeCall\\('
    severity: Medium
    description: safe rule still loads
---

# Lookaround ReDoS`,
    )

    const { patterns, errors } = extractDetectionRulesFromSkills(TEST_SKILLS_DIR)
    expect(patterns).toHaveLength(1)
    expect(patterns[0]?.name).toBe("lookaround-redos-rule-4")
    expect(errors).toHaveLength(3)
    expect(errors[0]).toContain("lookaround assertions")
    expect(errors[1]).toContain("lookaround assertions")
    expect(errors[2]).toContain("nested or ambiguous repeated groups")
  })

  it("skips detection regexes that do not compile", () => {
    writeSkill(
      "vulnerability-patterns/bad-regex",
      `---
name: bad-regex
description: Bad regex
pattern_category: logic-error
detection_rules:
  - regex: '['
    severity: High
    description: bad regex
---

# Bad Regex`,
    )

    const { patterns, errors } = extractDetectionRulesFromSkills(TEST_SKILLS_DIR)
    expect(patterns).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain("regex does not compile")
  })

  it("preserves safe exclude_if rules and rejects unsafe exclude_if regexes", () => {
    writeSkill(
      "vulnerability-patterns/exclude-if",
      `---
name: exclude-if
description: Exclusion filters
pattern_category: logic-error
detection_rules:
  - regex: 'dangerCall'
    severity: Medium
    description: safe exclusion
    exclude_if:
      - 'safeGuard'
  - regex: 'otherDanger'
    severity: Medium
    description: unsafe exclusion
    exclude_if:
      - '(a|aa){1,100000}$'
  - regex: 'lookaroundDanger'
    severity: Medium
    description: lookaround exclusion
    exclude_if:
      - '(?=((a*)*)b)a'
---

# Exclude If`,
    )

    const { patterns, errors } = extractDetectionRulesFromSkills(TEST_SKILLS_DIR)
    expect(patterns).toHaveLength(1)
    expect(patterns[0]?.exclude_if).toEqual(["safeGuard"])
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain("exclude_if nested or ambiguous repeated groups")
    expect(errors[1]).toContain("exclude_if lookaround assertions")
  })
})

describe("extractDetectionRulesFromResolvedSkills", () => {
  it("extracts rules from effective resolver winners only", () => {
    const { patterns } = extractDetectionRulesFromResolvedSkills([
      {
        name: "custom-reentrancy",
        description: "Custom rule",
        category: "vulnerability-pattern",
        pattern_category: "reentrancy",
        detection_rules: [
          {
            regex: "dangerCall",
            severity: "High",
            confidence: "High",
            description: "custom danger",
          },
        ],
        filePath: "/custom/custom-reentrancy/SKILL.md",
        source: "custom",
        content: "# Custom",
      },
      {
        name: "advisory-only",
        description: "Rules without pattern category are advisory only",
        category: "protocol-pattern",
        detection_rules: [
          {
            regex: "advisoryOnly",
            severity: "Medium",
            description: "must not scan",
          },
        ],
        filePath: "/custom/advisory-only/SKILL.md",
        source: "custom",
        content: "# Advisory",
      },
    ])

    expect(patterns).toHaveLength(1)
    expect(patterns[0]?.name).toBe("custom-reentrancy-rule-1")
    expect(patterns[0]?.category).toBe("reentrancy")
    expect(patterns[0]?.regex).toBe("dangerCall")
  })

  it("returns errors and skips unsafe resolver skill rules", () => {
    const { patterns, errors } = extractDetectionRulesFromResolvedSkills([
      {
        name: "custom-unsafe",
        description: "Custom unsafe rule",
        category: "vulnerability-pattern",
        pattern_category: "logic-error",
        detection_rules: [
          {
            regex: "(a|aa)+$",
            severity: "High",
            confidence: "High",
            description: "ambiguous repeated group",
          },
          {
            regex: "(a|aa){1,}$",
            severity: "High",
            confidence: "High",
            description: "ambiguous counted repeated group",
          },
          {
            regex: "(a|aa){1,100000}$",
            severity: "High",
            confidence: "High",
            description: "ambiguous bounded repeated group",
          },
          {
            regex: "(a+){1,100000}$",
            severity: "High",
            confidence: "High",
            description: "nested bounded repeated group",
          },
        ],
        filePath: "/custom/custom-unsafe/SKILL.md",
        source: "custom",
        content: "# Custom Unsafe",
      },
    ])

    expect(patterns).toEqual([])
    expect(errors).toHaveLength(4)
    expect(errors[0]).toContain("custom-unsafe-rule-1")
    expect(errors[1]).toContain("custom-unsafe-rule-2")
    expect(errors[2]).toContain("custom-unsafe-rule-3")
    expect(errors[3]).toContain("custom-unsafe-rule-4")
  })

  it("rejects backreference and adjacent quantifier bypasses", () => {
    const { patterns, errors } = extractDetectionRulesFromResolvedSkills([
      {
        name: "bypass-unsafe",
        description: "Unsafe bypass rules",
        category: "vulnerability-pattern",
        pattern_category: "logic-error",
        detection_rules: [
          {
            regex: String.raw`(a)\1`,
            severity: "High",
            description: "numeric backreference",
          },
          {
            regex: String.raw`(a)\\\1`,
            severity: "High",
            description: "numeric backreference after literal backslash",
          },
          {
            regex: String.raw`(?<word>a)\k<word>`,
            severity: "High",
            description: "named backreference",
          },
          {
            regex: "^a*a*a*a*a*b$",
            severity: "High",
            description: "adjacent ambiguous quantified literals",
          },
          {
            regex: "^.*.*owner$",
            severity: "High",
            description: "adjacent repeated wildcards",
          },
          {
            regex: "^.*(?:.*)(?:.*)(?:.*)(?:.*)owner$",
            severity: "High",
            description: "wrapped adjacent repeated wildcards",
          },
          {
            regex: "^(?:.*.*)owner$",
            severity: "High",
            description: "grouped adjacent repeated wildcards",
          },
          {
            regex: "^(?:.*){1}.*owner$",
            severity: "High",
            description: "exact-one wrapped repeated wildcard",
          },
          {
            regex: "^(?:.*){1,1}.*owner$",
            severity: "High",
            description: "bounded exact-one wrapped repeated wildcard",
          },
          {
            regex: "^(?:.*){01}.*owner$",
            severity: "High",
            description: "zero-padded exact-one wrapped repeated wildcard",
          },
          {
            regex: "^(?<name>.*.*)owner$",
            severity: "High",
            description: "named grouped adjacent repeated wildcards",
          },
          {
            regex: "^(?<name>.*){1}.*owner$",
            severity: "High",
            description: "named exact-one wrapped repeated wildcard",
          },
          {
            regex: "^(?:a.*){1}.*owner$",
            severity: "High",
            description: "prefixed exact-one grouped repeated wildcard seam",
          },
          {
            regex: "^(?:a.*).*owner$",
            severity: "High",
            description: "prefixed grouped repeated wildcard seam",
          },
          {
            regex: "^.*(?:.*a)owner$",
            severity: "High",
            description: "suffixed grouped repeated wildcard seam",
          },
          {
            regex: "^(?:x(?:a.*)).*owner$",
            severity: "High",
            description: "nested prefixed grouped repeated wildcard seam",
          },
          {
            regex: "^.*(?:.*a){1}owner$",
            severity: "High",
            description: "exact-one suffixed grouped repeated wildcard seam",
          },
          {
            regex: "^a*b*$",
            severity: "Low",
            description: "different adjacent quantified literals stay allowed",
          },
          {
            regex: String.raw`owner\(`,
            severity: "Low",
            description: "safe literal rule still loads",
          },
        ],
        filePath: "/custom/bypass-unsafe/SKILL.md",
        source: "custom",
        content: "# Bypass Unsafe",
      },
    ])

    expect(patterns.map((pattern) => pattern.name)).toEqual([
      "bypass-unsafe-rule-18",
      "bypass-unsafe-rule-19",
    ])
    expect(errors).toHaveLength(17)
    expect(errors[0]).toContain("backreferences")
    expect(errors[1]).toContain("backreferences")
    expect(errors[2]).toContain("backreferences")
    expect(errors[3]).toContain("adjacent ambiguous quantifiers")
    expect(errors[4]).toContain("adjacent ambiguous quantifiers")
    expect(errors[5]).toContain("adjacent ambiguous quantifiers")
    expect(errors[6]).toContain("adjacent ambiguous quantifiers")
    expect(errors[7]).toContain("adjacent ambiguous quantifiers")
    expect(errors[8]).toContain("adjacent ambiguous quantifiers")
    expect(errors[9]).toContain("adjacent ambiguous quantifiers")
    expect(errors[10]).toContain("adjacent ambiguous quantifiers")
    expect(errors[11]).toContain("adjacent ambiguous quantifiers")
    expect(errors[12]).toContain("adjacent ambiguous quantifiers")
    expect(errors[13]).toContain("adjacent ambiguous quantifiers")
    expect(errors[14]).toContain("adjacent ambiguous quantifiers")
    expect(errors[15]).toContain("adjacent ambiguous quantifiers")
    expect(errors[16]).toContain("adjacent ambiguous quantifiers")
  })
})

describe("error reporting", () => {
  it("returns parse errors in the errors array when SKILL.md has malformed frontmatter", () => {
    writeSkill(
      "vulnerability-patterns/bad-skill",
      `---
name: bad-skill
detection_rules:
  - regex: [unclosed bracket
    severity: High
    description: bad
---

# Bad Skill`,
    )

    const { patterns, errors } = extractDetectionRulesFromSkills(TEST_SKILLS_DIR)
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors[0]).toContain("bad-skill")
    expect(patterns).toEqual([])
  })
})

describe("production skill detection rules (skills/vulnerability-patterns/)", () => {
  const PRODUCTION_SKILLS_DIR = resolve(import.meta.dir, "../../skills")

  it("extracts detection rules from all skills with pattern_category", () => {
    const { patterns: rules } = extractDetectionRulesFromSkills(PRODUCTION_SKILLS_DIR)
    expect(rules.length).toBeGreaterThanOrEqual(46)
  })

  it("covers at least 9 distinct pattern categories from skills", () => {
    const { patterns: rules } = extractDetectionRulesFromSkills(PRODUCTION_SKILLS_DIR)
    const categories = new Set(rules.map((r) => r.category))
    expect(categories.size).toBeGreaterThanOrEqual(9)
  })

  it("all extracted rules have valid regex", () => {
    const { patterns: rules } = extractDetectionRulesFromSkills(PRODUCTION_SKILLS_DIR)
    for (const rule of rules) {
      expect(() => new RegExp(rule.regex)).not.toThrow()
    }
  })
})
