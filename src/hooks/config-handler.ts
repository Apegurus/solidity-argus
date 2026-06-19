import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { Config } from "@opencode-ai/sdk/v2"
import { ARGUS_PROMPT } from "../agents/argus-prompt"
import { AUDIT_SPECIALIST_PROMPT } from "../agents/audit-specialist-prompt"
import { PYTHIA_PROMPT } from "../agents/pythia-prompt"
import { SCRIBE_PROMPT } from "../agents/scribe-prompt"
import { SENTINEL_PROMPT } from "../agents/sentinel-prompt"
import { THEMIS_PROMPT } from "../agents/themis-prompt"
import type { ArgusConfig } from "../config/types"
import { DEFAULT_MODELS, DEFAULT_STEPS } from "../constants/defaults"
import { getTrailOfBitsCacheDir } from "../shared/cache-paths"
import { createLogger } from "../shared/logger"
import { createKnowledgeSyncHook } from "./knowledge-sync-hook"

const TOB_REPO_URL = "https://github.com/trailofbits/skills.git"
const TOB_BRANCH = "main"
let tobCloneInFlight = false
let tobCloneStartedAt: number | null = null
const TOB_CLONE_STUCK_TIMEOUT_MS = 120_000

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
  const cacheDir = getTrailOfBitsCacheDir()

  if (existsSync(cacheDir)) {
    return getTrailOfBitsSkillsPaths(cacheDir)
  }

  // Reset stuck flag if clone has been in-flight for more than 120 seconds
  if (
    tobCloneInFlight &&
    tobCloneStartedAt !== null &&
    Date.now() - tobCloneStartedAt > TOB_CLONE_STUCK_TIMEOUT_MS
  ) {
    const logger = createLogger()
    logger.warn(
      `Trail of Bits skills clone flag stuck for >${TOB_CLONE_STUCK_TIMEOUT_MS / 1000}s — resetting (URL: ${TOB_REPO_URL}, dir: ${cacheDir})`,
    )
    tobCloneInFlight = false
    tobCloneStartedAt = null
  }

  if (!tobCloneInFlight) {
    tobCloneInFlight = true
    tobCloneStartedAt = Date.now()
    let cloneProcess: ReturnType<typeof Bun.spawn>
    try {
      cloneProcess = Bun.spawn(
        ["git", "clone", "--depth", "1", "--branch", TOB_BRANCH, TOB_REPO_URL, cacheDir],
        {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
          signal: AbortSignal.timeout(60_000),
        },
      )
    } catch (spawnErr) {
      const logger = createLogger()
      logger.error(
        `Trail of Bits skills clone spawn failed (URL: ${TOB_REPO_URL}, dir: ${cacheDir}): ${spawnErr instanceof Error ? spawnErr.message : String(spawnErr)}`,
      )
      tobCloneInFlight = false
      tobCloneStartedAt = null
      return []
    }
    cloneProcess.exited
      .then((code) => {
        if (code !== 0) {
          const logger = createLogger()
          logger.warn(
            `Trail of Bits skills clone failed with exit code ${code} (URL: ${TOB_REPO_URL}, dir: ${cacheDir})`,
          )
        }
      })
      .catch((err) => {
        const logger = createLogger()
        logger.error(
          `Trail of Bits skills clone process error (URL: ${TOB_REPO_URL}, dir: ${cacheDir}): ${err instanceof Error ? err.message : String(err)}`,
        )
      })
      .finally(() => {
        tobCloneInFlight = false
        tobCloneStartedAt = null
      })
  }

  return []
}

export function createConfigHandler(argusConfig: ArgusConfig): (config: Config) => Promise<void> {
  const triggerKnowledgeSync = createKnowledgeSyncHook(argusConfig)

  return async (config: Config): Promise<void> => {
    config.agent ??= {}
    Object.assign(config.agent, {
      argus: {
        mode: "primary",
        model: argusConfig.agents?.argus?.model ?? DEFAULT_MODELS.argus,
        steps: argusConfig.agents?.argus?.steps ?? DEFAULT_STEPS,
        description: "Solidity security auditor — the All-Seeing Guardian",
        prompt: ARGUS_PROMPT,
        tools: {
          "argus_*": false,
          argus_list_skills: true,
          argus_recommend_skills: true,
          "solodit-mcp_*": false,
        },
        permission: {
          argus_list_skills: "allow",
          argus_recommend_skills: "allow",
          task: {
            sentinel: "allow",
            pythia: "allow",
            "audit-specialist": "allow",
            scribe: "allow",
            themis: "allow",
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
          argus_record_finding: "allow",
          argus_list_skills: "allow",
          argus_recommend_skills: "allow",
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
          argus_record_finding: "allow",
          argus_list_skills: "allow",
          argus_recommend_skills: "allow",
          argus_skill_load: "allow",
          skill: "allow",
        },
      },
      "audit-specialist": {
        mode: "subagent",
        model: argusConfig.agents?.auditSpecialist?.model ?? DEFAULT_MODELS.auditSpecialist,
        steps: argusConfig.agents?.auditSpecialist?.steps ?? DEFAULT_STEPS,
        description: "Profile-driven adversarial specialist auditor",
        prompt: AUDIT_SPECIALIST_PROMPT,
        permission: {
          argus_skill_load: "allow",
          argus_check_patterns: "allow",
          argus_solodit_search: "allow",
          argus_analyze_contract: "allow",
          argus_slither_analyze: "allow",
          argus_proxy_detection: "allow",
          argus_forge_test: "allow",
          argus_forge_fuzz: "allow",
          argus_forge_coverage: "allow",
          argus_gas_analysis: "allow",
          argus_record_finding: "allow",
          argus_list_skills: "allow",
          argus_recommend_skills: "allow",
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
          argus_read_findings: "allow",
          argus_generate_report: "allow",
          argus_persist_deduped: "allow",
          argus_skill_load: "allow",
          skill: "allow",
        },
      },
      themis: {
        mode: "subagent",
        model: argusConfig.agents?.themis?.model ?? DEFAULT_MODELS.themis,
        steps: argusConfig.agents?.themis?.steps ?? DEFAULT_STEPS,
        description: "Audit quality gate — independent cross-validation (GPT-5.5)",
        prompt: THEMIS_PROMPT,
        permission: {
          argus_read_findings: "allow",
          argus_solodit_search: "allow",
          argus_check_patterns: "allow",
          argus_list_skills: "allow",
          argus_recommend_skills: "allow",
          argus_skill_load: "allow",
          skill: "allow",
        },
      },
    })

    if (argusConfig.solodit?.enabled !== false) {
      const port = argusConfig.solodit?.port ?? 54173
      config.mcp ??= {}
      config.mcp["solodit-mcp"] = {
        type: "remote",
        url: `http://localhost:${port}/mcp`,
        enabled: true,
      }
    }

    // Argus skills load on demand via `argus_skill_load` (scoped to the Argus agents);
    // we deliberately do NOT register them in OpenCode's global `config.skills.paths`,
    // which would leak all bundled skill descriptions into every skill-enabled agent's
    // context. The call below is kept for its side effect only: it clones the Trail of
    // Bits companion skills into the cache that `argus_skill_load`'s resolver reads.
    ensureTrailOfBitsSkills()

    if (argusConfig.knowledge?.autoSync !== false) {
      triggerKnowledgeSync()
    }
  }
}
