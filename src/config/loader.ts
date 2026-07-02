import { homedir } from "node:os"
import { join } from "node:path"
import type { z } from "zod"
import { HOOK_NAMES } from "../hooks/types"
import { deepMerge } from "../shared/deep-merge"
import { detectConfigFile, readJsoncFile } from "../shared/file-utils"
import { createLogger, type Logger } from "../shared/logger"
import { ArgusConfigSchema } from "./schema"
import type { ArgusConfig } from "./types"

const KNOWN_HOOK_NAMES: ReadonlySet<string> = new Set(HOOK_NAMES)

/** Returns the `disabled_hooks` entries that are not canonical Argus hook names. */
export function unknownDisabledHooks(disabledHooks: readonly string[]): string[] {
  return disabledHooks.filter((name) => !KNOWN_HOOK_NAMES.has(name))
}

function parseOrRecover(merged: Record<string, unknown>, logger: Logger): ArgusConfig {
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

  const sanitized: Record<string, unknown> = {}
  for (const [key, fieldSchema] of Object.entries(ArgusConfigSchema.shape)) {
    if (Object.hasOwn(merged, key)) {
      const fieldResult = (fieldSchema as z.ZodTypeAny).safeParse(merged[key])
      if (fieldResult.success) {
        sanitized[key] = fieldResult.data
      } else {
        const issues = fieldResult.error.issues.map((i) => i.message).join(", ")
        logger.error(`Invalid config field '${key}': ${issues}. Using default.`)
      }
    }
  }

  return ArgusConfigSchema.parse(sanitized)
}

export function _mergeConfigs(
  userRaw: Record<string, unknown> | null,
  projectRaw: Record<string, unknown> | null,
): ArgusConfig {
  const logger = createLogger()
  const merged = deepMerge(userRaw ?? {}, projectRaw ?? {}) as Record<string, unknown>

  // Project-level disabled_hooks REPLACES the user layer (last-wins) rather than
  // unioning, so a project can re-enable a user-disabled hook by setting it to [].
  if (projectRaw && Object.hasOwn(projectRaw, "disabled_hooks")) {
    merged.disabled_hooks = projectRaw.disabled_hooks
  }

  const config = parseOrRecover(merged, logger)

  for (const name of unknownDisabledHooks(config.disabled_hooks)) {
    logger.warn(
      `Unknown disabled_hooks entry '${name}' is not a canonical Argus hook name and will have no effect.`,
    )
  }

  return config
}

export function loadArgusConfig(projectDir: string): ArgusConfig {
  const userConfigDir = join(homedir(), ".config", "opencode")
  const userConfigInfo = detectConfigFile(userConfigDir)
  const userRaw = userConfigInfo.path ? readJsoncFile(userConfigInfo.path) : null

  const projectConfigInfo = detectConfigFile(projectDir)
  const projectRaw = projectConfigInfo.path ? readJsoncFile(projectConfigInfo.path) : null

  return _mergeConfigs(userRaw, projectRaw)
}
