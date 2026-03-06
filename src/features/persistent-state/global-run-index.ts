import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { createLogger } from "../../shared/logger"

const logger = createLogger()

const CACHE_DIR = join(homedir(), ".cache", "solidity-argus", "runs")
const INDEX_FILE = join(CACHE_DIR, "index.jsonl")

export type RunStatus = "active" | "finalized" | "failed"

export type RunIndexEntry = {
  runId: string
  opencodeSessionId?: string
  projectDir: string
  statePath: string
  journalPath: string
  startedAt: number
  phase: string
  findingsCount: number
  status?: RunStatus
  finalizedAt?: number
}

let dirEnsured = false

async function ensureDir(): Promise<void> {
  if (dirEnsured) return
  await mkdir(CACHE_DIR, { recursive: true })
  dirEnsured = true
}

export async function recordRun(entry: RunIndexEntry): Promise<void> {
  try {
    await ensureDir()
    appendFileSync(INDEX_FILE, `${JSON.stringify(entry)}\n`)
  } catch {
    logger.debug("Failed to write global run index entry")
  }
}

export async function updateRunStatus(runId: string, status: RunStatus): Promise<void> {
  try {
    await ensureDir()
    const update = { runId, status, finalizedAt: status === "finalized" ? Date.now() : undefined }
    appendFileSync(INDEX_FILE, `${JSON.stringify(update)}\n`)
  } catch {
    logger.debug("Failed to write run status update")
  }
}

const STALE_RUN_TTL_MS = 24 * 60 * 60 * 1000

export function resolveRunIdFromOpencodeSession(
  opencodeSessionId: string,
  projectDir?: string,
): string | null {
  if (typeof opencodeSessionId !== "string" || opencodeSessionId.length === 0) {
    return null
  }

  if (!existsSync(INDEX_FILE)) {
    return null
  }

  try {
    const raw = readFileSync(INDEX_FILE, "utf-8")
    const lines = raw.split("\n")
    const now = Date.now()

    const terminatedRunIds = new Set<string>()

    for (let idx = lines.length - 1; idx >= 0; idx--) {
      const line = lines[idx]
      if (!line || line.trim().length === 0) continue

      try {
        const parsed = JSON.parse(line) as Partial<RunIndexEntry> & { status?: RunStatus }

        if (parsed.status === "finalized" || parsed.status === "failed") {
          if (typeof parsed.runId === "string") {
            terminatedRunIds.add(parsed.runId)
          }
          continue
        }

        if (
          parsed.opencodeSessionId === opencodeSessionId &&
          typeof parsed.runId === "string" &&
          parsed.runId.length > 0 &&
          (!projectDir || parsed.projectDir === projectDir)
        ) {
          if (terminatedRunIds.has(parsed.runId)) {
            logger.debug(`Skipping terminated run ${parsed.runId}`)
            continue
          }

          if (typeof parsed.startedAt === "number" && now - parsed.startedAt > STALE_RUN_TTL_MS) {
            logger.debug(
              `Skipping stale run ${parsed.runId} (age: ${Math.round((now - parsed.startedAt) / 3600000)}h)`,
            )
            continue
          }

          return parsed.runId
        }
      } catch {
        logger.debug("Skipping malformed run index line")
      }
    }
  } catch {
    logger.debug("Failed to read global run index")
  }

  return null
}
