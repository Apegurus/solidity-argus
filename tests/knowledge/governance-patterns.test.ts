import { describe, expect, it } from "bun:test"
import { readFile } from "fs/promises"
import { join } from "path"
import { parse as parseYaml } from "yaml"
import { PatternPackSchema } from "../../src/tools/pattern-schema"

const PATTERNS_DIR = join(import.meta.dir, "../../skills/patterns")
const FIXTURES_DIR = join(import.meta.dir, "../fixtures/pattern-corpus")

async function loadGovernancePack() {
  const raw = await readFile(join(PATTERNS_DIR, "governance.yaml"), "utf-8")
  return parseYaml(raw)
}

async function loadFixture(name: string): Promise<string> {
  return readFile(join(FIXTURES_DIR, name), "utf-8")
}

describe("governance.yaml: schema validation", () => {
  it("loads and validates against PatternPackSchema", async () => {
    const pack = await loadGovernancePack()
    const result = PatternPackSchema.safeParse(pack)

    if (!result.success) {
      console.error("Validation errors:", JSON.stringify(result.error.issues, null, 2))
    }
    expect(result.success).toBe(true)
  })

  it("has pack_name 'governance' and pack_version", async () => {
    const pack = await loadGovernancePack()
    expect(pack.pack_name).toBe("governance")
    expect(pack.pack_version).toBe("1.0")
  })

  it("contains 4-6 patterns", async () => {
    const pack = await loadGovernancePack()
    expect(pack.patterns.length).toBeGreaterThanOrEqual(4)
    expect(pack.patterns.length).toBeLessThanOrEqual(6)
  })

  it("all patterns have category 'governance'", async () => {
    const pack = await loadGovernancePack()
    for (const pattern of pack.patterns) {
      expect(pattern.category).toBe("governance")
    }
  })

  it("all patterns have required fields", async () => {
    const pack = await loadGovernancePack()
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

  it("all regexes are valid and compilable", async () => {
    const pack = await loadGovernancePack()
    for (const pattern of pack.patterns) {
      expect(() => new RegExp(pattern.regex, "s")).not.toThrow()
    }
  })

  it("pattern names are unique", async () => {
    const pack = await loadGovernancePack()
    const names = pack.patterns.map((p: { name: string }) => p.name)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })
})

describe("governance.yaml: positive fixture matching", () => {
  it("timelock-bypass matches vulnerable execute function", async () => {
    const pack = await loadGovernancePack()
    const vulnerable = await loadFixture("governance-vulnerable.sol")
    const pattern = pack.patterns.find((p: { name: string }) => p.name === "timelock-bypass")
    expect(pattern).toBeDefined()

    const regex = new RegExp(pattern!.regex, "s")
    expect(regex.test(vulnerable)).toBe(true)
  })

  it("flash-loan-governance matches propose and castVote", async () => {
    const pack = await loadGovernancePack()
    const vulnerable = await loadFixture("governance-vulnerable.sol")
    const pattern = pack.patterns.find((p: { name: string }) => p.name === "flash-loan-governance")
    expect(pattern).toBeDefined()

    const regex = new RegExp(pattern!.regex, "s")
    expect(regex.test(vulnerable)).toBe(true)
  })

  it("quorum-manipulation matches getVotes without snapshot", async () => {
    const pack = await loadGovernancePack()
    const vulnerable = await loadFixture("governance-vulnerable.sol")
    const pattern = pack.patterns.find((p: { name: string }) => p.name === "quorum-manipulation")
    expect(pattern).toBeDefined()

    const regex = new RegExp(pattern!.regex, "s")
    expect(regex.test(vulnerable)).toBe(true)
  })

  it("unprotected-proposal matches propose without threshold", async () => {
    const pack = await loadGovernancePack()
    const vulnerable = await loadFixture("governance-vulnerable.sol")
    const pattern = pack.patterns.find((p: { name: string }) => p.name === "unprotected-proposal")
    expect(pattern).toBeDefined()

    const regex = new RegExp(pattern!.regex, "s")
    expect(regex.test(vulnerable)).toBe(true)
  })

  it("single-step-governance matches executeProposal without state machine", async () => {
    const pack = await loadGovernancePack()
    const vulnerable = await loadFixture("governance-vulnerable.sol")
    const pattern = pack.patterns.find((p: { name: string }) => p.name === "single-step-governance")
    expect(pattern).toBeDefined()

    const regex = new RegExp(pattern!.regex, "s")
    expect(regex.test(vulnerable)).toBe(true)
  })
})

describe("governance.yaml: negative fixture non-matching", () => {
  it("timelock-bypass does NOT match safe governance with timelock", async () => {
    const pack = await loadGovernancePack()
    const safe = await loadFixture("governance-safe.sol")
    const pattern = pack.patterns.find((p: { name: string }) => p.name === "timelock-bypass")
    expect(pattern).toBeDefined()

    const regex = new RegExp(pattern!.regex, "s")
    expect(regex.test(safe)).toBe(false)
  })

  it("quorum-manipulation does NOT match snapshot-based voting", async () => {
    const pack = await loadGovernancePack()
    const safe = await loadFixture("governance-safe.sol")
    const pattern = pack.patterns.find((p: { name: string }) => p.name === "quorum-manipulation")
    expect(pattern).toBeDefined()

    const regex = new RegExp(pattern!.regex, "s")
    expect(regex.test(safe)).toBe(false)
  })

  it("unprotected-proposal does NOT match governance with threshold", async () => {
    const pack = await loadGovernancePack()
    const safe = await loadFixture("governance-safe.sol")
    const pattern = pack.patterns.find((p: { name: string }) => p.name === "unprotected-proposal")
    expect(pattern).toBeDefined()

    const regex = new RegExp(pattern!.regex, "s")
    expect(regex.test(safe)).toBe(false)
  })

  it("single-step-governance does NOT match proper state machine governance", async () => {
    const pack = await loadGovernancePack()
    const safe = await loadFixture("governance-safe.sol")
    const pattern = pack.patterns.find((p: { name: string }) => p.name === "single-step-governance")
    expect(pattern).toBeDefined()

    const regex = new RegExp(pattern!.regex, "s")
    expect(regex.test(safe)).toBe(false)
  })
})
