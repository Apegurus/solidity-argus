import { parse as parseYaml } from "yaml"
import { z } from "zod"
import { createLogger } from "../shared/logger"
import { PATTERN_CATEGORIES } from "../tools/pattern-schema"

const logger = createLogger()

export const DetectionRuleSchema = z.object({
  regex: z.string(),
  severity: z.enum(["Critical", "High", "Medium", "Low", "Informational"]),
  confidence: z.enum(["High", "Medium", "Low"]).optional(),
  swc: z.string().optional(),
  description: z.string().optional(),
})

export const SkillFrontmatterSchema = z.object({
  name: z
    .string()
    .min(1, "Skill name is required")
    .max(128, "Skill name must be 128 characters or fewer")
    .regex(/^[a-z0-9-]+$/, "Must be lowercase slug format (a-z, 0-9, hyphens only)"),
  description: z.string().max(1024).default(""),
  version: z
    .string()
    .regex(/^\d+\.\d+(\.\d+)?$/, "Must be semver format (e.g. 1.0.0)")
    .optional(),
  deprecated: z.boolean().optional(),
  replacement: z.string().optional(),
  category: z
    .enum(["vulnerability-pattern", "methodology", "protocol-pattern", "checklist", "reference"])
    .optional(),
  source_url: z.string().url().optional(),
  source_license: z.string().optional(),
  imported_at: z.string().optional(),
  source_hash: z.string().optional(),
  detection_rules: z.array(DetectionRuleSchema).optional(),
  pattern_category: z.enum(PATTERN_CATEGORIES).optional(),
})

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>

export function validateSkillFrontmatter(
  frontmatter: Record<string, unknown>,
): { success: true; data: SkillFrontmatter } | { success: false; errors: string[] } {
  const result = SkillFrontmatterSchema.safeParse(frontmatter)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return {
    success: false,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "root"
      return `${path}: ${issue.message}`
    }),
  }
}

export function parseFrontmatter(content: string): Record<string, unknown> | null {
  const fenceMatch = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/)
  if (!fenceMatch?.[1]) return null

  const raw = fenceMatch[1]

  if (raw.includes("detection_rules:")) {
    try {
      const parsed = parseYaml(raw)
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, unknown>
      }
    } catch {
      logger.debug("YAML frontmatter parse failed, falling back to line parser")
    }
  }

  const lines = raw.split(/\r?\n/)
  const result: Record<string, unknown> = {}

  for (const line of lines) {
    const kvMatch = line.match(/^([\w][\w-]*):\s*(.*)$/)
    if (!kvMatch) continue

    const key = kvMatch[1] ?? ""
    let raw = kvMatch[2]?.trim() ?? ""

    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1)
    }

    if (raw === "true") {
      result[key] = true
    } else if (raw === "false") {
      result[key] = false
    } else {
      result[key] = raw
    }
  }

  return Object.keys(result).length > 0 ? result : null
}
