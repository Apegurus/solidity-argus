import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parse as yamlParse } from "yaml"
import { PatternPackSchema } from "../../src/tools/pattern-schema"
import { loadPatternPacks } from "../../src/tools/pattern-loader"

const YAML_PATH = resolve(import.meta.dir, "../../skills/patterns/cross-chain-bridge.yaml")
const PATTERNS_DIR = resolve(import.meta.dir, "../../skills/patterns")
const FIXTURES_DIR = resolve(import.meta.dir, "../fixtures/pattern-corpus")

describe("cross-chain-bridge.yaml schema validation", () => {
  it("parses as valid YAML", () => {
    const raw = readFileSync(YAML_PATH, "utf-8")
    expect(() => yamlParse(raw)).not.toThrow()
  })

  it("validates against PatternPackSchema", () => {
    const raw = readFileSync(YAML_PATH, "utf-8")
    const parsed = yamlParse(raw)
    const result = PatternPackSchema.safeParse(parsed)

    if (!result.success) {
      console.error("Schema validation errors:", result.error.issues)
    }
    expect(result.success).toBe(true)
  })

  it("has pack_name and pack_version", () => {
    const raw = readFileSync(YAML_PATH, "utf-8")
    const parsed = yamlParse(raw)
    expect(parsed.pack_name).toBe("cross-chain-bridge")
    expect(parsed.pack_version).toBe("1.0")
  })

  it("contains exactly 4 patterns", () => {
    const raw = readFileSync(YAML_PATH, "utf-8")
    const parsed = yamlParse(raw)
    expect(parsed.patterns).toHaveLength(4)
  })

  it("all patterns use logic-error category", () => {
    const raw = readFileSync(YAML_PATH, "utf-8")
    const parsed = yamlParse(raw)
    for (const pattern of parsed.patterns) {
      expect(pattern.category).toBe("logic-error")
    }
  })

  it("all patterns have valid regex strings", () => {
    const raw = readFileSync(YAML_PATH, "utf-8")
    const parsed = yamlParse(raw)
    for (const pattern of parsed.patterns) {
      expect(() => new RegExp(pattern.regex)).not.toThrow()
    }
  })

  it("contains expected pattern names", () => {
    const raw = readFileSync(YAML_PATH, "utf-8")
    const parsed = yamlParse(raw)
    const names = parsed.patterns.map((p: any) => p.name)

    expect(names).toContain("missing-chain-id-validation")
    expect(names).toContain("replay-across-chains")
    expect(names).toContain("unverified-bridge-message")
    expect(names).toContain("hardcoded-bridge-address")
  })

  it("severity distribution: 1 Critical, 2 High, 1 Medium", () => {
    const raw = readFileSync(YAML_PATH, "utf-8")
    const parsed = yamlParse(raw)
    const bySeverity = (s: string) => parsed.patterns.filter((p: any) => p.severity === s)

    expect(bySeverity("Critical")).toHaveLength(1)
    expect(bySeverity("High")).toHaveLength(2)
    expect(bySeverity("Medium")).toHaveLength(1)
  })
})

describe("cross-chain-bridge pattern matching", () => {
  const vulnerableSol = readFileSync(join(FIXTURES_DIR, "bridge-vulnerable.sol"), "utf-8")
  const safeSol = readFileSync(join(FIXTURES_DIR, "bridge-safe.sol"), "utf-8")

  it("loadPatternPacks includes cross-chain-bridge patterns", () => {
    const patterns = loadPatternPacks(PATTERNS_DIR)
    const bridgeNames = new Set(patterns.map((p) => p.name))
    expect(bridgeNames.has("missing-chain-id-validation")).toBe(true)
    expect(bridgeNames.has("replay-across-chains")).toBe(true)
    expect(bridgeNames.has("unverified-bridge-message")).toBe(true)
    expect(bridgeNames.has("hardcoded-bridge-address")).toBe(true)
  })

  it("missing-chain-id-validation matches vulnerable fixture", () => {
    const raw = readFileSync(YAML_PATH, "utf-8")
    const parsed = yamlParse(raw)
    const pattern = parsed.patterns.find((p: any) => p.name === "missing-chain-id-validation")
    const regex = new RegExp(pattern.regex)
    expect(regex.test(vulnerableSol)).toBe(true)
  })

  it("missing-chain-id-validation does NOT match safe fixture", () => {
    const raw = readFileSync(YAML_PATH, "utf-8")
    const parsed = yamlParse(raw)
    const pattern = parsed.patterns.find((p: any) => p.name === "missing-chain-id-validation")
    const regex = new RegExp(pattern.regex)
    expect(regex.test(safeSol)).toBe(false)
  })

  it("replay-across-chains matches vulnerable fixture", () => {
    const raw = readFileSync(YAML_PATH, "utf-8")
    const parsed = yamlParse(raw)
    const pattern = parsed.patterns.find((p: any) => p.name === "replay-across-chains")
    const regex = new RegExp(pattern.regex)
    expect(regex.test(vulnerableSol)).toBe(true)
  })

  it("replay-across-chains does NOT match safe fixture", () => {
    const raw = readFileSync(YAML_PATH, "utf-8")
    const parsed = yamlParse(raw)
    const pattern = parsed.patterns.find((p: any) => p.name === "replay-across-chains")
    const regex = new RegExp(pattern.regex)
    expect(regex.test(safeSol)).toBe(false)
  })

  it("unverified-bridge-message matches vulnerable fixture", () => {
    const raw = readFileSync(YAML_PATH, "utf-8")
    const parsed = yamlParse(raw)
    const pattern = parsed.patterns.find((p: any) => p.name === "unverified-bridge-message")
    const regex = new RegExp(pattern.regex)
    expect(regex.test(vulnerableSol)).toBe(true)
  })

  it("unverified-bridge-message does NOT match safe fixture", () => {
    const raw = readFileSync(YAML_PATH, "utf-8")
    const parsed = yamlParse(raw)
    const pattern = parsed.patterns.find((p: any) => p.name === "unverified-bridge-message")
    const regex = new RegExp(pattern.regex)
    expect(regex.test(safeSol)).toBe(false)
  })

  it("hardcoded-bridge-address matches vulnerable fixture", () => {
    const raw = readFileSync(YAML_PATH, "utf-8")
    const parsed = yamlParse(raw)
    const pattern = parsed.patterns.find((p: any) => p.name === "hardcoded-bridge-address")
    const regex = new RegExp(pattern.regex)
    expect(regex.test(vulnerableSol)).toBe(true)
  })

  it("hardcoded-bridge-address does NOT match safe fixture", () => {
    const raw = readFileSync(YAML_PATH, "utf-8")
    const parsed = yamlParse(raw)
    const pattern = parsed.patterns.find((p: any) => p.name === "hardcoded-bridge-address")
    const regex = new RegExp(pattern.regex)
    expect(regex.test(safeSol)).toBe(false)
  })
})
