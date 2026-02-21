import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createLogger } from "../shared/logger"
import { parseFrontmatter, SkillFrontmatterSchema } from "../skills/skill-schema"
import type { PatternDefinition } from "./pattern-schema"

const logger = createLogger()

function listSkillMarkdownFiles(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) {
    logger.warn(`Skills directory does not exist: ${skillsDir}`)
    return []
  }

  const files: string[] = []
  const stack = [skillsDir]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    const entries = readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }

      if (entry.isFile() && entry.name === "SKILL.md") {
        files.push(fullPath)
      }
    }
  }

  return files
}

export function extractDetectionRulesFromSkills(skillsDir: string): PatternDefinition[] {
  const skillFiles = listSkillMarkdownFiles(skillsDir)
  const extracted: PatternDefinition[] = []

  for (const filePath of skillFiles) {
    try {
      const content = readFileSync(filePath, "utf-8")
      const frontmatter = parseFrontmatter(content)
      if (!frontmatter) continue

      const parsed = SkillFrontmatterSchema.safeParse(frontmatter)
      if (!parsed.success) continue

      const skillName = parsed.data.name
      const category = parsed.data.pattern_category
      if (!category) continue

      const rules = parsed.data.detection_rules
      if (!rules || rules.length === 0) continue

      for (const [index, rule] of rules.entries()) {
        extracted.push({
          name: `${skillName}-rule-${index + 1}`,
          category,
          severity: rule.severity,
          confidence: rule.confidence ?? "Medium",
          version: "1.0",
          regex: rule.regex,
          description: rule.description ?? `Detection rule from ${skillName} SKILL.md`,
          ...(rule.swc ? { swc: rule.swc } : {}),
        })
      }
    } catch (err) {
      logger.warn(`Skipping ${filePath}: ${err instanceof Error ? err.message : "parse error"}`)
    }
  }

  return extracted
}
