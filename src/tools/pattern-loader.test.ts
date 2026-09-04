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
category: vulnerability-pattern
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

  it("ignores protocol guidance rules even when they declare a pattern category", () => {
    writeSkill(
      "protocol-patterns/staking",
      `---
name: staking
description: Protocol guidance must remain advisory
category: protocol-pattern
pattern_category: logic-error
detection_rules:
  - regex: 'notifyRewardAmount\\s*\\('
    severity: High
    description: Advisory protocol knowledge
---

# Staking`,
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
category: vulnerability-pattern
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
category: vulnerability-pattern
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
category: vulnerability-pattern
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
category: vulnerability-pattern
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
category: vulnerability-pattern
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
category: vulnerability-pattern
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
category: vulnerability-pattern
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
        pattern_category: "logic-error",
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
            regex: "^(?:.*){0,1}.*owner$",
            severity: "High",
            description: "optional grouped repeated wildcard seam",
          },
          {
            regex: "^(?:.*)??.*owner$",
            severity: "High",
            description: "lazy optional grouped repeated wildcard seam",
          },
          {
            regex: "^(?:.+)??.+owner$",
            severity: "High",
            description: "lazy optional grouped repeated plus seam",
          },
          {
            regex: "^(?<name>.*)??.*owner$",
            severity: "High",
            description: "named lazy optional grouped repeated wildcard seam",
          },
          {
            regex: "^(?:(?:.*))??.*owner$",
            severity: "High",
            description: "nested lazy optional grouped repeated wildcard seam",
          },
          {
            regex: "^(?:.*)??(?:.*)??owner$",
            severity: "High",
            description: "double lazy optional grouped repeated wildcard seam",
          },
          {
            regex: String.raw`^.*[\s\S]*owner$`,
            severity: "High",
            description: "overlapping dot and any-character class",
          },
          {
            regex: String.raw`^[\s\S]*.*owner$`,
            severity: "High",
            description: "overlapping any-character class and dot",
          },
          {
            regex: String.raw`^[\w]*\w*owner$`,
            severity: "High",
            description: "textually different equivalent word atoms",
          },
          {
            regex: "^.*[^x]*owner$",
            severity: "High",
            description: "overlapping dot and negated class",
          },
          {
            regex: String.raw`^(?:.*)?[\s\S]*owner$`,
            severity: "High",
            description: "optional transparent group before overlapping any-character class",
          },
          {
            regex: String.raw`^.*?[\s\S]*?owner$`,
            severity: "High",
            description: "lazy overlapping any-character atoms",
          },
          {
            regex: String.raw`^(?s:.*){1}[\s\S]*owner$`,
            severity: "High",
            description: "scoped modifier grouped repeated wildcard seam",
          },
          {
            regex: String.raw`^(?s:.*)?[\s\S]*owner$`,
            severity: "High",
            description: "optional scoped modifier grouped repeated wildcard seam",
          },
          {
            regex: String.raw`^\x61*a*$`,
            severity: "High",
            description: "hex escaped literal adjacent to literal",
          },
          {
            regex: String.raw`^[\x61]*a*$`,
            severity: "High",
            description: "hex escaped character class adjacent to literal",
          },
          {
            regex: String.raw`^[\141]*a*$`,
            severity: "High",
            description: "octal escaped character class adjacent to literal",
          },
          {
            regex: String.raw`^[\u0100]*Ā*$`,
            severity: "High",
            description: "unicode escaped character class adjacent to non-ASCII literal",
          },
          {
            regex: String.raw`^[\u0100]*\u0100*$`,
            severity: "High",
            description:
              "unicode escaped character class adjacent to equivalent unicode escaped literal",
          },
          {
            regex: "^a*a?a*b$",
            severity: "High",
            description: "optional separator between overlapping quantified literals",
          },
          {
            regex: "^.*a?.*owner$",
            severity: "High",
            description: "optional separator between overlapping wildcards",
          },
          {
            regex: "^.*a.*owner$",
            severity: "High",
            description: "consumable separator between overlapping wildcards",
          },
          {
            regex: "^.*(?:a){1}.*owner$",
            severity: "High",
            description: "exact-one group separator between overlapping wildcards",
          },
          {
            regex: "^a{0,1000}a{0,1000}$",
            severity: "High",
            description: "bounded variable repeats over the same atom",
          },
          {
            regex: "^.*(?:a)?.*owner$",
            severity: "High",
            description: "optional transparent group separator between overlapping wildcards",
          },
          {
            regex: "^.*(?:a|b).*owner$",
            severity: "High",
            description: "alternation group separator between overlapping wildcards",
          },
          {
            regex: String.raw`^a*\Ba*\Ba*\Ba*\Ba*b$`,
            severity: "High",
            description: "word-boundary assertions between overlapping quantified literals",
          },
          {
            regex: String.raw`^[\b]*\x08*b$`,
            severity: "High",
            description: "backspace escape in character class adjacent to equivalent hex literal",
          },
          {
            regex: String.raw`^[\cA-\cZ]*[\x01-\x1a]*b$`,
            severity: "High",
            description: "legacy control escape range adjacent to equivalent hex range",
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
          {
            regex: "^a?a?$",
            severity: "Low",
            description: "different optional literals stay allowed",
          },
          {
            regex: String.raw`^\d*[a-z]*$`,
            severity: "Low",
            description: "disjoint adjacent quantified atoms stay allowed",
          },
        ],
        filePath: "/custom/bypass-unsafe/SKILL.md",
        source: "custom",
        content: "# Bypass Unsafe",
      },
    ])

    expect(patterns.map((pattern) => pattern.name)).toEqual([
      "bypass-unsafe-rule-47",
      "bypass-unsafe-rule-48",
      "bypass-unsafe-rule-49",
      "bypass-unsafe-rule-50",
    ])
    expect(errors).toHaveLength(46)
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
    expect(errors[17]).toContain("adjacent ambiguous quantifiers")
    expect(errors[18]).toContain("adjacent ambiguous quantifiers")
    expect(errors[19]).toContain("adjacent ambiguous quantifiers")
    expect(errors[20]).toContain("adjacent ambiguous quantifiers")
    expect(errors[21]).toContain("adjacent ambiguous quantifiers")
    expect(errors[22]).toContain("adjacent ambiguous quantifiers")
    expect(errors[23]).toContain("adjacent ambiguous quantifiers")
    expect(errors[24]).toContain("adjacent ambiguous quantifiers")
    expect(errors[25]).toContain("adjacent ambiguous quantifiers")
    expect(errors[26]).toContain("adjacent ambiguous quantifiers")
    expect(errors[27]).toContain("adjacent ambiguous quantifiers")
    expect(errors[28]).toContain("adjacent ambiguous quantifiers")
    expect(errors[29]).toContain("unsupported group syntax")
    expect(errors[30]).toContain("unsupported group syntax")
    expect(errors[31]).toContain("adjacent ambiguous quantifiers")
    expect(errors[32]).toContain("adjacent ambiguous quantifiers")
    expect(errors[33]).toContain("adjacent ambiguous quantifiers")
    expect(errors[34]).toContain("adjacent ambiguous quantifiers")
    expect(errors[35]).toContain("adjacent ambiguous quantifiers")
    expect(errors[36]).toContain("adjacent ambiguous quantifiers")
    expect(errors[37]).toContain("adjacent ambiguous quantifiers")
    expect(errors[38]).toContain("adjacent ambiguous quantifiers")
    expect(errors[39]).toContain("adjacent ambiguous quantifiers")
    expect(errors[40]).toContain("adjacent ambiguous quantifiers")
    expect(errors[41]).toContain("adjacent ambiguous quantifiers")
    expect(errors[42]).toContain("adjacent ambiguous quantifiers")
    expect(errors[43]).toContain("adjacent ambiguous quantifiers")
    expect(errors[44]).toContain("adjacent ambiguous quantifiers")
    expect(errors[45]).toContain("legacy control escapes")
  })

  it("validates deeply nested safe groups without exponential recursion", () => {
    const nested = `${"(".repeat(24)}a${")".repeat(24)}`
    const start = performance.now()
    const { patterns, errors } = extractDetectionRulesFromResolvedSkills([
      {
        name: "deep-safe-groups",
        description: "Deep but safe grouping",
        category: "vulnerability-pattern",
        pattern_category: "logic-error",
        detection_rules: [
          {
            regex: nested,
            severity: "Low",
            description: "nested safe groups",
          },
        ],
        filePath: "/custom/deep-safe-groups/SKILL.md",
        source: "custom",
        content: "# Deep Safe Groups",
      },
    ])
    const elapsed = performance.now() - start

    expect(patterns).toHaveLength(1)
    expect(errors).toEqual([])
    expect(elapsed).toBeLessThan(250)
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
    const { patterns: rules, errors } = extractDetectionRulesFromSkills(PRODUCTION_SKILLS_DIR)
    expect(errors).toEqual([])
    for (const rule of rules) {
      expect(() => new RegExp(rule.regex)).not.toThrow()
    }
  })

  it("keeps truthful exclusion filters on broad production heuristics", () => {
    const { patterns: rules } = extractDetectionRulesFromSkills(PRODUCTION_SKILLS_DIR)
    const byName = new Map(rules.map((rule) => [rule.name, rule]))

    expect(byName.get("cross-chain-bridge-vulnerabilities-rule-1")?.exclude_if).toEqual([
      String.raw`\b(block\.chainid|chainId)\b`,
    ])
    expect(byName.get("cross-chain-bridge-vulnerabilities-rule-2")?.exclude_if).toEqual([
      String.raw`\b(block\.chainid|chainId)\b`,
    ])
    expect(byName.get("governance-attacks-rule-1")?.exclude_if).toEqual([
      String.raw`\b(timelock|onlyTimelock|delay|eta)\b`,
    ])
    expect(byName.get("governance-attacks-rule-3")?.exclude_if).toEqual([
      "(snapshot|Checkpoint|getPastVotes|getPastTotalSupply|blockNumber)",
    ])
    expect(byName.get("governance-attacks-rule-4")?.exclude_if).toEqual([
      "(require|_msgSender|proposalThreshold|getVotes|onlyRole)",
    ])
    expect(byName.get("governance-attacks-rule-5")?.exclude_if).toEqual([
      String.raw`(_execute|state\s*==|ProposalState|hasVoted)`,
    ])
    expect(byName.get("flashloan-reorg-mev-rule-3")?.exclude_if).toEqual([
      String.raw`(observe\(|consult\(|twap|TWAP)`,
    ])
  })
})
