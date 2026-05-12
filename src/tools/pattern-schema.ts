import { z } from "zod"

/**
 * Canonical pattern category taxonomy.
 * Every builtin, YAML, and skill-derived pattern must belong to one of these.
 */
export const PATTERN_CATEGORIES = [
  "reentrancy",
  "oracle-manipulation",
  "flash-loan",
  "access-control",
  "erc4626",
  "proxy",
  "signature",
  "dos",
  "front-running",
  "governance",
  "token-standard",
  "gas-optimization",
  "logic-error",
  "delegatecall",
] as const

export const PatternCategorySchema = z.enum(PATTERN_CATEGORIES)

export const PatternDefinitionSchema = z.object({
  name: z.string().min(1).max(128),
  category: PatternCategorySchema,
  severity: z.enum(["Critical", "High", "Medium", "Low", "Informational"]),
  swc: z
    .string()
    .regex(/^SWC-\d+$/)
    .optional(),
  confidence: z.enum(["High", "Medium", "Low"]).default("Medium"),
  version: z.string().default("1.0"),
  regex: z.string().min(1),
  description: z.string().min(1),
  exploit_ref: z.string().url().optional(),
  remediation: z.string().optional(),
  context: z.enum(["function-body", "contract-body", "file-level"]).optional(),
  applies_to: z.array(z.string()).optional(),
  exclude_if: z.array(z.string()).optional(),
})

export type PatternDefinition = z.infer<typeof PatternDefinitionSchema>
export type PatternCategory = z.infer<typeof PatternCategorySchema>

export const PatternPackSchema = z.object({
  pack_name: z.string().optional(),
  pack_version: z.string().default("1.0"),
  patterns: z.array(PatternDefinitionSchema).min(1),
})

export type PatternPack = z.infer<typeof PatternPackSchema>
