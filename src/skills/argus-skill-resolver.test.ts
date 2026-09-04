import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ArgusConfig } from "../config/types"
import {
  getRequiredAuditSkills,
  normalizeSkillName,
  resolveArgusSkills,
  resolveSkillRoots,
} from "./argus-skill-resolver"

describe("argus-skill-resolver", () => {
  it("normalizes legacy and namespaced skill names", () => {
    expect(normalizeSkillName("vulnerability-patterns/reentrancy")).toBe("reentrancy")
    expect(normalizeSkillName("building-secure-contracts/token-integration-analyzer")).toBe(
      "token-integration-analyzer",
    )
    expect(normalizeSkillName("protocol-patterns/amm-dex")).toBe("amm-dex")
  })

  it("always includes bundled skill root", () => {
    const roots = resolveSkillRoots(process.cwd())
    expect(roots.some((root) => root.source === "bundled")).toBe(true)
  })

  it("resolves required Argus audit skills", () => {
    const skills = resolveArgusSkills(process.cwd())
    for (const requiredSkill of getRequiredAuditSkills()) {
      expect(skills.has(requiredSkill)).toBe(true)
    }
  })

  it("orders Trail of Bits plugin roots deterministically", () => {
    const cacheDir = mkdtempSync(join(realpathSync(tmpdir()), "argus-tob-order-"))
    const previousCacheDir = process.env.ARGUS_CACHE_DIR
    process.env.ARGUS_CACHE_DIR = cacheDir

    try {
      const pluginsDir = join(cacheDir, "trailofbits-skills", "plugins")
      mkdirSync(join(pluginsDir, "z-plugin", "skills"), { recursive: true })
      mkdirSync(join(pluginsDir, "a-plugin", "skills"), { recursive: true })

      const trailOfBitsRoots = resolveSkillRoots(cacheDir)
        .filter((root) => root.source === "trailofbits")
        .map((root) => root.path)

      expect(trailOfBitsRoots).toEqual([
        join(pluginsDir, "a-plugin", "skills"),
        join(pluginsDir, "z-plugin", "skills"),
      ])
    } finally {
      if (previousCacheDir === undefined) {
        delete process.env.ARGUS_CACHE_DIR
      } else {
        process.env.ARGUS_CACHE_DIR = previousCacheDir
      }
      rmSync(cacheDir, { recursive: true, force: true })
    }
  })

  it("resolves bundled audit specialist profile skills and attack-vector deck", () => {
    const skills = resolveArgusSkills(process.cwd())
    const specialistSkills = [
      "attack-vector-deck",
      "vector-scan",
      "access-control-specialist",
      "math-precision",
      "invariant",
      "economic-security",
      "execution-trace",
      "periphery",
      "first-principles",
    ]

    for (const skillName of specialistSkills) {
      expect(skills.has(skillName), `${skillName} should resolve`).toBe(true)
    }
    expect(skills.get("attack-vector-deck")?.filePath).toContain(
      "skills/references/attack-vector-deck/SKILL.md",
    )
    expect(skills.get("math-precision")?.filePath).toContain(
      "skills/specialist-profiles/math-precision/SKILL.md",
    )
  })

  it("exposes frontmatter metadata for catalog and scanner consumers", () => {
    const skills = resolveArgusSkills(process.cwd())
    const reentrancy = skills.get("reentrancy")

    expect(reentrancy?.category).toBe("vulnerability-pattern")
    expect(reentrancy?.pattern_category).toBe("reentrancy")
    expect(reentrancy?.detection_rules?.length).toBeGreaterThan(0)
  })
})

describe("skill precedence", () => {
  let tmpDir: string
  let customDir: string
  let customSkillContent: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `argus-precedence-test-${Date.now()}`)
    customDir = join(tmpDir, "custom-skills")
    mkdirSync(join(customDir, "reentrancy"), { recursive: true })

    customSkillContent =
      "---\nname: reentrancy\ndescription: custom reentrancy\n---\n# Custom reentrancy"
    writeFileSync(join(customDir, "reentrancy", "SKILL.md"), customSkillContent)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function makeConfig(precedence: "bundled-first" | "custom-first"): ArgusConfig {
    return {
      agents: { argus: {}, sentinel: {}, pythia: {}, auditSpecialist: {}, scribe: {}, themis: {} },
      tools: {},
      knowledge: {
        scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
        autoSync: true,
        customSkillsDir: customDir,
        skillPrecedence: precedence,
      },
      reporting: {
        confidenceThreshold: 80,
        severityThreshold: "low",
        output_dir: ".opencode/reports/",
      },
      solodit: { enabled: true },
      disabled_hooks: [],
    }
  }

  it("default bundled-first: bundled skills win on name collision", () => {
    const config = makeConfig("bundled-first")
    const roots = resolveSkillRoots(tmpDir, config)
    const bundledIdx = roots.findIndex((r) => r.source === "bundled")
    const customIdx = roots.findIndex((r) => r.source === "custom")
    expect(bundledIdx).toBeLessThan(customIdx)
  })

  it("custom-first: custom skill roots come before bundled roots", () => {
    const config = makeConfig("custom-first")
    const roots = resolveSkillRoots(tmpDir, config)
    const bundledIdx = roots.findIndex((r) => r.source === "bundled")
    const customIdx = roots.findIndex((r) => r.source === "custom")
    expect(customIdx).toBeLessThan(bundledIdx)
  })

  it("custom-first: custom skill overrides bundled when same name exists", () => {
    const config = makeConfig("custom-first")
    const skills = resolveArgusSkills(tmpDir, config)
    const reentrancy = skills.get("reentrancy")
    expect(reentrancy).toBeDefined()
    expect(reentrancy?.source).toBe("custom")
    expect(reentrancy?.content).toContain("Custom reentrancy")
  })

  it("no collision: both sources loaded regardless of precedence", () => {
    mkdirSync(join(customDir, "my-unique-check"), { recursive: true })
    writeFileSync(
      join(customDir, "my-unique-check", "SKILL.md"),
      "---\nname: my-unique-check\ndescription: unique\n---\n# Unique",
    )

    const config = makeConfig("bundled-first")
    const skills = resolveArgusSkills(tmpDir, config)
    expect(skills.has("reentrancy")).toBe(true)
    expect(skills.get("reentrancy")?.source).toBe("bundled")
    expect(skills.has("my-unique-check")).toBe(true)
    expect(skills.get("my-unique-check")?.source).toBe("custom")
  })

  it("ignores nested Markdown references without skill frontmatter", () => {
    mkdirSync(join(customDir, "vector-forge", "references"), { recursive: true })
    writeFileSync(
      join(customDir, "vector-forge", "references", "reference-only.md"),
      "# Supporting reference\nNot a loadable skill.",
    )

    const skills = resolveArgusSkills(tmpDir, makeConfig("custom-first"))

    expect(skills.has("reference-only")).toBe(false)
  })

  it("uses validated YAML metadata for quoted skill names", () => {
    mkdirSync(join(customDir, "quoted-skill"), { recursive: true })
    writeFileSync(
      join(customDir, "quoted-skill", "SKILL.md"),
      "---\nname: 'quoted-skill'\ndescription: 'Quoted description'\n---\n# Quoted",
    )

    const skills = resolveArgusSkills(tmpDir, makeConfig("custom-first"))

    expect(skills.get("quoted-skill")?.description).toBe("Quoted description")
  })
})

describe("trust tier classification", () => {
  it("source field correctly classifies trust tiers", () => {
    const roots = resolveSkillRoots(process.cwd())
    const bundledRoot = roots.find((r) => r.source === "bundled")
    expect(bundledRoot).toBeDefined()

    const validTiers = new Set(["bundled", "custom", "trailofbits", "opencode", "claude"])
    for (const root of roots) {
      expect(validTiers.has(root.source)).toBe(true)
    }
  })
})
