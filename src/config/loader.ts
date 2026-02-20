import { homedir } from "node:os"
import { join } from "node:path"
import { ArgusConfigSchema } from "./schema"
import type { ArgusConfig } from "./types"
import { detectConfigFile, readJsoncFile } from "../shared/file-utils"
import { deepMerge } from "../shared/deep-merge"
import { createLogger } from "../shared/logger"

export function _mergeConfigs(
  userRaw: Record<string, unknown> | null,
  projectRaw: Record<string, unknown> | null,
): ArgusConfig {
  const logger = createLogger()
  const merged = deepMerge(userRaw ?? {}, projectRaw ?? {})

  const result = ArgusConfigSchema.safeParse(merged)
  if (!result.success) {
    logger.warn("Invalid argus config, using defaults:", result.error.message)
    return ArgusConfigSchema.parse({})
  }

  return result.data
}

export function loadArgusConfig(projectDir: string): ArgusConfig {
  const userConfigDir = join(homedir(), ".config", "opencode")
  const userConfigInfo = detectConfigFile(userConfigDir)
  const userRaw = userConfigInfo.path ? readJsoncFile(userConfigInfo.path) : null

  const projectConfigInfo = detectConfigFile(projectDir)
  const projectRaw = projectConfigInfo.path
    ? readJsoncFile(projectConfigInfo.path)
    : null

  return _mergeConfigs(userRaw, projectRaw)
}
