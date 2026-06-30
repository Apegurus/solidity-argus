import type { ArgusConfig } from "../config/types"
import { type ResolvedSkill, resolveArgusSkills } from "./argus-skill-resolver"
import type { SkillFrontmatter } from "./skill-schema"

export type SkillSource = ResolvedSkill["source"]
export type SkillCategory = NonNullable<SkillFrontmatter["category"]>
export type SkillPatternCategory = NonNullable<SkillFrontmatter["pattern_category"]>

export type ResolvedSkillMetadata = {
  name: string
  description: string
  category?: SkillCategory
  pattern_category?: SkillPatternCategory
  source: SkillSource
  path: string
  has_detection_rules: boolean
  scanned_by_patterns: boolean
}

export type SkillMetadataFilters = {
  query?: string
  category?: string
  pattern_category?: string
  source?: string
  scanned_by_patterns?: boolean
}

export type SkillSummaryBucket = {
  count: number
  examples: string[]
}

export type SkillCatalogSummary = {
  categories: Record<string, SkillSummaryBucket>
  pattern_categories: Record<string, SkillSummaryBucket>
  sources: Record<string, SkillSummaryBucket>
}

export type SkillRecommendation = ResolvedSkillMetadata & {
  score: number
  reasons: string[]
}

const MAX_EXAMPLES_PER_BUCKET = 5

// Heuristic field weights for metadata recommendation ranking: a context token that
// matches a higher-weighted field is a stronger relevance signal. Hand-tuned, not
// learned — retune against tests/eval/ recall rather than by feel.
const FIELD_MATCH_WEIGHTS = {
  name: 10,
  patternCategory: 8,
  description: 5,
  category: 4,
  path: 2,
} as const
const SCANNED_BY_PATTERNS_SEED = 1

function hasDetectionRules(skill: ResolvedSkill): boolean {
  return (skill.detection_rules?.length ?? 0) > 0
}

export function toSkillMetadata(skill: ResolvedSkill): ResolvedSkillMetadata {
  const hasRules = hasDetectionRules(skill)
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.category ? { category: skill.category } : {}),
    ...(skill.pattern_category ? { pattern_category: skill.pattern_category } : {}),
    source: skill.source,
    path: skill.filePath,
    has_detection_rules: hasRules,
    scanned_by_patterns: Boolean(skill.pattern_category && hasRules),
  }
}

export function resolveArgusSkillMetadata(
  projectDir: string,
  argusConfig?: ArgusConfig,
  resolveSkills: typeof resolveArgusSkills = resolveArgusSkills,
): ResolvedSkillMetadata[] {
  return Array.from(resolveSkills(projectDir, argusConfig).values())
    .map(toSkillMetadata)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function normalizeText(value: string): string {
  return value.toLowerCase()
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1)
}

function metadataSearchText(skill: ResolvedSkillMetadata): string {
  return [
    skill.name,
    skill.description,
    skill.category ?? "",
    skill.pattern_category ?? "",
    skill.source,
    skill.path,
  ]
    .join(" ")
    .toLowerCase()
}

export function filterSkillMetadata(
  skills: ResolvedSkillMetadata[],
  filters: SkillMetadataFilters,
): ResolvedSkillMetadata[] {
  const queryTokens = tokenize(filters.query ?? "")
  return skills.filter((skill) => {
    if (filters.category && skill.category !== filters.category) return false
    if (filters.pattern_category && skill.pattern_category !== filters.pattern_category)
      return false
    if (filters.source && skill.source !== filters.source) return false
    if (
      typeof filters.scanned_by_patterns === "boolean" &&
      skill.scanned_by_patterns !== filters.scanned_by_patterns
    ) {
      return false
    }
    if (queryTokens.length > 0) {
      const searchText = metadataSearchText(skill)
      return queryTokens.every((token) => searchText.includes(token))
    }
    return true
  })
}

function addSummaryValue(
  buckets: Record<string, SkillSummaryBucket>,
  key: string | undefined,
  skillName: string,
): void {
  if (!key) return
  const bucket = buckets[key] ?? { count: 0, examples: [] }
  bucket.count += 1
  if (bucket.examples.length < MAX_EXAMPLES_PER_BUCKET) {
    bucket.examples.push(skillName)
  }
  buckets[key] = bucket
}

export function summarizeSkillMetadata(skills: ResolvedSkillMetadata[]): SkillCatalogSummary {
  const categories: Record<string, SkillSummaryBucket> = {}
  const patternCategories: Record<string, SkillSummaryBucket> = {}
  const sources: Record<string, SkillSummaryBucket> = {}

  for (const skill of skills) {
    addSummaryValue(categories, skill.category ?? "uncategorized", skill.name)
    addSummaryValue(patternCategories, skill.pattern_category, skill.name)
    addSummaryValue(sources, skill.source, skill.name)
  }

  return { categories, pattern_categories: patternCategories, sources }
}

function scoreTokenMatch(skill: ResolvedSkillMetadata, token: string): number {
  let score = 0
  if (skill.name.toLowerCase().includes(token)) score += FIELD_MATCH_WEIGHTS.name
  if (skill.pattern_category?.toLowerCase().includes(token))
    score += FIELD_MATCH_WEIGHTS.patternCategory
  if (skill.category?.toLowerCase().includes(token)) score += FIELD_MATCH_WEIGHTS.category
  if (skill.description.toLowerCase().includes(token)) score += FIELD_MATCH_WEIGHTS.description
  if (skill.path.toLowerCase().includes(token)) score += FIELD_MATCH_WEIGHTS.path
  return score
}

function recommendationReasons(skill: ResolvedSkillMetadata, contextTokens: string[]): string[] {
  const reasons: string[] = []
  const tokenSet = new Set(contextTokens)
  if (skill.pattern_category && tokenSet.has(skill.pattern_category.toLowerCase())) {
    reasons.push(`matched pattern category ${skill.pattern_category}`)
  }
  if (skill.category && tokenSet.has(skill.category.toLowerCase())) {
    reasons.push(`matched skill category ${skill.category}`)
  }
  for (const token of contextTokens) {
    if (skill.name.toLowerCase().includes(token)) {
      reasons.push(`matched skill name token ${token}`)
      break
    }
  }
  for (const token of contextTokens) {
    if (skill.description.toLowerCase().includes(token)) {
      reasons.push(`matched description token ${token}`)
      break
    }
  }
  if (skill.scanned_by_patterns) {
    reasons.push("has deterministic pattern rules")
  }
  return reasons.length > 0 ? reasons : ["metadata proximity match"]
}

export function recommendSkillMetadata(
  skills: ResolvedSkillMetadata[],
  context: string,
  limit: number,
): SkillRecommendation[] {
  const contextTokens = tokenize(context)
  return skills
    .map((skill) => {
      const score = contextTokens.reduce(
        (total, token) => total + scoreTokenMatch(skill, token),
        skill.scanned_by_patterns ? SCANNED_BY_PATTERNS_SEED : 0,
      )
      return {
        ...skill,
        score,
        reasons: recommendationReasons(skill, contextTokens),
      }
    })
    .filter((skill) => skill.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
}
