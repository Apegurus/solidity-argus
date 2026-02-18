import { tool, type ToolContext } from "@opencode-ai/plugin"
import { loadArgusConfig } from "../config/loader"
import type { ArgusConfig } from "../config/types"
import { normalizeSkillName, resolveArgusSkills } from "../skills/argus-skill-resolver"

type ArgusSkillLoadArgs = {
  name: string
}

type ArgusSkillLoadDependencies = {
  loadConfig?: typeof loadArgusConfig
  resolveSkills?: typeof resolveArgusSkills
}

export async function executeArgusSkillLoad(
  args: ArgusSkillLoadArgs,
  context: ToolContext,
  deps: ArgusSkillLoadDependencies = {}
): Promise<string> {
  const projectDir = context.directory ?? context.worktree ?? process.cwd()
  const loadConfig = deps.loadConfig ?? loadArgusConfig
  const resolveSkills = deps.resolveSkills ?? resolveArgusSkills

  let config: ArgusConfig | undefined
  try {
    config = loadConfig(projectDir)
  } catch {
    config = undefined
  }

  const normalizedName = normalizeSkillName(args.name)
  const skills = resolveSkills(projectDir, config)
  const skill = skills.get(normalizedName)

  if (!skill) {
    const available = Array.from(skills.keys()).sort().join(", ")
    throw new Error(
      `Argus skill "${args.name}" not found (normalized: "${normalizedName}"). Available Argus skills: ${available || "none"}`
    )
  }

  return [
    `## Argus Skill: ${skill.name}`,
    "",
    `**Source**: ${skill.source}`,
    `**Path**: ${skill.filePath}`,
    skill.description ? `**Description**: ${skill.description}` : "",
    "",
    skill.content,
  ]
    .filter(Boolean)
    .join("\n")
}

export const argusSkillLoadTool = tool({
  description: "Load Argus security skill content with OMO-compatible discovery and native fallback.",
  args: {
    name: tool.schema
      .string()
      .describe("Skill name (e.g., reentrancy, oracle-manipulation, or vulnerability-patterns/reentrancy)."),
  },
  async execute(args, context) {
    return executeArgusSkillLoad(args, context)
  },
})
