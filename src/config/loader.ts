import { homedir } from "node:os"
import { join } from "node:path"
import type { z } from "zod"
import { deepMerge } from "../shared/deep-merge"
import { detectConfigFile, readJsoncFile } from "../shared/file-utils"
import { createLogger } from "../shared/logger"
import { ArgusConfigSchema } from "./schema"
import type { ArgusConfig } from "./types"

export function _mergeConfigs(
  userRaw: Record<string, unknown> | null,
  projectRaw: Record<string, unknown> | null,
): ArgusConfig {
  const logger = createLogger()
  const merged = deepMerge(userRaw ?? {}, projectRaw ?? {}) as Record<string, unknown>

  const result = ArgusConfigSchema.safeParse(merged)
  if (result.success) {
    return result.data
  }

  // Warn about unknown keys (typos like 'disbled_hooks' instead of 'disabled_hooks')
  const knownKeys = new Set(Object.keys(ArgusConfigSchema.shape))
  for (const key of Object.keys(merged)) {
    if (!knownKeys.has(key)) {
      logger.warn(`Unknown config key '${key}' — did you mean a known field? Ignoring.`)
    }
  }

  const invalidFields: string[] = []
  const sanitized: Record<string, unknown> = {}

  for (const [key, fieldSchema] of Object.entries(ArgusConfigSchema.shape)) {
    if (key in merged) {
      const fieldResult = (fieldSchema as z.ZodTypeAny).safeParse(merged[key])
      if (fieldResult.success) {
        sanitized[key] = merged[key]
      } else {
        invalidFields.push(key)
        const issues = fieldResult.error.issues.map((i) => i.message).join(", ")
        logger.error(`Invalid config field '${key}': ${issues}. Using default.`)
      }
    }
  }

  return ArgusConfigSchema.parse(sanitized)
}

export function loadArgusConfig(projectDir: string): ArgusConfig {
  const userConfigDir = join(homedir(), ".config", "opencode")
  const userConfigInfo = detectConfigFile(userConfigDir)
  const userRaw = userConfigInfo.path ? readJsoncFile(userConfigInfo.path) : null

  const projectConfigInfo = detectConfigFile(projectDir)
  const projectRaw = projectConfigInfo.path ? readJsoncFile(projectConfigInfo.path) : null

  return _mergeConfigs(userRaw, projectRaw)
}
