import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createLogger } from "../shared/logger"
import type { ResolvedSkill } from "../skills/argus-skill-resolver"
import { parseFrontmatter, SkillFrontmatterSchema } from "../skills/skill-schema"
import type { PatternDefinition } from "./pattern-schema"

const logger = createLogger()
const MAX_SKILL_REGEX_LENGTH = 1_000

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

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0
  for (let i = index - 1; i >= 0 && value[i] === "\\"; i -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}

function findGroupEnd(regex: string, startIndex: number): number {
  let depth = 0
  let inCharacterClass = false

  for (let i = startIndex; i < regex.length; i += 1) {
    const char = regex[i]
    if (!char || isEscaped(regex, i)) continue

    if (char === "[") {
      inCharacterClass = true
      continue
    }
    if (char === "]") {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass) continue

    if (char === "(") depth += 1
    if (char === ")") {
      depth -= 1
      if (depth === 0) return i
    }
  }

  return -1
}

function hasAnyQuantifier(regex: string): boolean {
  let inCharacterClass = false

  for (let i = 0; i < regex.length; i += 1) {
    const char = regex[i]
    if (!char || isEscaped(regex, i)) continue

    if (char === "[") {
      inCharacterClass = true
      continue
    }
    if (char === "]") {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass) continue

    if (char === "*" || char === "+" || char === "?") return true
    if (char === "{" && /^\{\d+,?\d*\}/.test(regex.slice(i))) return true
  }

  return false
}

function hasUnboundedQuantifierAt(regex: string, index: number): boolean {
  const char = regex[index]
  if (char === "*" || char === "+") return true
  if (char !== "{") return false

  return /^\{\d+,\}/.test(regex.slice(index))
}

function hasRepeatedQuantifierAt(regex: string, index: number): boolean {
  if (hasUnboundedQuantifierAt(regex, index)) return true

  const exact = regex.slice(index).match(/^\{(\d+)\}/)
  if (exact) return Number.parseInt(exact[1] ?? "0", 10) > 1

  const bounded = regex.slice(index).match(/^\{\d+,(\d+)\}/)
  return bounded ? Number.parseInt(bounded[1] ?? "0", 10) > 1 : false
}

function hasUnsafeRepeatedGroup(regex: string): boolean {
  let inCharacterClass = false

  for (let i = 0; i < regex.length; i += 1) {
    const char = regex[i]
    if (!char || isEscaped(regex, i)) continue

    if (char === "[") {
      inCharacterClass = true
      continue
    }
    if (char === "]") {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass || char !== "(") continue

    const end = findGroupEnd(regex, i)
    if (end === -1) return false

    const groupBody = regex.slice(i + 1, end)
    if (hasUnsafeRepeatedGroup(groupBody)) return true

    if (!hasRepeatedQuantifierAt(regex, end + 1)) {
      continue
    }

    if (groupBody.includes("|") || groupBody.includes("(") || hasAnyQuantifier(groupBody)) {
      return true
    }
  }

  return false
}

function hasLookaround(regex: string): boolean {
  let inCharacterClass = false

  for (let i = 0; i < regex.length; i += 1) {
    const char = regex[i]
    if (!char || isEscaped(regex, i)) continue

    if (char === "[") {
      inCharacterClass = true
      continue
    }
    if (char === "]") {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass || char !== "(") continue

    const next = regex.slice(i, i + 4)
    if (
      next.startsWith("(?=") ||
      next.startsWith("(?!") ||
      next.startsWith("(?<=") ||
      next.startsWith("(?<!")
    ) {
      return true
    }
  }

  return false
}

function regexSafetyError(regex: string): string | null {
  if (regex.length > MAX_SKILL_REGEX_LENGTH) {
    return `regex exceeds ${MAX_SKILL_REGEX_LENGTH} characters`
  }

  try {
    new RegExp(regex)
  } catch (error) {
    return `regex does not compile: ${error instanceof Error ? error.message : String(error)}`
  }

  if (/(^|[^\\])\\[1-9]/.test(regex)) {
    return "backreferences are not allowed in skill detection rules"
  }

  if (hasLookaround(regex)) {
    return "lookaround assertions are not allowed in skill detection rules"
  }

  if (hasUnsafeRepeatedGroup(regex)) {
    return "nested or ambiguous repeated groups are not allowed in skill detection rules"
  }

  return null
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
