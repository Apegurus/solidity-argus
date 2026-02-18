import { resolve } from "node:path"
import type { Config } from "@opencode-ai/sdk"
import type { ArgusConfig } from "../plugin-config"
import { DEFAULT_MODELS } from "../constants/defaults"
import { createKnowledgeSyncHook } from "./knowledge-sync-hook"
import { ARGUS_PROMPT } from "../agents/argus-prompt"
import { SENTINEL_PROMPT } from "../agents/sentinel-prompt"
import { PYTHIA_PROMPT } from "../agents/pythia-prompt"
import { SCRIBE_PROMPT } from "../agents/scribe-prompt"

export function createConfigHandler(
  argusConfig: ArgusConfig
): (config: Config) => Promise<void> {
  const triggerKnowledgeSync = createKnowledgeSyncHook(argusConfig)

  return async (config: Config): Promise<void> => {
    config.agent = {
      ...config.agent,
      argus: {
        mode: "primary",
        model: argusConfig.agents?.argus?.model ?? DEFAULT_MODELS.argus,
        description: "Solidity security auditor — the All-Seeing Guardian",
        prompt: ARGUS_PROMPT,
        tools: {
          argus_slither_analyze: true,
          argus_forge_test: true,
          argus_forge_fuzz: true,
          argus_analyze_contract: true,
          argus_check_patterns: true,
          argus_solodit_search: true,
          argus_generate_report: true,
          argus_sync_knowledge: true,
        } satisfies Record<string, boolean>,
      },
      sentinel: {
        mode: "subagent",
        model: argusConfig.agents?.sentinel?.model ?? DEFAULT_MODELS.sentinel,
        description: "Static analysis and testing specialist",
        prompt: SENTINEL_PROMPT,
        tools: {
          argus_slither_analyze: true,
          argus_forge_test: true,
          argus_forge_fuzz: true,
          argus_analyze_contract: true,
          argus_check_patterns: true,
        } satisfies Record<string, boolean>,
      },
      pythia: {
        mode: "subagent",
        model: argusConfig.agents?.pythia?.model ?? DEFAULT_MODELS.pythia,
        description: "Vulnerability researcher",
        prompt: PYTHIA_PROMPT,
        tools: {
          argus_solodit_search: true,
          argus_check_patterns: true,
        } satisfies Record<string, boolean>,
      },
      scribe: {
        mode: "subagent",
        model: argusConfig.agents?.scribe?.model ?? DEFAULT_MODELS.scribe,
        description: "Audit report writer",
        prompt: SCRIBE_PROMPT,
        tools: {
          argus_generate_report: true,
        } satisfies Record<string, boolean>,
      },
    }

    // Register Solodit MCP server
    if (argusConfig.solodit?.enabled !== false) {
      config.mcp = {
        ...(config.mcp ?? {}),
        "solodit-mcp": {
          type: "local",
          command: ["npx", "-y", "@lyuboslavlyubenov/solodit-mcp"],
          enabled: true,
          timeout: 10000,
        },
      }
    }

    // Register plugin skills directory
    const pluginSkillsDir = resolve(import.meta.dir, "../../skills")
    const configWithSkills = config as Config & {
      skills?: { paths?: string[] }
    }
    configWithSkills.skills = {
      ...(configWithSkills.skills ?? {}),
      paths: [...(configWithSkills.skills?.paths ?? []), pluginSkillsDir],
    }

    if (argusConfig.knowledge?.autoSync !== false) {
      triggerKnowledgeSync()
    }
  }
}
