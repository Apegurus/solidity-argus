import { describe, expect, it } from "bun:test"
import {
  DetectionRuleSchema,
  type SkillFrontmatter,
  SkillFrontmatterSchema,
  parseFrontmatter,
  validateSkillFrontmatter,
} from "./skill-schema"

describe("skill-schema", () => {
  describe("validateSkillFrontmatter", () => {
    it("validates a valid skill with name and description", () => {
      const result = validateSkillFrontmatter({
        name: "reentrancy",
        description: "Reentrancy attack patterns and defensive coding checks",
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe("reentrancy")
        expect(result.data.description).toBe("Reentrancy attack patterns and defensive coding checks")
      }
    })

    it("passes with name only — description defaults to empty string", () => {
      const result = validateSkillFrontmatter({ name: "oracle-manipulation" })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.description).toBe("")
      }
    })

    it("fails when name is empty string", () => {
      const result = validateSkillFrontmatter({ name: "" })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0)
      }
    })

    it("fails when name exceeds 128 characters", () => {
      const result = validateSkillFrontmatter({ name: "a".repeat(129) })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.some((e) => e.includes("name"))).toBe(true)
      }
    })

    it("passes with valid category enum value", () => {
      const result = validateSkillFrontmatter({
        name: "amm-dex",
        category: "vulnerability-pattern",
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("vulnerability-pattern")
      }
    })

    it("fails with invalid category string", () => {
      const result = validateSkillFrontmatter({
        name: "some-skill",
        category: "not-a-real-category",
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.some((e) => e.includes("category"))).toBe(true)
      }
    })

    it("passes with deprecated: true and replacement field", () => {
      const result = validateSkillFrontmatter({
        name: "old-skill",
        deprecated: true,
        replacement: "new-skill",
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.deprecated).toBe(true)
        expect(result.data.replacement).toBe("new-skill")
      }
    })

    it("returns validation error for completely missing frontmatter (not crash)", () => {
      const result = validateSkillFrontmatter({})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors).toBeInstanceOf(Array)
        expect(result.errors.length).toBeGreaterThan(0)
      }
    })

    it("passes with valid semver version string", () => {
      const result = validateSkillFrontmatter({
        name: "reentrancy",
        version: "1.2.3",
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.version).toBe("1.2.3")
      }
    })

    it("fails when name contains uppercase or spaces", () => {
      const upper = validateSkillFrontmatter({ name: "Reentrancy" })
      expect(upper.success).toBe(false)

      const spaces = validateSkillFrontmatter({ name: "my skill" })
      expect(spaces.success).toBe(false)
    })

    it("passes with provenance fields (source_url, source_license, imported_at, source_hash)", () => {
      const result = validateSkillFrontmatter({
        name: "reentrancy",
        description: "Reentrancy patterns",
        source_url: "https://github.com/kadenzipfel/smart-contract-vulnerabilities",
        source_license: "MIT",
        imported_at: "2025-01-15T00:00:00Z",
        source_hash: "abc123def456",
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.source_url).toBe("https://github.com/kadenzipfel/smart-contract-vulnerabilities")
        expect(result.data.source_license).toBe("MIT")
        expect(result.data.imported_at).toBe("2025-01-15T00:00:00Z")
        expect(result.data.source_hash).toBe("abc123def456")
      }
    })

    it("passes without provenance fields (backward compatibility)", () => {
      const result = validateSkillFrontmatter({
        name: "oracle-manipulation",
        description: "Oracle attacks",
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.source_url).toBeUndefined()
        expect(result.data.source_license).toBeUndefined()
        expect(result.data.imported_at).toBeUndefined()
        expect(result.data.source_hash).toBeUndefined()
      }
    })

    it("fails when source_url is not a valid URL", () => {
      const result = validateSkillFrontmatter({
        name: "test-skill",
        source_url: "not-a-url",
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.some((e) => e.includes("source_url"))).toBe(true)
      }
    })
  })

  describe("parseFrontmatter", () => {
    it("parses valid YAML frontmatter block", () => {
      const content = `---
name: reentrancy
description: Attack patterns for reentrancy
---

# Reentrancy
Some content here.`
      const result = parseFrontmatter(content)
      expect(result).not.toBeNull()
      expect(result?.name).toBe("reentrancy")
      expect(result?.description).toBe("Attack patterns for reentrancy")
    })

    it("returns null when no frontmatter block exists", () => {
      const result = parseFrontmatter("# Just a heading\nSome content without frontmatter")
      expect(result).toBeNull()
    })

    it("strips quotes from frontmatter values", () => {
      const content = `---
name: "oracle-manipulation"
description: 'Price oracle attacks'
---
`
      const result = parseFrontmatter(content)
      expect(result).not.toBeNull()
      expect(result?.name).toBe("oracle-manipulation")
      expect(result?.description).toBe("Price oracle attacks")
    })

    it("parses boolean values from frontmatter", () => {
      const content = `---
name: old-pattern
deprecated: true
---
`
      const result = parseFrontmatter(content)
      expect(result).not.toBeNull()
      expect(result?.deprecated).toBe(true)
    })

    it("extracts provenance fields from frontmatter", () => {
      const content = `---
name: reentrancy
description: Reentrancy patterns
source_url: https://github.com/kadenzipfel/smart-contract-vulnerabilities
source_license: MIT
imported_at: "2025-01-15T00:00:00Z"
source_hash: abc123def456
---
# Content here`
      const result = parseFrontmatter(content)
      expect(result).not.toBeNull()
      expect(result?.source_url).toBe("https://github.com/kadenzipfel/smart-contract-vulnerabilities")
      expect(result?.source_license).toBe("MIT")
      expect(result?.imported_at).toBe("2025-01-15T00:00:00Z")
      expect(result?.source_hash).toBe("abc123def456")
    })

    it("handles missing provenance fields gracefully", () => {
      const content = `---
name: test-skill
description: A test skill
---
# Content`
      const result = parseFrontmatter(content)
      expect(result).not.toBeNull()
      expect(result?.source_url).toBeUndefined()
      expect(result?.source_license).toBeUndefined()
      expect(result?.imported_at).toBeUndefined()
      expect(result?.source_hash).toBeUndefined()
    })

    it("parses detection_rules arrays from YAML frontmatter", () => {
      const content = `---
name: reentrancy
description: Reentrancy patterns
detection_rules:
  - regex: '\\.call\\{value:'
    severity: High
    confidence: High
    swc: SWC-107
  - regex: '\\.call\\{.*\\}\\('
    severity: Medium
---
# Content`
      const result = parseFrontmatter(content)
      expect(result).not.toBeNull()
      const rules = result?.detection_rules as Array<Record<string, unknown>>
      expect(Array.isArray(rules)).toBe(true)
      expect(rules).toHaveLength(2)
      expect(rules[0]?.regex).toBe("\\.call\\{value:")
      expect(rules[1]?.severity).toBe("Medium")
    })
  })

  describe("DetectionRuleSchema", () => {
    it("validates correct detection rules", () => {
      const result = DetectionRuleSchema.safeParse({
        regex: "tx\\.origin",
        severity: "High",
        confidence: "High",
        swc: "SWC-115",
      })
      expect(result.success).toBe(true)
    })

    it("rejects invalid detection rules missing regex", () => {
      const result = DetectionRuleSchema.safeParse({
        severity: "High",
      })
      expect(result.success).toBe(false)
    })
  })
})
