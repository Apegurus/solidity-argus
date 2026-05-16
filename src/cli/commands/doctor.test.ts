import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { ResolvedSkill } from "../../skills/argus-skill-resolver"
import {
  ALL_CATEGORIES,
  type ArgusInstall,
  buildSkillHealthReport,
  detectInstallDrift,
  doctorCommand,
  enumerateArgusInstallCandidates,
  findDuplicateSkills,
} from "./doctor"

function makeSkill(
  name: string,
  source: ResolvedSkill["source"],
  frontmatter?: { category?: string; version?: string },
): ResolvedSkill {
  const fmLines: string[] = [`name: ${name}`]
  if (frontmatter?.category) fmLines.push(`category: ${frontmatter.category}`)
  if (frontmatter?.version) fmLines.push(`version: ${frontmatter.version}`)
  const content = `---\n${fmLines.join("\n")}\n---\n# ${name}\nBody content.`
  return { name, description: "", filePath: `/fake/${source}/${name}.md`, source, content }
}

function makeInvalidSkill(name: string, source: ResolvedSkill["source"]): ResolvedSkill {
  const content = `---\nname: INVALID NAME WITH SPACES\ncategory: not-a-category\n---\n# bad`
  return { name, description: "", filePath: `/fake/${source}/${name}.md`, source, content }
}

function makeNoFrontmatterSkill(name: string, source: ResolvedSkill["source"]): ResolvedSkill {
  return {
    name,
    description: "",
    filePath: `/fake/${source}/${name}.md`,
    source,
    content: `# ${name}\nNo frontmatter.`,
  }
}

describe("doctorCommand", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("ok", { status: 200 })),
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("has correct name and description", () => {
    expect(doctorCommand.name).toBe("doctor")
    expect(doctorCommand.description).toBeTruthy()
  })

  it("execute returns a number", async () => {
    const exitCode = await doctorCommand.execute([])
    expect(typeof exitCode).toBe("number")
    expect([0, 1]).toContain(exitCode)
  })
})

describe("buildSkillHealthReport", () => {
  it("counts categories correctly", () => {
    const skills = new Map<string, ResolvedSkill>([
      ["reentrancy", makeSkill("reentrancy", "bundled", { category: "vulnerability-pattern" })],
      ["oracle", makeSkill("oracle", "bundled", { category: "vulnerability-pattern" })],
      ["audit-flow", makeSkill("audit-flow", "bundled", { category: "methodology" })],
      ["amm-dex", makeSkill("amm-dex", "bundled", { category: "protocol-pattern" })],
    ])
    const report = buildSkillHealthReport(skills)
    expect(report.categoryBreakdown["vulnerability-pattern"]).toBe(2)
    expect(report.categoryBreakdown.methodology).toBe(1)
    expect(report.categoryBreakdown["protocol-pattern"]).toBe(1)
    expect(report.categoryBreakdown.checklist).toBe(0)
    expect(report.categoryBreakdown.reference).toBe(0)
  })

  it("counts trust tiers correctly", () => {
    const skills = new Map<string, ResolvedSkill>([
      ["a", makeSkill("a", "bundled", { category: "methodology" })],
      ["b", makeSkill("b", "bundled", { category: "methodology" })],
      ["c", makeSkill("c", "custom", { category: "checklist" })],
      ["d", makeSkill("d", "trailofbits", { category: "reference" })],
    ])
    const report = buildSkillHealthReport(skills)
    expect(report.trustTierBreakdown.bundled).toBe(2)
    expect(report.trustTierBreakdown.custom).toBe(1)
    expect(report.trustTierBreakdown.trailofbits).toBe(1)
  })

  it("detects duplicate skills from entries", () => {
    const skills = new Map<string, ResolvedSkill>([
      ["reentrancy", makeSkill("reentrancy", "bundled", { category: "vulnerability-pattern" })],
    ])
    const allEntries = [
      { name: "reentrancy", source: "bundled" },
      { name: "reentrancy", source: "custom" },
      { name: "oracle", source: "bundled" },
    ]
    const report = buildSkillHealthReport(skills, allEntries)
    expect(report.duplicates).toHaveLength(1)
    expect(report.duplicates.at(0)?.name).toBe("reentrancy")
    expect(report.duplicates.at(0)?.sources).toContain("bundled")
    expect(report.duplicates.at(0)?.sources).toContain("custom")
  })

  it("reports no duplicates when entries are unique", () => {
    const skills = new Map<string, ResolvedSkill>([
      ["a", makeSkill("a", "bundled", { category: "methodology" })],
    ])
    const allEntries = [
      { name: "a", source: "bundled" },
      { name: "b", source: "custom" },
    ]
    const report = buildSkillHealthReport(skills, allEntries)
    expect(report.duplicates).toHaveLength(0)
  })

  it("warns when required categories have 0 skills", () => {
    const skills = new Map<string, ResolvedSkill>([
      ["checky", makeSkill("checky", "bundled", { category: "checklist" })],
    ])
    const report = buildSkillHealthReport(skills)
    expect(report.missingCategories).toContain("vulnerability-pattern")
    expect(report.missingCategories).toContain("methodology")
  })

  it("does not warn when required categories are covered", () => {
    const skills = new Map<string, ResolvedSkill>([
      ["reentrancy", makeSkill("reentrancy", "bundled", { category: "vulnerability-pattern" })],
      ["audit-flow", makeSkill("audit-flow", "bundled", { category: "methodology" })],
    ])
    const report = buildSkillHealthReport(skills)
    expect(report.missingCategories).toHaveLength(0)
  })

  it("counts schema valid and invalid correctly", () => {
    const skills = new Map<string, ResolvedSkill>([
      ["good", makeSkill("good", "bundled", { category: "methodology", version: "1.0.0" })],
      ["bad", makeInvalidSkill("bad", "custom")],
      ["bare", makeNoFrontmatterSkill("bare", "bundled")],
    ])
    const report = buildSkillHealthReport(skills)
    expect(report.schemaValid).toBe(1)
    expect(report.schemaInvalid).toBe(1)
    expect(report.schemaSkipped).toBe(1)
    expect(report.invalidSkills).toHaveLength(1)
    expect(report.invalidSkills.at(0)?.name).toBe("bad")
  })

  it("initializes all category keys to 0", () => {
    const report = buildSkillHealthReport(new Map())
    for (const cat of ALL_CATEGORIES) {
      expect(report.categoryBreakdown[cat]).toBe(0)
    }
  })
})

describe("findDuplicateSkills", () => {
  it("returns empty array when no duplicates", () => {
    const entries = [
      { name: "a", source: "bundled" },
      { name: "b", source: "custom" },
    ]
    expect(findDuplicateSkills(entries)).toHaveLength(0)
  })

  it("detects skills present in multiple sources", () => {
    const entries = [
      { name: "reentrancy", source: "bundled" },
      { name: "reentrancy", source: "custom" },
      { name: "reentrancy", source: "trailofbits" },
      { name: "oracle", source: "bundled" },
    ]
    const dupes = findDuplicateSkills(entries)
    expect(dupes).toHaveLength(1)
    expect(dupes.at(0)?.name).toBe("reentrancy")
    expect(dupes.at(0)?.sources).toHaveLength(3)
  })

  it("ignores same-source duplicate entries", () => {
    const entries = [
      { name: "a", source: "bundled" },
      { name: "a", source: "bundled" },
    ]
    expect(findDuplicateSkills(entries)).toHaveLength(0)
  })
})

describe("enumerateArgusInstallCandidates", () => {
  it("includes the hoisted-cache path that shadows other installs", () => {
    const candidates = enumerateArgusInstallCandidates("/proj", "/home/me")
    const hoisted = candidates.find((c) => c.source === "hoisted-cache")
    expect(hoisted?.path).toBe("/home/me/.cache/opencode/node_modules/solidity-argus")
  })

  it("includes the canonical package-cache path", () => {
    const candidates = enumerateArgusInstallCandidates("/proj", "/home/me")
    const pkg = candidates.find((c) => c.source === "package-cache")
    expect(pkg?.path).toBe(
      "/home/me/.cache/opencode/packages/solidity-argus@latest/node_modules/solidity-argus",
    )
  })

  it("includes the project-local node_modules path", () => {
    const candidates = enumerateArgusInstallCandidates("/proj", "/home/me")
    const local = candidates.find((c) => c.source === "project-local")
    expect(local?.path).toBe("/proj/node_modules/solidity-argus")
  })
})

describe("detectInstallDrift", () => {
  const current: ArgusInstall = { source: "current", path: "/canonical", version: "0.5.8" }

  it("returns no errors or warnings when no installs are found", () => {
    const result = detectInstallDrift(current, [])
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it("returns no errors when hoisted and package-cache versions match", () => {
    const result = detectInstallDrift(current, [
      { source: "hoisted-cache", path: "/h", version: "0.5.8" },
      { source: "package-cache", path: "/p", version: "0.5.8" },
    ])
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it("returns an error when hoisted-cache shadows package-cache with a different version", () => {
    const result = detectInstallDrift(current, [
      { source: "hoisted-cache", path: "/h", version: "0.3.7" },
      { source: "package-cache", path: "/p", version: "0.5.8" },
    ])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("0.3.7")
    expect(result.errors[0]).toContain("0.5.8")
    expect(result.errors[0]).toContain("rm -rf")
    expect(result.errors[0]).toContain("/h")
  })

  it("returns a warning when only hoisted-cache exists and drifts from current", () => {
    const result = detectInstallDrift(current, [
      { source: "hoisted-cache", path: "/h", version: "0.3.7" },
    ])
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("0.3.7")
    expect(result.warnings[0]).toContain("0.5.8")
  })

  it("returns nothing when hoisted version equals current version", () => {
    const result = detectInstallDrift(current, [
      { source: "hoisted-cache", path: "/h", version: "0.5.8" },
    ])
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it("prefers error over warning when both conditions would trigger", () => {
    const result = detectInstallDrift(current, [
      { source: "hoisted-cache", path: "/h", version: "0.3.7" },
      { source: "package-cache", path: "/p", version: "0.5.8" },
    ])
    expect(result.errors).toHaveLength(1)
    expect(result.warnings).toHaveLength(0)
  })
})
