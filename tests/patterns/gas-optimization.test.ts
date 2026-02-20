import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parse as yamlParse } from "yaml"
import { PatternPackSchema } from "../../src/tools/pattern-schema"
import { loadPatternPacks } from "../../src/tools/pattern-loader"

const YAML_PATH = resolve(import.meta.dir, "../../skills/patterns/gas-optimization.yaml")
const PATTERNS_DIR = resolve(import.meta.dir, "../../skills/patterns")
const FIXTURES_DIR = resolve(import.meta.dir, "../fixtures/pattern-corpus")

function loadPack() {
  const raw = readFileSync(YAML_PATH, "utf-8")
  return yamlParse(raw)
}

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES_DIR, name), "utf-8")
}

describe("gas-optimization.yaml: schema validation", () => {
  it("parses as valid YAML", () => {
    const raw = readFileSync(YAML_PATH, "utf-8")
    expect(() => yamlParse(raw)).not.toThrow()
  })

  it("validates against PatternPackSchema", () => {
    const pack = loadPack()
    const result = PatternPackSchema.safeParse(pack)

    if (!result.success) {
      console.error("Schema validation errors:", result.error.issues)
    }
    expect(result.success).toBe(true)
  })

  it("has pack_name 'gas-optimization' and pack_version '1.0'", () => {
    const pack = loadPack()
    expect(pack.pack_name).toBe("gas-optimization")
    expect(pack.pack_version).toBe("1.0")
  })

  it("contains exactly 4 patterns", () => {
    const pack = loadPack()
    expect(pack.patterns).toHaveLength(4)
  })

  it("all patterns use gas-optimization category", () => {
    const pack = loadPack()
    for (const pattern of pack.patterns) {
      expect(pattern.category).toBe("gas-optimization")
    }
  })

  it("all patterns have valid regex strings", () => {
    const pack = loadPack()
    for (const pattern of pack.patterns) {
      expect(() => new RegExp(pattern.regex)).not.toThrow()
    }
  })

  it("all patterns reference SWC-128", () => {
    const pack = loadPack()
    for (const pattern of pack.patterns) {
      expect(pattern.swc).toBe("SWC-128")
    }
  })

  it("contains expected pattern names", () => {
    const pack = loadPack()
    const names = pack.patterns.map((p: any) => p.name)

    expect(names).toContain("unbounded-loop")
    expect(names).toContain("storage-write-in-loop")
    expect(names).toContain("external-call-in-loop")
    expect(names).toContain("unchecked-array-growth")
  })

  it("all patterns have required fields", () => {
    const pack = loadPack()
    for (const pattern of pack.patterns) {
      expect(pattern.name).toBeDefined()
      expect(typeof pattern.name).toBe("string")
      expect(pattern.severity).toBeDefined()
      expect(pattern.regex).toBeDefined()
      expect(typeof pattern.regex).toBe("string")
      expect(pattern.description).toBeDefined()
      expect(pattern.confidence).toBeDefined()
      expect(pattern.version).toBeDefined()
    }
  })

  it("pattern names are unique", () => {
    const pack = loadPack()
    const names = pack.patterns.map((p: { name: string }) => p.name)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })

  it("severity distribution: 2 High, 2 Medium", () => {
    const pack = loadPack()
    const bySeverity = (s: string) => pack.patterns.filter((p: any) => p.severity === s)

    expect(bySeverity("High")).toHaveLength(2)
    expect(bySeverity("Medium")).toHaveLength(2)
  })
})

describe("gas-optimization.yaml: loadPatternPacks integration", () => {
  it("loadPatternPacks includes gas-optimization patterns", () => {
    const patterns = loadPatternPacks(PATTERNS_DIR)
    const gasNames = new Set(patterns.map((p) => p.name))

    expect(gasNames.has("unbounded-loop")).toBe(true)
    expect(gasNames.has("storage-write-in-loop")).toBe(true)
    expect(gasNames.has("external-call-in-loop")).toBe(true)
    expect(gasNames.has("unchecked-array-growth")).toBe(true)
  })
})

describe("gas-optimization.yaml: positive fixture matching", () => {
  const vulnerable = loadFixture("gas-vulnerable.sol")
  const pack = loadPack()

  it("unbounded-loop matches for-loop over dynamic .length", () => {
    const pattern = pack.patterns.find((p: any) => p.name === "unbounded-loop")
    const regex = new RegExp(pattern.regex)
    expect(regex.test(vulnerable)).toBe(true)
  })

  it("storage-write-in-loop matches state write inside for-loop", () => {
    const pattern = pack.patterns.find((p: any) => p.name === "storage-write-in-loop")
    const regex = new RegExp(pattern.regex)
    expect(regex.test(vulnerable)).toBe(true)
  })

  it("external-call-in-loop matches .call{value} inside for-loop", () => {
    const pattern = pack.patterns.find((p: any) => p.name === "external-call-in-loop")
    const regex = new RegExp(pattern.regex)
    expect(regex.test(vulnerable)).toBe(true)
  })

  it("external-call-in-loop matches .transfer() inside for-loop", () => {
    const pattern = pack.patterns.find((p: any) => p.name === "external-call-in-loop")
    const regex = new RegExp(pattern.regex)
    expect(regex.test(vulnerable)).toBe(true)
  })

  it("unchecked-array-growth matches .push() call", () => {
    const pattern = pack.patterns.find((p: any) => p.name === "unchecked-array-growth")
    const regex = new RegExp(pattern.regex)
    expect(regex.test(vulnerable)).toBe(true)
  })
})

describe("gas-optimization.yaml: negative fixture non-matching", () => {
  const safe = loadFixture("gas-safe.sol")
  const pack = loadPack()

  it("unbounded-loop does NOT match bounded/fixed iteration", () => {
    const pattern = pack.patterns.find((p: any) => p.name === "unbounded-loop")
    const regex = new RegExp(pattern.regex)
    expect(regex.test(safe)).toBe(false)
  })

  it("storage-write-in-loop does NOT match memory-only loop bodies", () => {
    const pattern = pack.patterns.find((p: any) => p.name === "storage-write-in-loop")
    const regex = new RegExp(pattern.regex)
    expect(regex.test(safe)).toBe(false)
  })

  it("external-call-in-loop does NOT match transfers outside loops", () => {
    const pattern = pack.patterns.find((p: any) => p.name === "external-call-in-loop")
    const regex = new RegExp(pattern.regex)
    expect(regex.test(safe)).toBe(false)
  })

  it("unchecked-array-growth does NOT match mapping-based registration", () => {
    const pattern = pack.patterns.find((p: any) => p.name === "unchecked-array-growth")
    const regex = new RegExp(pattern.regex)
    expect(regex.test(safe)).toBe(false)
  })
})
