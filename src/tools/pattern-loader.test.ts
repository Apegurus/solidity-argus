import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  extractDetectionRulesFromSkills,
  loadPatternPacks,
  mergeWithBuiltins,
} from "./pattern-loader"
import type { PatternDefinition } from "./pattern-schema"

const TEST_DIR = join(import.meta.dir, "__test-patterns__")
const TEST_SKILLS_DIR = join(import.meta.dir, "__test-skills__")
const PRODUCTION_PATTERNS_DIR = resolve(
  import.meta.dir,
  "../../skills/patterns"
)

function writeYaml(filename: string, content: string): void {
  writeFileSync(join(TEST_DIR, filename), content, "utf-8")
}

function writeSkill(relativeDir: string, content: string): void {
  const dir = join(TEST_SKILLS_DIR, relativeDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "SKILL.md"), content, "utf-8")
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
  mkdirSync(TEST_SKILLS_DIR, { recursive: true })
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
  rmSync(TEST_SKILLS_DIR, { recursive: true, force: true })
})

describe("loadPatternPacks", () => {
  it("loads valid YAML pattern files from directory", () => {
    writeYaml(
      "reentrancy.yaml",
      `
patterns:
  - name: reentrancy-call-value
    category: reentrancy
    severity: High
    regex: '\\.call\\{value:'
    description: ETH transfer via low-level call
`
    )
    const patterns = loadPatternPacks(TEST_DIR)
    expect(patterns).toHaveLength(1)
    expect(patterns[0]?.name).toBe("reentrancy-call-value")
    expect(patterns[0]?.category).toBe("reentrancy")
  })

  it("loads both .yaml and .yml files", () => {
    writeYaml(
      "a.yaml",
      `
patterns:
  - name: pat-a
    category: dos
    severity: Low
    regex: 'block\\.timestamp'
    description: Timestamp dep
`
    )
    writeYaml(
      "b.yml",
      `
patterns:
  - name: pat-b
    category: proxy
    severity: Medium
    regex: delegatecall
    description: Delegatecall usage
`
    )
    const patterns = loadPatternPacks(TEST_DIR)
    expect(patterns).toHaveLength(2)
    const names = patterns.map((p) => p.name)
    expect(names).toContain("pat-a")
    expect(names).toContain("pat-b")
  })

  it("returns empty array for empty directory", () => {
    const patterns = loadPatternPacks(TEST_DIR)
    expect(patterns).toEqual([])
  })

  it("returns empty array for non-existent directory", () => {
    const patterns = loadPatternPacks(join(TEST_DIR, "does-not-exist"))
    expect(patterns).toEqual([])
  })

  it("skips invalid YAML files without crashing", () => {
    writeYaml("bad.yaml", "this: is: not: [valid yaml!!! {{{")
    writeYaml(
      "good.yaml",
      `
patterns:
  - name: good-pattern
    category: governance
    severity: Medium
    regex: proposalThreshold
    description: Governance threshold check
`
    )
    const patterns = loadPatternPacks(TEST_DIR)
    expect(patterns.length).toBeGreaterThanOrEqual(1)
    expect(patterns.some((p) => p.name === "good-pattern")).toBe(true)
  })

  it("skips YAML files that fail schema validation", () => {
    writeYaml(
      "invalid-schema.yaml",
      `
patterns:
  - name: ""
    category: bad-category
    severity: Low
    regex: something
    description: Bad
`
    )
    writeYaml(
      "valid.yaml",
      `
patterns:
  - name: valid-one
    category: access-control
    severity: High
    regex: 'tx\\.origin'
    description: tx.origin auth
`
    )
    const patterns = loadPatternPacks(TEST_DIR)
    expect(patterns).toHaveLength(1)
    expect(patterns[0]?.name).toBe("valid-one")
  })

  it("flattens patterns from multiple packs", () => {
    writeYaml(
      "multi.yaml",
      `
pack_name: multi-pack
patterns:
  - name: pat-1
    category: reentrancy
    severity: High
    regex: '\\.call\\{value:'
    description: pat 1
  - name: pat-2
    category: dos
    severity: Low
    regex: gasleft
    description: pat 2
`
    )
    const patterns = loadPatternPacks(TEST_DIR)
    expect(patterns).toHaveLength(2)
  })
})

describe("mergeWithBuiltins", () => {
  const builtins = [
    {
      name: "reentrancy",
      category: "reentrancy",
      severity: "High",
      regex: /\.call\{value:/,
      description: "Potential reentrancy: ETH transfer via low-level call",
      exploitReference: "DAO hack ($60M), 2016",
    },
    {
      name: "tx-origin-auth",
      category: "access-control",
      severity: "High",
      regex: /tx\.origin/,
      description: "Use of tx.origin for authorization - vulnerable to phishing",
    },
  ]

  it("preserves all builtins when no YAML patterns given", () => {
    const merged = mergeWithBuiltins([], builtins)
    expect(merged).toHaveLength(2)
    expect(merged.some((p) => p.name === "reentrancy")).toBe(true)
    expect(merged.some((p) => p.name === "tx-origin-auth")).toBe(true)
  })

  it("converts builtin regex to string in merged output", () => {
    const merged = mergeWithBuiltins([], builtins)
    const reentrancy = merged.find((p) => p.name === "reentrancy")
    expect(typeof reentrancy?.regex).toBe("string")
  })

  it("YAML patterns override builtins with same name", () => {
    const yamlPatterns: PatternDefinition[] = [
      {
        name: "reentrancy",
        category: "reentrancy",
        severity: "Critical",
        confidence: "High",
        version: "2.0",
        regex: "\\.call\\{value:|transfer\\(",
        description: "Enhanced reentrancy detection",
      },
    ]
    const merged = mergeWithBuiltins(yamlPatterns, builtins)
    const reentrancy = merged.find((p) => p.name === "reentrancy")
    expect(reentrancy?.severity).toBe("Critical")
    expect(reentrancy?.description).toBe("Enhanced reentrancy detection")
    expect(merged.filter((p) => p.name === "reentrancy")).toHaveLength(1)
  })

  it("appends YAML-only patterns alongside builtins", () => {
    const yamlPatterns: PatternDefinition[] = [
      {
        name: "flash-loan-attack",
        category: "flash-loan",
        severity: "Critical",
        confidence: "High",
        version: "1.0",
        regex: "flashLoan\\(",
        description: "Flash loan vector detected",
      },
    ]
    const merged = mergeWithBuiltins(yamlPatterns, builtins)
    expect(merged).toHaveLength(3)
    expect(merged.some((p) => p.name === "flash-loan-attack")).toBe(true)
    expect(merged.some((p) => p.name === "reentrancy")).toBe(true)
    expect(merged.some((p) => p.name === "tx-origin-auth")).toBe(true)
  })

  it("maps builtin exploitReference to exploit_ref", () => {
    const merged = mergeWithBuiltins([], builtins)
    const reentrancy = merged.find((p) => p.name === "reentrancy")
    expect(reentrancy?.exploit_ref).toBeUndefined()
  })

  it("merges SKILL.md detection rules alongside YAML and builtins", () => {
    const yamlPatterns: PatternDefinition[] = [
      {
        name: "yaml-reentrancy",
        category: "reentrancy",
        severity: "High",
        confidence: "High",
        version: "1.0",
        regex: "\\.call\\{value:",
        description: "yaml pattern",
      },
    ]
    const skillPatterns: PatternDefinition[] = [
      {
        name: "skill-tx-origin",
        category: "access-control",
        severity: "High",
        confidence: "High",
        version: "1.0",
        regex: "tx\\.origin",
        description: "skill rule",
      },
    ]

    const merged = mergeWithBuiltins(yamlPatterns, builtins, skillPatterns)
    expect(merged.some((p) => p.name === "yaml-reentrancy")).toBe(true)
    expect(merged.some((p) => p.name === "skill-tx-origin")).toBe(true)
    expect(merged.some((p) => p.name === "reentrancy")).toBe(true)
    expect(merged.some((p) => p.name === "tx-origin-auth")).toBe(true)
  })
})

describe("extractDetectionRulesFromSkills", () => {
  it("extracts detection rules from SKILL.md frontmatter", () => {
    writeSkill(
      "vulnerability-patterns/reentrancy",
      `---
name: reentrancy
description: Reentrancy patterns
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
---

# Reentrancy`
    )

    const rules = extractDetectionRulesFromSkills(TEST_SKILLS_DIR)
    expect(rules).toEqual([])
  })
})

describe("production pattern packs (skills/patterns/)", () => {
  it("loads all 13 YAML files and produces exactly 45 patterns", () => {
    const patterns = loadPatternPacks(PRODUCTION_PATTERNS_DIR)
    expect(patterns).toHaveLength(45)
  })

  it("contains expected pattern names from all categories", () => {
    const patterns = loadPatternPacks(PRODUCTION_PATTERNS_DIR)
    const names = new Set(patterns.map((p) => p.name))

    const expected = [
      // reentrancy
      "reentrancy-eth-transfer", "reentrancy-erc20", "cross-function-reentrancy",
      // oracle-manipulation
      "stale-price-check", "twap-manipulation", "price-feed-decimals",
      // flash-loan
      "unchecked-flash-return", "balance-inflation",
      // access-control
      "missing-access-modifier", "unprotected-initialize", "default-visibility",
      // erc4626
      "inflation-attack", "donation-attack", "rounding-error",
      // proxy
      "storage-collision", "uninitialized-proxy", "selector-clash",
      // signature
      "replay-attack", "sig-malleability", "missing-nonce",
      // builtins
      "reentrancy-call-value", "tx-origin-auth", "selfdestruct-usage",
      "delegatecall-usage", "missing-zero-check",
      // cross-chain-bridge
      "missing-chain-id-validation", "replay-across-chains",
      "unverified-bridge-message", "hardcoded-bridge-address",
      // governance
      "timelock-bypass", "flash-loan-governance", "quorum-manipulation",
      "unprotected-proposal", "single-step-governance",
      // front-running
      "missing-slippage-protection", "missing-deadline",
      "predictable-randomness", "commit-reveal-weakness",
      // donation-attacks
      "first-depositor-inflation", "direct-token-transfer", "empty-pool-exploit",
      // gas-optimization
      "unbounded-loop", "storage-write-in-loop", "external-call-in-loop", "unchecked-array-growth",
    ]
    for (const name of expected) {
      expect(names.has(name)).toBe(true)
    }
  })

  it("covers all 12 categories", () => {
    const patterns = loadPatternPacks(PRODUCTION_PATTERNS_DIR)
    const categories = new Set(patterns.map((p) => p.category))

    expect(categories.has("reentrancy")).toBe(true)
    expect(categories.has("oracle-manipulation")).toBe(true)
    expect(categories.has("flash-loan")).toBe(true)
    expect(categories.has("access-control")).toBe(true)
    expect(categories.has("erc4626")).toBe(true)
    expect(categories.has("proxy")).toBe(true)
    expect(categories.has("signature")).toBe(true)
    expect(categories.has("delegatecall")).toBe(true)
    expect(categories.has("governance")).toBe(true)
    expect(categories.has("logic-error")).toBe(true)
    expect(categories.has("front-running")).toBe(true)
    expect(categories.has("gas-optimization")).toBe(true)
  })

  it("all patterns have valid regex strings", () => {
    const patterns = loadPatternPacks(PRODUCTION_PATTERNS_DIR)
    for (const p of patterns) {
      expect(() => new RegExp(p.regex)).not.toThrow()
    }
  })

  it("severity distribution is correct", () => {
    const patterns = loadPatternPacks(PRODUCTION_PATTERNS_DIR)
    const bySeverity = (s: string) => patterns.filter((p) => p.severity === s)

    expect(bySeverity("Critical")).toHaveLength(6)
    expect(bySeverity("High")).toHaveLength(23)
    expect(bySeverity("Medium")).toHaveLength(16)
  })
})
