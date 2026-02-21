import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { stripJsoncComments } from "./jsonc-parser"

export type ConfigFormat = "json" | "jsonc" | "none"

export interface ConfigFileInfo {
  path: string | null
  format: ConfigFormat
}

export function detectConfigFile(basePath: string): ConfigFileInfo {
  const candidates = [
    { path: join(basePath, ".opencode", "solidity-argus.jsonc"), format: "jsonc" as const },
    { path: join(basePath, ".opencode", "solidity-argus.json"), format: "json" as const },
    { path: join(basePath, "solidity-argus.jsonc"), format: "jsonc" as const },
    { path: join(basePath, "solidity-argus.json"), format: "json" as const },
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate.path)) {
      return {
        path: candidate.path,
        format: candidate.format,
      }
    }
  }

  return {
    path: null,
    format: "none",
  }
}

export function readJsoncFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) {
      return null
    }

    const content = readFileSync(filePath, "utf-8")

    if (!content.trim()) {
      return null
    }

    const stripped = stripJsoncComments(content)
    const parsed: unknown = JSON.parse(stripped)

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null
    }

    return parsed as Record<string, unknown>
  } catch (_error) {
    return null
  }
}
