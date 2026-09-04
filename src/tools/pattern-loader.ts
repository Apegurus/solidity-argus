import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createLogger } from "../shared/logger"
import type { ResolvedSkill } from "../skills/argus-skill-resolver"
import { parseFrontmatter, SkillFrontmatterSchema } from "../skills/skill-schema"
import type { PatternDefinition } from "./pattern-schema"
import { regexSafetyError } from "./regex-safety"

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

export interface PatternLoaderResult {
  patterns: PatternDefinition[]
  errors: string[]
}

function appendSkillDetectionRules(
  extracted: PatternDefinition[],
  errors: string[],
  skillName: string,
  category: PatternDefinition["category"] | undefined,
  rules: ResolvedSkill["detection_rules"],
): void {
  if (!category) return
  if (!rules || rules.length === 0) return

  for (const [index, rule] of rules.entries()) {
    const name = `${skillName}-rule-${index + 1}`
    const safetyError = regexSafetyError(rule.regex)
    if (safetyError) {
      const msg = `Skipped unsafe detection rule ${name}: ${safetyError}`
      logger.warn(msg)
      errors.push(msg)
      continue
    }

    const unsafeExclude = rule.exclude_if?.find((exclude) => regexSafetyError(exclude))
    if (unsafeExclude) {
      const msg = `Skipped unsafe detection rule ${name}: exclude_if ${regexSafetyError(
        unsafeExclude,
      )}`
      logger.warn(msg)
      errors.push(msg)
      continue
    }

    extracted.push({
      name,
      category,
      severity: rule.severity,
      confidence: rule.confidence ?? "Medium",
      version: "1.0",
      regex: rule.regex,
      description: rule.description ?? `Detection rule from ${skillName} SKILL.md`,
      ...(rule.swc ? { swc: rule.swc } : {}),
      ...(rule.exclude_if ? { exclude_if: rule.exclude_if } : {}),
    })
  }
}

export function extractDetectionRulesFromSkills(skillsDir: string): PatternLoaderResult {
  const skillFiles = listSkillMarkdownFiles(skillsDir)
  const extracted: PatternDefinition[] = []
  const errors: string[] = []

  for (const filePath of skillFiles) {
    try {
      const content = readFileSync(filePath, "utf-8")
      const frontmatter = parseFrontmatter(content)
      if (!frontmatter) continue

      const parsed = SkillFrontmatterSchema.safeParse(frontmatter)
      if (!parsed.success) {
        const reason = parsed.error.issues.map((i) => i.message).join("; ")
        const msg = `Failed to parse ${filePath}: ${reason}`
        logger.warn(msg)
        errors.push(msg)
        continue
      }

      const skillName = parsed.data.name
      if (parsed.data.category !== "vulnerability-pattern") continue

      const category = parsed.data.pattern_category
      if (!category) continue

      appendSkillDetectionRules(extracted, errors, skillName, category, parsed.data.detection_rules)
    } catch (err) {
      const msg = `Failed to parse ${filePath}: ${err instanceof Error ? err.message : "parse error"}`
      logger.warn(msg)
      errors.push(msg)
    }
  }

  return { patterns: extracted, errors }
}

export function extractDetectionRulesFromResolvedSkills(
  skills: Iterable<ResolvedSkill>,
): PatternLoaderResult {
  const extracted: PatternDefinition[] = []
  const errors: string[] = []

  for (const skill of skills) {
    if (skill.category !== "vulnerability-pattern") continue

    appendSkillDetectionRules(
      extracted,
      errors,
      skill.name,
      skill.pattern_category,
      skill.detection_rules,
    )
  }

  return { patterns: extracted, errors }
}
