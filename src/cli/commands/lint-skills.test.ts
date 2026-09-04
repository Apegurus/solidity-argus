import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { lintSkillFiles, lintSkillsCommand } from "./lint-skills"

describe("lintSkillFiles", () => {
  it("returns valid=0, invalid=0, skipped=0 for empty input", () => {
    const result = lintSkillFiles([])
    expect(result.valid).toBe(0)
    expect(result.invalid).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors).toEqual([])
  })

  it("counts files without frontmatter as skipped", () => {
    const skillFiles = [
      { path: "test1.md", content: "# No frontmatter\nJust content" },
      { path: "test2.md", content: "Another file\nwith no frontmatter" },
    ]
    const result = lintSkillFiles(skillFiles)
    expect(result.valid).toBe(0)
    expect(result.invalid).toBe(0)
    expect(result.skipped).toBe(2)
    expect(result.errors).toEqual([])
  })

  it("validates valid frontmatter", () => {
    const skillFiles = [
      {
        path: "valid.md",
        content: `---
name: test-skill
description: A test skill
version: 1.0.0
category: vulnerability-pattern
---
# Content`,
      },
    ]
    const result = lintSkillFiles(skillFiles)
    expect(result.valid).toBe(1)
    expect(result.invalid).toBe(0)
    expect(result.errors).toEqual([])
  })

  it("detects invalid frontmatter", () => {
    const skillFiles = [
      {
        path: "invalid.md",
        content: `---
name: "Invalid Name With Spaces"
description: Invalid skill
---
# Content`,
      },
    ]
    const result = lintSkillFiles(skillFiles)
    expect(result.valid).toBe(0)
    expect(result.invalid).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.file).toBe("invalid.md")
    expect(result.errors[0]?.errors.length).toBeGreaterThan(0)
  })

  it("reports multiple errors per file", () => {
    const skillFiles = [
      {
        path: "multi-error.md",
        content: `---
name: "Invalid Name"
version: invalid-version
category: unknown-category
---
# Content`,
      },
    ]
    const result = lintSkillFiles(skillFiles)
    expect(result.invalid).toBe(1)
    expect(result.errors[0]?.errors.length).toBeGreaterThanOrEqual(2)
  })

  it("handles mixed valid and invalid files", () => {
    const skillFiles = [
      {
        path: "valid.md",
        content: `---
name: valid-skill
---
# Content`,
      },
      {
        path: "invalid.md",
        content: `---
name: "Invalid Name"
---
# Content`,
      },
      { path: "no-fm.md", content: "# No frontmatter" },
    ]
    const result = lintSkillFiles(skillFiles)
    expect(result.valid).toBe(1)
    expect(result.invalid).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.errors).toHaveLength(1)
  })

  it("validates name field constraints", () => {
    const skillFiles = [
      {
        path: "empty-name.md",
        content: `---
name: ""
---
# Content`,
      },
    ]
    const result = lintSkillFiles(skillFiles)
    expect(result.invalid).toBe(1)
    expect(result.errors[0]?.errors[0]).toContain("name")
  })

  it("validates version semver format", () => {
    const skillFiles = [
      {
        path: "bad-version.md",
        content: `---
name: test-skill
version: not-a-version
---
# Content`,
      },
    ]
    const result = lintSkillFiles(skillFiles)
    expect(result.invalid).toBe(1)
    expect(result.errors[0]?.errors[0]).toContain("version")
  })

  it("accepts valid semver versions", () => {
    const skillFiles = [
      {
        path: "v1.md",
        content: `---
name: test-skill
version: 1.0.0
---
# Content`,
      },
      {
        path: "v2.md",
        content: `---
name: test-skill-2
version: 2.1.3
---
# Content`,
      },
    ]
    const result = lintSkillFiles(skillFiles)
    expect(result.valid).toBe(2)
    expect(result.invalid).toBe(0)
  })

  it("validates category enum", () => {
    const skillFiles = [
      {
        path: "bad-cat.md",
        content: `---
name: test-skill
category: invalid-category
---
# Content`,
      },
    ]
    const result = lintSkillFiles(skillFiles)
    expect(result.invalid).toBe(1)
    expect(result.errors[0]?.errors[0]).toContain("category")
  })

  it("accepts valid categories", () => {
    const categories = [
      "vulnerability-pattern",
      "methodology",
      "protocol-pattern",
      "checklist",
      "reference",
    ]
    const skillFiles = categories.map((cat) => ({
      path: `${cat}.md`,
      content: `---
name: test-${cat}
category: ${cat}
---
# Content`,
    }))
    const result = lintSkillFiles(skillFiles)
    expect(result.valid).toBe(categories.length)
    expect(result.invalid).toBe(0)
  })

  it("requires category only when a skill file is marked as bundled", () => {
    const content = `---
name: bundled-skill
description: Missing category
---
# Content`

    const customResult = lintSkillFiles([{ path: "custom/SKILL.md", content }])
    expect(customResult.valid).toBe(1)
    expect(customResult.invalid).toBe(0)

    const bundledResult = lintSkillFiles([
      {
        path: "skills/vulnerability-patterns/bundled-skill/SKILL.md",
        content,
        requireCategory: true,
      },
    ])
    expect(bundledResult.valid).toBe(0)
    expect(bundledResult.invalid).toBe(1)
    expect(bundledResult.errors[0]?.errors[0]).toContain("Bundled skills must declare category")
  })

  it("warns when detection_rules are present without a pattern_category", () => {
    const result = lintSkillFiles([
      {
        path: "inert.md",
        content: `---
name: inert-skill
category: vulnerability-pattern
detection_rules:
  - regex: "selfdestruct"
    severity: High
---
# Content`,
      },
    ])
    expect(result.valid).toBe(1)
    expect(result.invalid).toBe(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]?.file).toBe("inert.md")
    expect(result.warnings[0]?.warnings[0]).toContain("pattern_category")
  })

  it("does not warn when detection_rules have a pattern_category", () => {
    const result = lintSkillFiles([
      {
        path: "active.md",
        content: `---
name: active-skill
category: vulnerability-pattern
pattern_category: reentrancy
detection_rules:
  - regex: "selfdestruct"
    severity: High
---
# Content`,
      },
    ])
    expect(result.warnings).toHaveLength(0)
  })
})

describe("lintSkillsCommand", () => {
  const tempDirs: string[] = []
  const originalCwd = process.cwd

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "argus-lint-test-"))
    tempDirs.push(dir)
    return dir
  }

  beforeEach(() => {
    process.cwd = () => {
      return tempDirs[tempDirs.length - 1] ?? originalCwd()
    }
  })

  afterEach(() => {
    process.cwd = originalCwd
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  it("finds bundled skills", async () => {
    const dir = makeTempDir()
    mkdirSync(join(dir, ".opencode"), { recursive: true })
    process.cwd = () => dir
    const exitCode = await lintSkillsCommand.execute([])
    expect(exitCode).toBe(0)
  })

  it("detects invalid project skills", async () => {
    const dir = makeTempDir()
    const skillDir = join(dir, ".opencode", "skills", "bad-skill")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: Bad Skill Name!
description: This has an invalid name
---
# Content`,
    )
    process.cwd = () => dir
    const exitCode = await lintSkillsCommand.execute([])
    expect(exitCode).toBe(1)
  })

  it("validates project skills correctly", async () => {
    const dir = makeTempDir()
    const skillDir = join(dir, ".opencode", "skills", "test-skill")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: test-skill
description: "A valid test skill"
category: vulnerability-pattern
---
# Content`,
    )
    process.cwd = () => dir
    const exitCode = await lintSkillsCommand.execute([])
    expect(exitCode).toBe(0)
  })

  it("handles nested skill directories", async () => {
    const dir = makeTempDir()
    const nestedDir = join(dir, ".opencode", "skills", "patterns", "nested")
    mkdirSync(nestedDir, { recursive: true })
    writeFileSync(
      join(nestedDir, "SKILL.md"),
      `---
name: nested-skill
description: "A nested skill"
---
# Content`,
    )
    process.cwd = () => dir
    const exitCode = await lintSkillsCommand.execute([])
    expect(exitCode).toBe(0)
  })

  it("skips non-markdown files", async () => {
    const dir = makeTempDir()
    const skillsDir = join(dir, ".opencode", "skills")
    mkdirSync(skillsDir, { recursive: true })
    writeFileSync(join(skillsDir, "test.txt"), "not markdown")
    writeFileSync(join(skillsDir, "test.json"), '{"not": "markdown"}')
    process.cwd = () => dir
    const exitCode = await lintSkillsCommand.execute([])
    expect(exitCode).toBe(0)
  })

  it("continues on unreadable files", async () => {
    const dir = makeTempDir()
    const skillDir = join(dir, ".opencode", "skills", "valid-skill")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: valid-skill
description: "A valid skill"
---
# Content`,
    )
    process.cwd = () => dir
    const exitCode = await lintSkillsCommand.execute([])
    expect(exitCode).toBe(0)
  })
})
