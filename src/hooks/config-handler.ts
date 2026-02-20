import { resolve, join } from "node:path"
import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import type { Config } from "@opencode-ai/sdk/v2"
import type { ArgusConfig } from "../config/types"
import { DEFAULT_MODELS, DEFAULT_STEPS } from "../constants/defaults"
import { createLogger } from "../shared/logger"
import { createKnowledgeSyncHook } from "./knowledge-sync-hook"
import { ARGUS_PROMPT } from "../agents/argus-prompt"
import { SENTINEL_PROMPT } from "../agents/sentinel-prompt"
import { PYTHIA_PROMPT } from "../agents/pythia-prompt"
import { SCRIBE_PROMPT } from "../agents/scribe-prompt"

const TOB_CACHE_DIR = join(homedir(), ".cache", "solidity-argus", "trailofbits-skills")
const TOB_REPO_URL = "https://github.com/trailofbits/skills.git"
const TOB_BRANCH = "main"
let tobCloneInFlight = false

function getTrailOfBitsSkillsPaths(rootDir: string): string[] {
  const pluginsDir = join(rootDir, "plugins")
  if (!existsSync(pluginsDir)) return []

  const pluginEntries = readdirSync(pluginsDir, { withFileTypes: true })
  const skillDirs: string[] = []

  for (const entry of pluginEntries) {
    if (!entry.isDirectory()) continue
    const pluginSkillsDir = join(pluginsDir, entry.name, "skills")
    if (existsSync(pluginSkillsDir)) {
      skillDirs.push(pluginSkillsDir)
    }
  }

  return skillDirs
}

function ensureTrailOfBitsSkills(): string[] {
  if (existsSync(TOB_CACHE_DIR)) {
    return getTrailOfBitsSkillsPaths(TOB_CACHE_DIR)
  }

  if (!tobCloneInFlight) {
    tobCloneInFlight = true
    const cloneProcess = Bun.spawn(
      ["git", "clone", "--depth", "1", "--branch", TOB_BRANCH, TOB_REPO_URL, TOB_CACHE_DIR],
      {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      },
    )
    cloneProcess.exited
      .then((code) => {
        if (code !== 0) {
          const logger = createLogger()
          logger.warn(`Trail of Bits skills clone failed with exit code ${code}`)
        }
      })
      .finally(() => {
        tobCloneInFlight = false
      })
  }

    return []
}

export function createConfigHandler(
  argusConfig: ArgusConfig,
  projectDir: string = process.cwd()
): (config: Config) => Promise<void> {
  const triggerKnowledgeSync = createKnowledgeSyncHook(argusConfig)

  return async (config: Config): Promise<void> => {
    config.agent = {
      ...config.agent,
      argus: {
        mode: "primary",
        model: argusConfig.agents?.argus?.model ?? DEFAULT_MODELS.argus,
        steps: argusConfig.agents?.argus?.steps ?? DEFAULT_STEPS,
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
          skill: "allow",
        },
      },
      sentinel: {
        mode: "subagent",
        model: argusConfig.agents?.sentinel?.model ?? DEFAULT_MODELS.sentinel,
        steps: argusConfig.agents?.sentinel?.steps ?? DEFAULT_STEPS,
        description: "Static analysis and testing specialist",
        prompt: SENTINEL_PROMPT,
        permission: {
          argus_slither_analyze: "allow",
          argus_forge_test: "allow",
          argus_gas_analysis: "allow",
          argus_forge_fuzz: "allow",
          argus_analyze_contract: "allow",
          argus_check_patterns: "allow",
          argus_proxy_detection: "allow",
          argus_forge_coverage: "allow",
          argus_skill_load: "allow",
          skill: "allow",
        },
      },
      pythia: {
        mode: "subagent",
        model: argusConfig.agents?.pythia?.model ?? DEFAULT_MODELS.pythia,
        steps: argusConfig.agents?.pythia?.steps ?? DEFAULT_STEPS,
        description: "Vulnerability researcher",
        prompt: PYTHIA_PROMPT,
        permission: {
          argus_solodit_search: "allow",
          argus_check_patterns: "allow",
          argus_skill_load: "allow",
          skill: "allow",
        },
      },
      scribe: {
        mode: "subagent",
        model: argusConfig.agents?.scribe?.model ?? DEFAULT_MODELS.scribe,
        steps: argusConfig.agents?.scribe?.steps ?? DEFAULT_STEPS,
        description: "Audit report writer",
        prompt: SCRIBE_PROMPT,
        permission: {
          argus_generate_report: "allow",
          argus_skill_load: "allow",
          skill: "allow",
        },
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

    const customSkillsDir = argusConfig.knowledge?.customSkillsDir
    if (customSkillsDir) {
      const resolvedCustomSkillsDir = customSkillsDir.startsWith("/")
        ? customSkillsDir
        : resolve(projectDir, customSkillsDir)
      if (existsSync(resolvedCustomSkillsDir)) {
        skillsPaths.push(resolvedCustomSkillsDir)
      }
    }

    const tobSkillDirs = ensureTrailOfBitsSkills()
    if (tobSkillDirs.length > 0) skillsPaths.push(...tobSkillDirs)

    config.skills = {
      ...(config.skills ?? {}),
      paths: skillsPaths,
    }

    if (argusConfig.knowledge?.autoSync !== false) {
      triggerKnowledgeSync()
    }
  }
}
