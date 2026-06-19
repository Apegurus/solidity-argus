import { type ToolContext, tool } from "@opencode-ai/plugin"
import { loadArgusConfig } from "../config/loader"
import type { ArgusConfig } from "../config/types"
import { resolveProjectDir } from "../shared/project-utils"
import {
  filterSkillMetadata,
  recommendSkillMetadata,
  resolveArgusSkillMetadata,
  summarizeSkillMetadata,
} from "../skills/argus-skill-catalog"
import { resolveArgusSkills } from "../skills/argus-skill-resolver"

type ArgusListSkillsArgs = {
  query?: string
  category?: string
  pattern_category?: string
  source?: string
  scanned_by_patterns?: boolean
  limit?: number
}

type ArgusRecommendSkillsArgs = {
  context: string
  limit?: number
}

type SkillDiscoveryDependencies = {
  loadConfig?: typeof loadArgusConfig
  resolveSkills?: typeof resolveArgusSkills
}

const DEFAULT_LIST_LIMIT = 25
const DEFAULT_RECOMMEND_LIMIT = 8
const MAX_LIMIT = 200

function normalizeLimit(value: number | undefined, defaultValue: number): number {
  if (!Number.isFinite(value)) return defaultValue
  const integer = Math.trunc(value ?? defaultValue)
  return Math.min(Math.max(integer, 1), MAX_LIMIT)
}

function loadConfigSafely(
  projectDir: string,
  loadConfig: typeof loadArgusConfig,
): ArgusConfig | undefined {
  try {
    return loadConfig(projectDir)
  } catch {
    return undefined
  }
}

function resolveMetadata(
  context: ToolContext,
  deps: SkillDiscoveryDependencies,
): ReturnType<typeof resolveArgusSkillMetadata> {
  const projectDir = resolveProjectDir(context)
  const loadConfig = deps.loadConfig ?? loadArgusConfig
  const resolveSkills = deps.resolveSkills ?? resolveArgusSkills
  const config = loadConfigSafely(projectDir, loadConfig)
  return resolveArgusSkillMetadata(projectDir, config, resolveSkills)
}

export async function executeArgusListSkills(
  args: ArgusListSkillsArgs,
  context: ToolContext,
  deps: SkillDiscoveryDependencies = {},
): Promise<string> {
  const allSkills = resolveMetadata(context, deps)
  const filtered = filterSkillMetadata(allSkills, args)
  const limit = normalizeLimit(args.limit, DEFAULT_LIST_LIMIT)
  const skills = filtered.slice(0, limit)

  return JSON.stringify(
    {
      total: allSkills.length,
      matched: filtered.length,
      returned: skills.length,
      filters: args,
      ...summarizeSkillMetadata(filtered),
      skills,
    },
    null,
    2,
  )
}

export async function executeArgusRecommendSkills(
  args: ArgusRecommendSkillsArgs,
  context: ToolContext,
  deps: SkillDiscoveryDependencies = {},
): Promise<string> {
  const allSkills = resolveMetadata(context, deps)
  const limit = normalizeLimit(args.limit, DEFAULT_RECOMMEND_LIMIT)
  const recommendations = recommendSkillMetadata(allSkills, args.context, limit)

  return JSON.stringify(
    {
      total: allSkills.length,
      returned: recommendations.length,
      recommendations,
    },
    null,
    2,
  )
}

export const argusListSkillsTool = tool({
  description:
    "List Argus security skills as metadata-only catalog rows. Use before argus_skill_load when an exact skill name is unknown.",
  args: {
    query: tool.schema.string().optional(),
    category: tool.schema.string().optional(),
    pattern_category: tool.schema.string().optional(),
    source: tool.schema.string().optional(),
    scanned_by_patterns: tool.schema.boolean().optional(),
    limit: tool.schema.number().optional(),
  },
  async execute(args, context) {
    return executeArgusListSkills(args, context)
  },
})

export const argusRecommendSkillsTool = tool({
  description:
    "Recommend Argus security skills from Solidity/protocol context without loading full skill bodies.",
  args: {
    context: tool.schema
      .string()
      .describe("Short code/protocol context, filenames, imports, or contract profile summary."),
    limit: tool.schema.number().optional(),
  },
  async execute(args, context) {
    return executeArgusRecommendSkills(args, context)
  },
})
