import { describe, it, expect } from "bun:test"
import {
  PatternDefinitionSchema,
  PatternCategorySchema,
  PatternPackSchema,
  type PatternDefinition,
  type PatternPack,
} from "./pattern-schema"

describe("PatternCategorySchema", () => {
  it("accepts all valid categories", () => {
    const categories: string[] = [
      "reentrancy",
      "oracle-manipulation",
      "flash-loan",
      "access-control",
      "erc4626",
      "proxy",
      "signature",
      "dos",
      "front-running",
      "governance",
      "token-standard",
      "gas-optimization",
      "logic-error",
    ]
    for (const cat of categories) {
      const result = PatternCategorySchema.safeParse(cat)
      expect(result.success).toBe(true)
    }
  })

  it("rejects invalid category", () => {
    const result = PatternCategorySchema.safeParse("not-a-category")
    expect(result.success).toBe(false)
  })
})

describe("PatternDefinitionSchema", () => {
  const validPattern: PatternDefinition = {
    name: "reentrancy-eth-transfer",
    category: "reentrancy",
    severity: "High",
    confidence: "Medium",
    version: "1.0",
    regex: "\\.call\\{value:",
    description: "Potential reentrancy via low-level ETH transfer",
  }

  it("validates a complete valid pattern", () => {
    const result = PatternDefinitionSchema.safeParse(validPattern)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe("reentrancy-eth-transfer")
      expect(result.data.category).toBe("reentrancy")
      expect(result.data.confidence).toBe("Medium")
    }
  })

  it("applies defaults for confidence and version", () => {
    const minimal = {
      name: "test-pattern",
      category: "dos",
      severity: "Low",
      regex: "block\\.timestamp",
      description: "Timestamp dependence",
    }
    const result = PatternDefinitionSchema.safeParse(minimal)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.confidence).toBe("Medium")
      expect(result.data.version).toBe("1.0")
    }
  })

  it("rejects pattern with invalid category", () => {
    const bad = { ...validPattern, category: "invalid-cat" }
    const result = PatternDefinitionSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it("rejects pattern missing required regex field", () => {
    const { regex: _, ...noRegex } = validPattern
    const result = PatternDefinitionSchema.safeParse(noRegex)
    expect(result.success).toBe(false)
  })

  it("rejects pattern with empty name", () => {
    const bad = { ...validPattern, name: "" }
    const result = PatternDefinitionSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it("rejects pattern with name exceeding 128 chars", () => {
    const bad = { ...validPattern, name: "x".repeat(129) }
    const result = PatternDefinitionSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it("accepts optional swc with valid format", () => {
    const withSwc = { ...validPattern, swc: "SWC-107" }
    const result = PatternDefinitionSchema.safeParse(withSwc)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.swc).toBe("SWC-107")
    }
  })

  it("rejects swc with invalid format", () => {
    const bad = { ...validPattern, swc: "107" }
    const result = PatternDefinitionSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it("accepts optional exploit_ref as valid URL", () => {
    const withRef = { ...validPattern, exploit_ref: "https://rekt.news/exploit" }
    const result = PatternDefinitionSchema.safeParse(withRef)
    expect(result.success).toBe(true)
  })

  it("rejects exploit_ref with invalid URL", () => {
    const bad = { ...validPattern, exploit_ref: "not-a-url" }
    const result = PatternDefinitionSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })
})

describe("PatternPackSchema", () => {
  it("validates a valid pattern pack", () => {
    const pack: PatternPack = {
      pack_version: "1.0",
      patterns: [
        {
          name: "test",
          category: "dos",
          severity: "Medium",
          confidence: "Medium",
          version: "1.0",
          regex: "gasleft\\(\\)",
          description: "Gas griefing check",
        },
      ],
    }
    const result = PatternPackSchema.safeParse(pack)
    expect(result.success).toBe(true)
  })

  it("rejects pack with empty patterns array", () => {
    const bad = { pack_version: "1.0", patterns: [] }
    const result = PatternPackSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it("applies pack_version default", () => {
    const pack = {
      patterns: [
        {
          name: "test",
          category: "dos",
          severity: "Low",
          regex: "block\\.number",
          description: "Block number dep",
        },
      ],
    }
    const result = PatternPackSchema.safeParse(pack)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.pack_version).toBe("1.0")
    }
  })

  it("rejects pack containing an invalid pattern", () => {
    const bad = {
      patterns: [
        {
          name: "valid",
          category: "dos",
          severity: "Low",
          regex: "ok",
          description: "fine",
        },
        {
          name: "",
          category: "bad-cat",
          severity: "Low",
          regex: "ok",
          description: "broken",
        },
      ],
    }
    const result = PatternPackSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })
})
