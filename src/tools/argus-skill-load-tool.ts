import { type ToolContext, tool } from "@opencode-ai/plugin"
import { loadArgusConfig } from "../config/loader"
import type { ArgusConfig } from "../config/types"
import { resolveProjectDir } from "../shared/project-utils"
import { escapeMarkdown, fenceUntrusted, type TrustTier } from "../shared/untrusted-content"
import {
  normalizeSkillName,
  type ResolvedSkill,
  resolveArgusSkills,
} from "../skills/argus-skill-resolver"

type ArgusSkillLoadArgs = {
  name: string
}

type ArgusSkillLoadDependencies = {
  loadConfig?: typeof loadArgusConfig
  resolveSkills?: typeof resolveArgusSkills
}

function skillTrustTier(source: ResolvedSkill["source"]): TrustTier {
  if (source === "bundled") return "bundled"
  if (source === "trailofbits") return "companion"
  return "custom"
}

export async function executeArgusSkillLoad(
  args: ArgusSkillLoadArgs,
  context: ToolContext,
  deps: ArgusSkillLoadDependencies = {},
): Promise<string> {
  const projectDir = resolveProjectDir(context)
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
      `Argus skill "${args.name}" not found (normalized: "${normalizedName}"). Available Argus skills: ${available || "none"}`,
    )
  }

  const provenanceParts: string[] = []
  if (skill.source_license) provenanceParts.push(skill.source_license)
  if (skill.source_url) provenanceParts.push(skill.source_url)
  if (skill.imported_at) provenanceParts.push(`Imported: ${skill.imported_at}`)

  const provenanceLine =
    provenanceParts.length > 0 ? `[Provenance: ${provenanceParts.join(" | ")}]` : ""

  const trustTier = skillTrustTier(skill.source)
  const body =
    trustTier === "bundled"
      ? skill.content
      : fenceUntrusted(skill.content, {
          source: `argus-skill:${skill.source}:${skill.name}`,
          trustTier,
        })
  const descriptionLine = skill.description
    ? `**Description**: ${trustTier === "bundled" ? skill.description : escapeMarkdown(skill.description)}`
    : ""

  return [
    `## Argus Skill: ${skill.name} [Source: ${skill.source}]`,
    "",
    `**Source**: ${skill.source}`,
    `**Path**: ${skill.filePath}`,
    descriptionLine,
    provenanceLine,
    "",
    body,
  ]
    .filter(Boolean)
    .join("\n")
}

export const argusSkillLoadTool = tool({
  description:
    "Load Argus security skill content with OMO-compatible discovery and native fallback.",
  args: {
    name: tool.schema
      .string()
      .describe(
        "Skill name (e.g., reentrancy, oracle-manipulation, or vulnerability-patterns/reentrancy).",
      ),
  },
  async execute(args, context) {
    return executeArgusSkillLoad(args, context)
  },
})
