import { describe, expect, it } from "bun:test"
import { readFile } from "fs/promises"
import { join } from "path"
import { parse as parseYaml } from "yaml"
import { PatternPackSchema } from "../../src/tools/pattern-schema"

const PATTERNS_DIR = join(import.meta.dir, "../../skills/patterns")
const FIXTURES_DIR = join(import.meta.dir, "../fixtures/pattern-corpus")

async function loadDonationPack() {
  const raw = await readFile(join(PATTERNS_DIR, "donation-attacks.yaml"), "utf-8")
  return parseYaml(raw)
}

async function loadFixture(name: string): Promise<string> {
  return readFile(join(FIXTURES_DIR, name), "utf-8")
}

describe("donation-attacks.yaml: schema validation", () => {
  it("loads and validates against PatternPackSchema", async () => {
    const pack = await loadDonationPack()
    const result = PatternPackSchema.safeParse(pack)

    if (!result.success) {
      console.error("Validation errors:", JSON.stringify(result.error.issues, null, 2))
    }
    expect(result.success).toBe(true)
  })

  it("has pack_name 'donation-attacks' and pack_version", async () => {
    const pack = await loadDonationPack()
    expect(pack.pack_name).toBe("donation-attacks")
    expect(pack.pack_version).toBe("1.0")
  })

  it("contains 3 patterns", async () => {
    const pack = await loadDonationPack()
    expect(pack.patterns.length).toBe(3)
  })

  it("all patterns have category 'logic-error'", async () => {
    const pack = await loadDonationPack()
    for (const pattern of pack.patterns) {
      expect(pattern.category).toBe("logic-error")
    }
  })

  it("all patterns have required fields", async () => {
    const pack = await loadDonationPack()
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
    const pack = await loadDonationPack()
    for (const pattern of pack.patterns) {
      expect(() => new RegExp(pattern.regex, "s")).not.toThrow()
    }
  })

  it("pattern names are unique", async () => {
    const pack = await loadDonationPack()
    const names = pack.patterns.map((p: { name: string }) => p.name)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })

  it("no regex overlap with erc4626.yaml patterns", async () => {
    const donationRaw = await readFile(join(PATTERNS_DIR, "donation-attacks.yaml"), "utf-8")
    const erc4626Raw = await readFile(join(PATTERNS_DIR, "erc4626.yaml"), "utf-8")
    const donationPack = parseYaml(donationRaw)
    const erc4626Pack = parseYaml(erc4626Raw)

    for (const dp of donationPack.patterns) {
      for (const ep of erc4626Pack.patterns) {
        expect(dp.regex).not.toBe(ep.regex)
      }
    }
  })
})

describe("donation-attacks.yaml: positive fixture matching", () => {
  it("first-depositor-inflation matches shares = assets", async () => {
    const pack = await loadDonationPack()
    const vulnerable = await loadFixture("donation-vulnerable.sol")
    const pattern = pack.patterns.find((p: { name: string }) => p.name === "first-depositor-inflation")
    expect(pattern).toBeDefined()

    const regex = new RegExp(pattern!.regex, "s")
    expect(regex.test(vulnerable)).toBe(true)
  })

  it("direct-token-transfer matches .transfer(address(this))", async () => {
    const pack = await loadDonationPack()
    const vulnerable = await loadFixture("donation-vulnerable.sol")
    const pattern = pack.patterns.find((p: { name: string }) => p.name === "direct-token-transfer")
    expect(pattern).toBeDefined()

    const regex = new RegExp(pattern!.regex, "s")
    expect(regex.test(vulnerable)).toBe(true)
  })

  it("empty-pool-exploit matches totalSupply() == 0", async () => {
    const pack = await loadDonationPack()
    const vulnerable = await loadFixture("donation-vulnerable.sol")
    const pattern = pack.patterns.find((p: { name: string }) => p.name === "empty-pool-exploit")
    expect(pattern).toBeDefined()

    const regex = new RegExp(pattern!.regex, "s")
    expect(regex.test(vulnerable)).toBe(true)
  })
})

describe("donation-attacks.yaml: negative fixture non-matching", () => {
  it("first-depositor-inflation does NOT match safe vault with virtual offset", async () => {
    const pack = await loadDonationPack()
    const safe = await loadFixture("donation-safe.sol")
    const pattern = pack.patterns.find((p: { name: string }) => p.name === "first-depositor-inflation")
    expect(pattern).toBeDefined()

    const regex = new RegExp(pattern!.regex, "s")
    expect(regex.test(safe)).toBe(false)
  })

  it("direct-token-transfer does NOT match vault using transferFrom", async () => {
    const pack = await loadDonationPack()
    const safe = await loadFixture("donation-safe.sol")
    const pattern = pack.patterns.find((p: { name: string }) => p.name === "direct-token-transfer")
    expect(pattern).toBeDefined()

    const regex = new RegExp(pattern!.regex, "s")
    expect(regex.test(safe)).toBe(false)
  })

  it("empty-pool-exploit does NOT match vault with virtual offset (no raw zero check)", async () => {
    const pack = await loadDonationPack()
    const safe = await loadFixture("donation-safe.sol")
    const pattern = pack.patterns.find((p: { name: string }) => p.name === "empty-pool-exploit")
    expect(pattern).toBeDefined()

    const regex = new RegExp(pattern!.regex, "s")
    expect(regex.test(safe)).toBe(false)
  })
})
