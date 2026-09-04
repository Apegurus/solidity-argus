import { homedir } from "node:os"
import { join } from "node:path"
import { HOOK_NAMES } from "../hooks/types"
import { deepMerge } from "../shared/deep-merge"
import { detectConfigFile, readJsoncFile } from "../shared/file-utils"
import { createLogger, type Logger } from "../shared/logger"
import { ArgusConfigSchema } from "./schema"
import type { ArgusConfig } from "./types"

const KNOWN_HOOK_NAMES: ReadonlySet<string> = new Set(HOOK_NAMES)
const REMOVED_CONFIG_PATHS: ReadonlySet<string> = new Set([
  "agents.*.permission",
  "agents.*.tools",
  "tools.forgePath",
  "tools.slitherPath",
  "reporting.format",
  "reporting.gasAnalysis",
  "solodit.port",
  "hooks",
  "cli",
  "background",
])
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isRemovedConfigPath(path: string): boolean {
  const normalizedPath = path.replace(/agents\.[^.]+\./, "agents.*.")
  return REMOVED_CONFIG_PATHS.has(normalizedPath)
}

function warnRemovedConfigFields(value: unknown, logger: Logger, prefix = ""): void {
  if (!isRecord(value)) return

  for (const [key, nestedValue] of Object.entries(value)) {
    const path = prefix.length > 0 ? `${prefix}.${key}` : key
    if (isRemovedConfigPath(path)) {
      logger.warn(`Removed config field '${path}' is no longer supported. Ignoring.`)
    }
    warnRemovedConfigFields(nestedValue, logger, path)
  }
}

function deleteConfigPath(config: Record<string, unknown>, path: PropertyKey[]): boolean {
  if (path.length === 0) return false
  let parent = config
  for (const segment of path.slice(0, -1)) {
    const child = parent[String(segment)]
    if (!isRecord(child)) return false
    parent = child
  }
  return delete parent[String(path.at(-1))]
}

/** Returns the `disabled_hooks` entries that are not canonical Argus hook names. */
export function unknownDisabledHooks(disabledHooks: readonly string[]): string[] {
  return disabledHooks.filter((name) => !KNOWN_HOOK_NAMES.has(name))
}

function parseOrRecover(merged: Record<string, unknown>, logger: Logger): ArgusConfig {
  warnRemovedConfigFields(merged, logger)

  const result = ArgusConfigSchema.safeParse(merged)
  if (result.success) {
    return result.data
  }

  // Warn about unknown keys (typos like 'disbled_hooks' instead of 'disabled_hooks')
  const knownKeys = new Set(Object.keys(ArgusConfigSchema.shape))
  for (const key of Object.keys(merged)) {
    if (!knownKeys.has(key) && !isRemovedConfigPath(key)) {
      logger.warn(`Unknown config key '${key}' — did you mean a known field? Ignoring.`)
    }
  }

  const sanitized = Object.fromEntries(Object.entries(merged).filter(([key]) => knownKeys.has(key)))
  let recovered = ArgusConfigSchema.safeParse(sanitized)
  while (!recovered.success) {
    let removedInvalidValue = false
    for (const issue of recovered.error.issues) {
      if (issue.path.length === 0) continue
      logger.error(
        `Invalid config field '${issue.path.join(".")}': ${issue.message}. Using default.`,
      )
      removedInvalidValue = deleteConfigPath(sanitized, issue.path) || removedInvalidValue
    }
    if (!removedInvalidValue) return ArgusConfigSchema.parse({})
    recovered = ArgusConfigSchema.safeParse(sanitized)
  }

  return recovered.data
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
