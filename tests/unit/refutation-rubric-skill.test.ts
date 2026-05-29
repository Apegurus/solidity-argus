import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"

const SKILL_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "skills",
  "methodology",
  "refutation-rubric",
  "SKILL.md",
)

describe("refutation-rubric skill", () => {
  test("SKILL.md file exists", () => {
    expect(existsSync(SKILL_PATH)).toBe(true)
  })

  test("has valid frontmatter with required fields", () => {
    const raw = readFileSync(SKILL_PATH, "utf8")
    const match = raw.match(/^---\n([\s\S]*?)\n---/)
    expect(match).not.toBeNull()
    const captured = match?.[1] ?? ""
    const fm = parseYaml(captured)
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

  test("specifies all three verdicts (CONFIRMED, DEMOTED, REJECTED_DEMOTED)", () => {
    const raw = readFileSync(SKILL_PATH, "utf8")
    expect(raw).toContain("CONFIRMED")
    expect(raw).toContain("DEMOTED")
    expect(raw).toContain("REJECTED_DEMOTED")
  })

  test("does NOT instruct dropping findings", () => {
    const raw = readFileSync(SKILL_PATH, "utf8")
    // The new semantics never drop. These phrases from the prior version must be gone.
    expect(raw).not.toMatch(/\bdrop\b.*candidate/i)
    expect(raw).not.toMatch(/Do NOT call.*record_finding/i)
  })

  test("documents that REJECTED_DEMOTED caps at confidence ≤30", () => {
    const raw = readFileSync(SKILL_PATH, "utf8")
    expect(raw).toMatch(/REJECTED_DEMOTED[^\n]*30/)
  })

  test("specifies confidence scoring rules with concrete deductions", () => {
    const raw = readFileSync(SKILL_PATH, "utf8")
    expect(raw).toMatch(/##\s+Confidence Scoring/)
    expect(raw).toMatch(/-20/)
    expect(raw).toMatch(/-15/)
    expect(raw).toMatch(/-10/)
    expect(raw).toMatch(/\b80\b/)
  })

  test("Safe Patterns section now demotes rather than drops", () => {
    const raw = readFileSync(SKILL_PATH, "utf8")
    expect(raw).toMatch(/##\s+Safe Patterns.*do not silently drop/i)
    // Each Safe Pattern bullet documents a 'might still matter' escalation path
    expect(raw).toMatch(/might still matter/i)
  })

  test("Audit Noise section replaces Do Not Report and demotes rather than drops", () => {
    const raw = readFileSync(SKILL_PATH, "utf8")
    expect(raw).toMatch(/##\s+Audit Noise/)
    // 'admin-by-design' and 'centralization' are always-record categories
    expect(raw).toMatch(/Admin privileges that are by design/i)
    expect(raw).toMatch(/always record/i)
  })

  test("refutation-rubric is discoverable by argus-skill-resolver", async () => {
    const resolver = await import("../../src/skills/argus-skill-resolver")
    const skillsMap = resolver.resolveArgusSkills(join(import.meta.dir, "..", ".."))
    const skill = skillsMap.get("refutation-rubric")
    expect(skill).toBeDefined()
    expect(skill?.name).toBe("refutation-rubric")

    const fmMatch = skill?.content.match(/^---\n([\s\S]*?)\n---/)
    expect(fmMatch).not.toBeNull()
    const fm = parseYaml(fmMatch?.[1] ?? "")
    expect(fm.category).toBe("methodology")
  })

  test("audit-workflow skill references refutation-rubric", () => {
    const path = join(
      import.meta.dir,
      "..",
      "..",
      "skills",
      "methodology",
      "audit-workflow",
      "SKILL.md",
    )
    const raw = readFileSync(path, "utf8")
    expect(raw).toContain("refutation-rubric")
  })

  test("Rubric Trace Format requires Verdict line in header", () => {
    const raw = readFileSync(SKILL_PATH, "utf8")
    expect(raw).toMatch(/Verdict:\s*<CONFIRMED\|DEMOTED\|REJECTED_DEMOTED>/)
  })
})
