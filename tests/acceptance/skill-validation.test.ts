import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type LintResult, lintSkillFiles } from "../../src/cli/commands/lint-skills"
import type { ArgusConfig } from "../../src/config/types"
import { resolveArgusSkills, resolveSkillRoots } from "../../src/skills/argus-skill-resolver"
import { SkillFrontmatterSchema, validateSkillFrontmatter } from "../../src/skills/skill-schema"

function makeConfig(
  precedence: "bundled-first" | "custom-first",
  customSkillsDir: string,
): ArgusConfig {
  return {
    agents: { argus: {}, sentinel: {}, pythia: {}, scribe: {}, themis: {} },
    tools: {},
    knowledge: {
      scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
      autoSync: true,
      customSkillsDir,
      skillPrecedence: precedence,
    },
    reporting: {
      confidenceThreshold: 80,
      format: "markdown",
      severityThreshold: "low",
      gasAnalysis: false,
      output_dir: ".opencode/reports/",
    },
    solodit: { enabled: true, port: 54173 },
    disabled_hooks: [],
    hooks: {},
    cli: {},
    background: { max_concurrent: 3 },
  }
}

function buildSkillMd(frontmatter: Record<string, unknown>, body = "# Skill content"): string {
  const lines = Object.entries(frontmatter).map(([k, v]) => {
    if (typeof v === "boolean" || typeof v === "number") return `${k}: ${v}`
    return `${k}: ${JSON.stringify(v)}`
  })
  return `---\n${lines.join("\n")}\n---\n${body}`
}

describe("acceptance: schema validation", () => {
  it("valid skill frontmatter passes full validation pipeline", () => {
    const raw = {
      name: "flash-loan-guard",
      description: "Flash loan attack detection patterns",
      version: "2.1.0",
      category: "vulnerability-pattern" as const,
      source_url: "https://github.com/example/flash-loan",
      source_license: "MIT",
      imported_at: "2025-06-01T00:00:00Z",
      source_hash: "deadbeef1234",
    }

    const zodResult = SkillFrontmatterSchema.safeParse(raw)
    expect(zodResult.success).toBe(true)
    if (!zodResult.success) return

    const wrapperResult = validateSkillFrontmatter(raw)
    expect(wrapperResult.success).toBe(true)
    if (!wrapperResult.success) return

    expect(wrapperResult.data.name).toBe(zodResult.data.name)
    expect(wrapperResult.data.version).toBe("2.1.0")
    expect(wrapperResult.data.category).toBe("vulnerability-pattern")
    expect(wrapperResult.data.source_url).toBe(raw.source_url)
    expect(wrapperResult.data.source_hash).toBe(raw.source_hash)
  })

  it("missing required name field rejects validation", () => {
    const raw = { description: "A skill without a name" }

    const zodResult = SkillFrontmatterSchema.safeParse(raw)
    expect(zodResult.success).toBe(false)
    if (zodResult.success) return

    const nameIssues = zodResult.error.issues.filter(
      (i) => i.path.includes("name") || i.message.toLowerCase().includes("required"),
    )
    expect(nameIssues.length).toBeGreaterThan(0)

    const wrapperResult = validateSkillFrontmatter(raw)
    expect(wrapperResult.success).toBe(false)
    if (!wrapperResult.success) {
      expect(wrapperResult.errors.some((e) => e.includes("name") || e.includes("Required"))).toBe(
        true,
      )
    }
  })

  it("missing required name field with only optional fields present rejects", () => {
    const raw = {
      description: "Orphan description",
      version: "1.0.0",
      category: "methodology" as const,
    }
    const result = validateSkillFrontmatter(raw)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.errors.some((e) => e.toLowerCase().includes("name") || e.includes("Required")),
      ).toBe(true)
    }
  })

  it("invalid detection_rules format rejected", () => {
    // Given: detection_rules as a string instead of Array<DetectionRuleSchema>
    const rawStringRules = {
      name: "bad-rules-skill",
      detection_rules: "this is not an array",
    }
    expect(SkillFrontmatterSchema.safeParse(rawStringRules).success).toBe(false)

    // Given: array element missing required `regex` field
    const rawBadShape = {
      name: "bad-rules-skill-2",
      detection_rules: [{ notRegex: "foo", severity: "High" }],
    }
    expect(SkillFrontmatterSchema.safeParse(rawBadShape).success).toBe(false)

    // Given: properly structured rules pass
    const rawGood = {
      name: "good-rules-skill",
      detection_rules: [{ regex: "tx\\.origin", severity: "High" }],
    }
    expect(SkillFrontmatterSchema.safeParse(rawGood).success).toBe(true)
  })
})

describe("acceptance: precedence and trust", () => {
  let tmpDir: string
  let customDir: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `argus-accept-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    customDir = join(tmpDir, "custom-skills")
    mkdirSync(customDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("bundled-first precedence: bundled skill takes priority over custom with same name", () => {
    mkdirSync(join(customDir, "reentrancy"), { recursive: true })
    writeFileSync(
      join(customDir, "reentrancy", "SKILL.md"),
      buildSkillMd({ name: "reentrancy", description: "custom reentrancy override" }),
    )

    const config = makeConfig("bundled-first", customDir)
    const skills = resolveArgusSkills(tmpDir, config)
    const reentrancy = skills.get("reentrancy")

    expect(reentrancy).toBeDefined()
    expect(reentrancy?.source).toBe("bundled")
    expect(reentrancy?.content).not.toContain("custom reentrancy override")
  })

  it("custom-first precedence: custom skill overrides bundled with same name", () => {
    mkdirSync(join(customDir, "reentrancy"), { recursive: true })
    writeFileSync(
      join(customDir, "reentrancy", "SKILL.md"),
      buildSkillMd({ name: "reentrancy", description: "my custom reentrancy" }),
    )

    const config = makeConfig("custom-first", customDir)
    const skills = resolveArgusSkills(tmpDir, config)
    const reentrancy = skills.get("reentrancy")

    expect(reentrancy).toBeDefined()
    expect(reentrancy?.source).toBe("custom")
    expect(reentrancy?.content).toContain("my custom reentrancy")
  })

  it("correct trust tier classification for all source roots", () => {
    const roots = resolveSkillRoots(tmpDir)
    const bundled = roots.filter((r) => r.source === "bundled")
    expect(bundled.length).toBe(1)

    const configWithCustom = makeConfig("bundled-first", customDir)
    const rootsWithCustom = resolveSkillRoots(tmpDir, configWithCustom)
    const customRoots = rootsWithCustom.filter((r) => r.source === "custom")
    expect(customRoots.length).toBe(1)

    const validSources = new Set(["bundled", "custom", "trailofbits", "opencode", "claude"])
    for (const root of rootsWithCustom) {
      expect(validSources.has(root.source)).toBe(true)
    }

    const bundledIdx = rootsWithCustom.findIndex((r) => r.source === "bundled")
    const customIdx = rootsWithCustom.findIndex((r) => r.source === "custom")
    expect(bundledIdx).toBeLessThan(customIdx)
  })
})

describe("acceptance: duplicate detection and lint", () => {
  let tmpDir: string
  let customDir: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `argus-dup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    customDir = join(tmpDir, "custom-skills")
    mkdirSync(customDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("duplicate skill from multiple sources: first-wins based on precedence", () => {
    mkdirSync(join(customDir, "oracle-manipulation"), { recursive: true })
    writeFileSync(
      join(customDir, "oracle-manipulation", "SKILL.md"),
      buildSkillMd({ name: "oracle-manipulation", description: "custom oracle skill" }),
    )

    // When: custom-first → custom wins
    const config = makeConfig("custom-first", customDir)
    const skills = resolveArgusSkills(tmpDir, config)
    const oracle = skills.get("oracle-manipulation")
    expect(oracle).toBeDefined()
    expect(oracle?.source).toBe("custom")

    // When: bundled-first → bundled wins
    const configBundled = makeConfig("bundled-first", customDir)
    const skillsBundled = resolveArgusSkills(tmpDir, configBundled)
    const oracleBundled = skillsBundled.get("oracle-manipulation")
    expect(oracleBundled).toBeDefined()
    expect(oracleBundled?.source).toBe("bundled")

    // Then: exactly one entry — duplicate suppressed
    const oracleCount = [...skills.keys()].filter((n) => n === "oracle-manipulation").length
    expect(oracleCount).toBe(1)
  })

  it("lint-skills validates in-memory skill files through full pipeline", () => {
    const validSkill = buildSkillMd({
      name: "test-lint-valid",
      description: "A properly formatted skill",
      version: "1.0.0",
      category: "checklist",
    })

    const invalidSkill = `---
name: "InvalidUpperCase"
description: "This name has uppercase letters"
---
# Invalid skill`

    const missingName = `---
description: "No name here"
version: "1.0.0"
---
# Missing name`

    const noFrontmatter = "# Just markdown\nNo frontmatter block here."

    const files = [
      { path: "/fake/valid.md", content: validSkill },
      { path: "/fake/invalid-upper.md", content: invalidSkill },
      { path: "/fake/missing-name.md", content: missingName },
      { path: "/fake/no-fm.md", content: noFrontmatter },
    ]

    const result: LintResult = lintSkillFiles(files)

    expect(result.valid).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.invalid).toBe(2)
    expect(result.errors).toHaveLength(2)

    const errorFiles = result.errors.map((e) => e.file)
    expect(errorFiles).toContain("/fake/invalid-upper.md")
    expect(errorFiles).toContain("/fake/missing-name.md")

    for (const err of result.errors) {
      expect(err.errors.length).toBeGreaterThan(0)
    }
  })

  it("lint pipeline detects detection_rules schema violations", () => {
    const validWithRules = `---
name: reentrancy-lint-test
description: test skill with rules
detection_rules:
  - regex: '\\.call\\{value:'
    severity: High
  - regex: 'delegatecall'
    severity: Critical
    confidence: Medium
---
# Content`

    const invalidRules = `---
name: bad-rules-lint
description: bad rules
detection_rules:
  - regex: 'something'
---
# Content`

    const files = [
      { path: "/lint/valid-rules.md", content: validWithRules },
      { path: "/lint/invalid-rules.md", content: invalidRules },
    ]

    const result = lintSkillFiles(files)
    expect(result.valid).toBe(1)
    expect(result.invalid).toBe(1)
    expect(result.errors[0]?.file).toBe("/lint/invalid-rules.md")
  })
})

describe("acceptance: end-to-end skill system integration", () => {
  let tmpDir: string
  let customDir: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `argus-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    customDir = join(tmpDir, "custom-skills")
    mkdirSync(customDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("full loop: write custom skill to disk, resolve, verify metadata propagation", () => {
    const skillName = "custom-flash-loan"
    mkdirSync(join(customDir, skillName), { recursive: true })

    const skillContent = `---
name: custom-flash-loan
description: Custom flash loan detection rules
version: 1.2.0
category: vulnerability-pattern
source_url: https://example.com/flash-loan
source_license: Apache-2.0
source_hash: cafebabe
---
# Flash Loan Guard

Detect flash loan attack vectors in DeFi protocols.`

    writeFileSync(join(customDir, skillName, "SKILL.md"), skillContent)

    const config = makeConfig("custom-first", customDir)
    const skills = resolveArgusSkills(tmpDir, config)
    const resolved = skills.get(skillName)

    expect(resolved).toBeDefined()
    expect(resolved?.source).toBe("custom")
    expect(resolved?.name).toBe(skillName)
    expect(resolved?.description).toBe("Custom flash loan detection rules")
    expect(resolved?.source_url).toBe("https://example.com/flash-loan")
    expect(resolved?.source_license).toBe("Apache-2.0")
    expect(resolved?.source_hash).toBe("cafebabe")
    expect(resolved?.content).toContain("Flash Loan Guard")

    const lintResult = lintSkillFiles([
      { path: "custom-flash-loan/SKILL.md", content: skillContent },
    ])
    expect(lintResult.valid).toBe(1)
    expect(lintResult.invalid).toBe(0)
  })
})
