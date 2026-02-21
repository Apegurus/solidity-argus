import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
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
})

describe("skill precedence", () => {
  let tmpDir: string
  let customDir: string
  let _bundledSkillContent: string
  let customSkillContent: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `argus-precedence-test-${Date.now()}`)
    customDir = join(tmpDir, "custom-skills")
    mkdirSync(join(customDir, "reentrancy"), { recursive: true })

    _bundledSkillContent =
      "---\nname: reentrancy\ndescription: bundled reentrancy\n---\n# Bundled reentrancy"
    customSkillContent =
      "---\nname: reentrancy\ndescription: custom reentrancy\n---\n# Custom reentrancy"
    writeFileSync(join(customDir, "reentrancy", "SKILL.md"), customSkillContent)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function makeConfig(precedence: "bundled-first" | "custom-first"): ArgusConfig {
    return {
      agents: { argus: {}, sentinel: {}, pythia: {}, scribe: {} },
      tools: {},
      knowledge: {
        scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
        autoSync: true,
        customSkillsDir: customDir,
        skillPrecedence: precedence,
      },
      reporting: {
        format: "markdown",
        severityThreshold: "low",
        gasAnalysis: false,
        output_dir: ".opencode/reports/",
      },
      solodit: { enabled: true, port: 3000 },
      disabled_hooks: [],
      hooks: {},
      cli: {},
      background: { max_concurrent: 3 },
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
