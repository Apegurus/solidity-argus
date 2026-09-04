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

// Serialize all writers (append + compaction) in-process so a concurrent append can never land
// between compaction's read and its full-file rewrite — that read-modify-write race silently
// dropped just-appended entries. Cross-process races are out of scope: each process orders its own.
let writeChain: Promise<unknown> = Promise.resolve()
function serializeWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn)
  writeChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export async function recordRun(entry: RunIndexEntry): Promise<void> {
  return serializeWrite(async () => {
    try {
      await ensureDir()
      await appendFile(getGlobalRunIndexFile(), `${JSON.stringify(entry)}\n`)
      await compactIfOversizedUnlocked()
    } catch {
      logger.debug("Failed to write global run index entry")
    }
  })
}

const MAX_RUN_INDEX_BYTES = 1 * 1024 * 1024
const RUN_INDEX_KEEP_ENTRIES = 500

// The index is append-only (one line per run + status update) and resolveRunIdFromOpencodeSession
// re-reads all of it, so it is compacted once oversized. Only TERMINATED runs (finalized/failed)
// are dropped — resolveRun ignores those anyway — while every live session->run mapping is retained.
async function compactRunIndexUnlocked(keepEntries: number): Promise<void> {
  const file = getGlobalRunIndexFile()
  try {
    const lines = readFileSync(file, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
    if (lines.length <= keepEntries) return

    const parsed = lines.map((line) => {
      try {
        const entry = JSON.parse(line) as Partial<RunIndexEntry>
        return { line, runId: entry.runId, status: entry.status }
      } catch {
        return {
          line,
          runId: undefined as string | undefined,
          status: undefined as RunStatus | undefined,
        }
      }
    })
    const terminated = new Set<string>()
    for (const p of parsed) {
      if ((p.status === "finalized" || p.status === "failed") && typeof p.runId === "string") {
        terminated.add(p.runId)
      }
    }
    const live = parsed.filter((p) => typeof p.runId === "string" && !terminated.has(p.runId))
    const kept = live.length > keepEntries ? live.slice(-keepEntries) : live
    await writeFile(file, kept.length > 0 ? `${kept.map((p) => p.line).join("\n")}\n` : "")
  } catch {
    logger.debug("Failed to compact global run index")
  }
}

export async function compactRunIndex(keepEntries: number): Promise<void> {
  return serializeWrite(() => compactRunIndexUnlocked(keepEntries))
}

async function compactIfOversizedUnlocked(): Promise<void> {
  const file = getGlobalRunIndexFile()
  if (existsSync(file) && statSync(file).size > MAX_RUN_INDEX_BYTES) {
    await compactRunIndexUnlocked(RUN_INDEX_KEEP_ENTRIES)
  }
}

export async function updateRunStatus(runId: string, status: RunStatus): Promise<void> {
  return serializeWrite(async () => {
    try {
      await ensureDir()
      const update = { runId, status, finalizedAt: status === "finalized" ? Date.now() : undefined }
      await appendFile(getGlobalRunIndexFile(), `${JSON.stringify(update)}\n`)
    } catch {
      logger.debug("Failed to write run status update")
    }
  })
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
