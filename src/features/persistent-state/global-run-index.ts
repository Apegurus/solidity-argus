import { existsSync, readFileSync, statSync } from "node:fs"
import { appendFile, mkdir, writeFile } from "node:fs/promises"
import { getGlobalRunIndexDir, getGlobalRunIndexFile } from "../../shared/cache-paths"
import { createLogger } from "../../shared/logger"

const logger = createLogger()

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
  await mkdir(getGlobalRunIndexDir(), { recursive: true })
  dirEnsured = true
}

export async function recordRun(entry: RunIndexEntry): Promise<void> {
  try {
    await ensureDir()
    await appendFile(getGlobalRunIndexFile(), `${JSON.stringify(entry)}\n`)
    await compactRunIndexIfOversized()
  } catch {
    logger.debug("Failed to write global run index entry")
  }
}

const MAX_RUN_INDEX_BYTES = 1 * 1024 * 1024
const RUN_INDEX_KEEP_ENTRIES = 500

// The index is append-only (a line per run + status update); left unbounded it grows without limit
// and resolveRunIdFromOpencodeSession re-reads all of it. Compaction rewrites the file to its most
// recent entries once it crosses the byte budget — dropped entries are old (stale/terminated).
export async function compactRunIndex(keepEntries: number): Promise<void> {
  const file = getGlobalRunIndexFile()
  try {
    const lines = readFileSync(file, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
    if (lines.length <= keepEntries) return
    await writeFile(file, `${lines.slice(-keepEntries).join("\n")}\n`)
  } catch {
    logger.debug("Failed to compact global run index")
  }
}

async function compactRunIndexIfOversized(): Promise<void> {
  const file = getGlobalRunIndexFile()
  if (existsSync(file) && statSync(file).size > MAX_RUN_INDEX_BYTES) {
    await compactRunIndex(RUN_INDEX_KEEP_ENTRIES)
  }
}

export async function updateRunStatus(runId: string, status: RunStatus): Promise<void> {
  try {
    await ensureDir()
    const update = { runId, status, finalizedAt: status === "finalized" ? Date.now() : undefined }
    await appendFile(getGlobalRunIndexFile(), `${JSON.stringify(update)}\n`)
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

  const indexFile = getGlobalRunIndexFile()

  if (!existsSync(indexFile)) {
    return null
  }

  try {
    const raw = readFileSync(indexFile, "utf-8")
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
