import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs"
import { join } from "node:path"
import { stripJsoncComments } from "./jsonc-parser"
import { defaultRootResolver } from "./path-root-resolver"

export type ConfigFormat = "json" | "jsonc" | "none"

export interface ConfigFileInfo {
  path: string | null
  format: ConfigFormat
}

export function detectConfigFile(basePath: string): ConfigFileInfo {
  const rootCandidates = defaultRootResolver.readRoots(basePath).flatMap((rootPath) => [
    { path: join(rootPath, "solidity-argus.jsonc"), format: "jsonc" as const },
    { path: join(rootPath, "solidity-argus.json"), format: "json" as const },
  ])

  const candidates = [
    ...rootCandidates,
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

/** Read a UTF-8 file bounded to `maxBytes`; an oversized file is truncated (never fully buffered) and flagged `capped`. */
export function readTextCapped(
  filePath: string,
  maxBytes: number,
): { text: string; capped: boolean } {
  if (statSync(filePath).size <= maxBytes) {
    return { text: readFileSync(filePath, "utf-8"), capped: false }
  }
  const fd = openSync(filePath, "r")
  try {
    const buffer = Buffer.allocUnsafe(maxBytes)
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0)
    return { text: buffer.subarray(0, bytesRead).toString("utf-8"), capped: true }
  } finally {
    closeSync(fd)
  }
}
