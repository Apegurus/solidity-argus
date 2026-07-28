import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs"
import { join } from "node:path"
import { createLogger } from "./logger"
import { defaultRootResolver } from "./path-root-resolver"

const logger = createLogger()

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

const MAX_CONFIG_BYTES = 512 * 1024

export type JsoncReadResult =
  | { status: "ok"; value: Record<string, unknown> }
  | { status: "missing" | "empty" | "too-large" | "invalid" }

export function readJsoncFileResult(filePath: string): JsoncReadResult {
  if (!existsSync(filePath)) {
    return { status: "missing" }
  }
  let content: string
  let capped: boolean
  try {
    ;({ text: content, capped } = readTextCapped(filePath, MAX_CONFIG_BYTES))
  } catch {
    return { status: "invalid" }
  }
  if (capped) {
    return { status: "too-large" }
  }
  if (!content.trim()) {
    return { status: "empty" }
  }
  let parsed: unknown
  try {
    parsed = Bun.JSONC.parse(content)
  } catch {
    return { status: "invalid" }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { status: "invalid" }
  }
  return { status: "ok", value: parsed as Record<string, unknown> }
}

export function readJsoncFile(filePath: string): Record<string, unknown> | null {
  const result = readJsoncFileResult(filePath)
  if (result.status === "ok") {
    return result.value
  }
  if (result.status === "too-large" || result.status === "invalid") {
    const reason =
      result.status === "too-large"
        ? `exceeds the ${MAX_CONFIG_BYTES}-byte limit`
        : "is not valid JSONC or not a JSON object"
    logger.warn(`Ignoring config file ${filePath}: it ${reason} — falling back to defaults`)
  }
  return null
}

/**
 * Read a UTF-8 regular file bounded to `maxBytes` from a SINGLE fd — no stat-then-read
 * TOCTOU window, and never buffers more than `maxBytes` regardless of the real size
 * (flagged `capped`). Throws on a non-regular file (symlink-to-device/FIFO/dir), so a
 * special file cannot bypass the cap or block on an unbounded read.
 */
export function readTextCapped(
  filePath: string,
  maxBytes: number,
): { text: string; capped: boolean } {
  const fd = openSync(filePath, "r")
  try {
    const stats = fstatSync(fd)
    if (!stats.isFile()) {
      throw new Error(`not a regular file: ${JSON.stringify(filePath)}`)
    }
    const buffer = Buffer.allocUnsafe(maxBytes)
    let bytesRead = 0
    while (bytesRead < maxBytes) {
      const n = readSync(fd, buffer, bytesRead, maxBytes - bytesRead, bytesRead)
      if (n === 0) {
        break
      }
      bytesRead += n
    }
    return { text: buffer.subarray(0, bytesRead).toString("utf-8"), capped: stats.size > maxBytes }
  } finally {
    closeSync(fd)
  }
}
