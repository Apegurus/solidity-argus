import { describe, expect, test } from "bun:test"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"

const SKILL_PATH = join(import.meta.dir, "..", "..", "skills", "methodology", "refutation-rubric", "SKILL.md")

describe("refutation-rubric skill", () => {
  test("SKILL.md file exists", () => {
    expect(existsSync(SKILL_PATH)).toBe(true)
  })

  test("has valid frontmatter with required fields", () => {
    const raw = readFileSync(SKILL_PATH, "utf8")
    const match = raw.match(/^---\n([\s\S]*?)\n---/)
    expect(match).not.toBeNull()
    const fm = parseYaml(match![1])
    expect(fm.name).toBe("refutation-rubric")
    expect(typeof fm.description).toBe("string")
    expect(fm.description.length).toBeGreaterThan(40)
    expect(fm.category).toBe("methodology")
    expect(fm.source_url).toContain("pashov/skills")
  })

  test("contains all 4 gate headings", () => {
    const raw = readFileSync(SKILL_PATH, "utf8")
    expect(raw).toMatch(/##\s+Gate 1\s+—\s+Refutation/)
    expect(raw).toMatch(/##\s+Gate 2\s+—\s+Reachability/)
    expect(raw).toMatch(/##\s+Gate 3\s+—\s+Trigger/)
    expect(raw).toMatch(/##\s+Gate 4\s+—\s+Impact/)
  })

  test("specifies the rubric trace format", () => {
    const raw = readFileSync(SKILL_PATH, "utf8")
    expect(raw).toMatch(/##\s+Rubric Trace Format/)
    expect(raw).toContain("**Refutation quote:**")
  })

  test("specifies verdicts (CONFIRMED, DEMOTE, REJECTED)", () => {
    const raw = readFileSync(SKILL_PATH, "utf8")
    expect(raw).toContain("CONFIRMED")
    expect(raw).toContain("DEMOTE")
    expect(raw).toContain("REJECTED")
  })

  test("specifies confidence scoring rules with concrete deductions", () => {
    const raw = readFileSync(SKILL_PATH, "utf8")
    expect(raw).toMatch(/##\s+Confidence Scoring/)
    expect(raw).toMatch(/-20/)
    expect(raw).toMatch(/-15/)
    expect(raw).toMatch(/-10/)
    expect(raw).toMatch(/\b80\b/)
  })

  test("includes safe-patterns and do-not-report sections", () => {
    const raw = readFileSync(SKILL_PATH, "utf8")
    expect(raw).toMatch(/##\s+Safe Patterns/)
    expect(raw).toMatch(/##\s+Do Not Report/)
  })

  test("refutation-rubric is discoverable by argus-skill-resolver", async () => {
    const resolver = await import("../../src/skills/argus-skill-resolver")
    const skillsMap = resolver.resolveArgusSkills(
      join(import.meta.dir, "..", ".."),
    )
    const skill = skillsMap.get("refutation-rubric")
    expect(skill).toBeDefined()
    expect(skill?.name).toBe("refutation-rubric")

    const fmMatch = skill!.content.match(/^---\n([\s\S]*?)\n---/)
    expect(fmMatch).not.toBeNull()
    const fm = parseYaml(fmMatch![1])
    expect(fm.category).toBe("methodology")
  })

  test("audit-workflow skill references refutation-rubric", () => {
    const path = join(import.meta.dir, "..", "..", "skills", "methodology", "audit-workflow", "SKILL.md")
    const raw = readFileSync(path, "utf8")
    expect(raw).toContain("refutation-rubric")
  })
})
