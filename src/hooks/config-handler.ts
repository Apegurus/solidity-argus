import { resolve, join } from "node:path"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { execSync } from "node:child_process"
import type { Config } from "@opencode-ai/sdk/v2"
import type { ArgusConfig } from "../config/types"
import { DEFAULT_MODELS } from "../constants/defaults"
import { createKnowledgeSyncHook } from "./knowledge-sync-hook"
import { ARGUS_PROMPT } from "../agents/argus-prompt"
import { SENTINEL_PROMPT } from "../agents/sentinel-prompt"
import { PYTHIA_PROMPT } from "../agents/pythia-prompt"
import { SCRIBE_PROMPT } from "../agents/scribe-prompt"

const TOB_CACHE_DIR = join(homedir(), ".cache", "solidity-argus", "trailofbits-skills")
const TOB_REPO_URL = "https://github.com/trailofbits/skills.git"

function ensureTrailOfBitsSkills(): string | undefined {
  if (existsSync(TOB_CACHE_DIR)) return TOB_CACHE_DIR
  try {
    execSync(`git clone --depth 1 ${TOB_REPO_URL} "${TOB_CACHE_DIR}"`, {
      stdio: "ignore",
      timeout: 30_000,
    })
    return TOB_CACHE_DIR
  } catch (_e) {
    return undefined
  }
}

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
          "argus_*": false,
          "solodit-mcp_*": false,
        },
        permission: {
          task: {
            sentinel: "allow",
            pythia: "allow",
            scribe: "allow",
          },
        },
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

    if (argusConfig.solodit?.enabled !== false) {
      const port = argusConfig.solodit?.port ?? 3000
      config.mcp = {
        ...(config.mcp ?? {}),
        "solodit-mcp": {
          type: "remote",
          url: `http://localhost:${port}/mcp`,
          enabled: true,
        },
      }
    }

    const skillsPaths = [...(config.skills?.paths ?? [])]
    skillsPaths.push(resolve(import.meta.dir, "../../skills"))

    const tobDir = ensureTrailOfBitsSkills()
    if (tobDir) skillsPaths.push(tobDir)

    config.skills = {
      ...(config.skills ?? {}),
      paths: skillsPaths,
    }

    if (argusConfig.knowledge?.autoSync !== false) {
      triggerKnowledgeSync()
    }
  }
}
