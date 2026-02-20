import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join, extname } from "node:path"
import { parse as parseYaml } from "yaml"
import { PatternPackSchema, type PatternDefinition } from "./pattern-schema"
import { createLogger } from "../shared/logger"
import { parseFrontmatter, SkillFrontmatterSchema } from "../skills/skill-schema"

const logger = createLogger()

const YAML_EXTENSIONS = new Set([".yaml", ".yml"])

const SKILL_NAME_TO_PATTERN_CATEGORY: Record<string, PatternDefinition["category"]> = {
  "reentrancy": "reentrancy",
  "access-control": "access-control",
  "oracle-manipulation": "oracle-manipulation",
  "flash-loan-attacks": "flash-loan",
  "delegatecall-untrusted-callee": "proxy",
  "authorization-txorigin": "access-control",
  "unchecked-return-values": "logic-error",
  "dos-revert": "dos",
  "overflow-underflow": "logic-error",
  "signature-malleability": "signature",
}

export function loadPatternPacks(patternsDir: string): PatternDefinition[] {
  if (!existsSync(patternsDir)) {
    logger.warn(`Patterns directory does not exist: ${patternsDir}`)
    return []
  }

  const entries = readdirSync(patternsDir).filter((f) =>
    YAML_EXTENSIONS.has(extname(f).toLowerCase())
  )

  const allPatterns: PatternDefinition[] = []

  for (const filename of entries) {
    const filePath = join(patternsDir, filename)
    try {
      const raw = readFileSync(filePath, "utf-8")
      const parsed = parseYaml(raw)
      const result = PatternPackSchema.safeParse(parsed)

      if (!result.success) {
        logger.warn(
          `Skipping ${filename}: schema validation failed — ${result.error.issues[0]?.message ?? "unknown"}`
        )
        continue
      }

      allPatterns.push(...result.data.patterns)
    } catch (err) {
      logger.warn(
        `Skipping ${filename}: ${err instanceof Error ? err.message : "parse error"}`
      )
    }
  }

  return allPatterns
}

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
      const category = SKILL_NAME_TO_PATTERN_CATEGORY[skillName]
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
      logger.warn(
        `Skipping ${filePath}: ${err instanceof Error ? err.message : "parse error"}`
      )
    }
  }

  return extracted
}

type BuiltinPattern = {
  name: string
  category: string
  severity: string
  regex: RegExp
  description: string
  exploitReference?: string
}

function isValidUrl(s: string): boolean {
  try {
    new URL(s)
    return true
  } catch {
    return false
  }
}

function builtinToDefinition(b: BuiltinPattern): PatternDefinition {
  return {
    name: b.name,
    category: b.category as PatternDefinition["category"],
    severity: b.severity as PatternDefinition["severity"],
    confidence: "Medium",
    version: "1.0",
    regex: b.regex.source,
    description: b.description,
    ...(b.exploitReference && isValidUrl(b.exploitReference)
      ? { exploit_ref: b.exploitReference }
      : {}),
  }
}

export function mergeWithBuiltins(
  yamlPatterns: PatternDefinition[],
  builtins: BuiltinPattern[],
  skillDetectionRules: PatternDefinition[] = []
): PatternDefinition[] {
  const mergedInputs = [...yamlPatterns, ...skillDetectionRules]
  const yamlByName = new Map(mergedInputs.map((p) => [p.name, p]))
  const merged: PatternDefinition[] = [...mergedInputs]

  for (const builtin of builtins) {
    if (!yamlByName.has(builtin.name)) {
      merged.push(builtinToDefinition(builtin))
    }
  }

  return merged
}
