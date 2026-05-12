import { homedir } from "node:os"
import { dirname, join } from "node:path"

const DEFAULT_CACHE_DIR = join(homedir(), ".cache", "solidity-argus")

function normalizeOverride(value: string | undefined): string | null {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function getArgusCacheDir(): string {
  return normalizeOverride(process.env.ARGUS_CACHE_DIR) ?? DEFAULT_CACHE_DIR
}

export function getArgusLogFile(): string {
  return normalizeOverride(process.env.ARGUS_LOG_FILE) ?? join(getArgusCacheDir(), "argus.log")
}

export function getArgusLogDir(): string {
  return dirname(getArgusLogFile())
}

export function getScvdIndexPath(): string {
  return join(getArgusCacheDir(), "scvd-index.json")
}

export function getTrailOfBitsCacheDir(): string {
  return join(getArgusCacheDir(), "trailofbits-skills")
}

export function getGlobalRunIndexDir(): string {
  return join(getArgusCacheDir(), "runs")
}

export function getGlobalRunIndexFile(): string {
  return join(getGlobalRunIndexDir(), "index.jsonl")
}
