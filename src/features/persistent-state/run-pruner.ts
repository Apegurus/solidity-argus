import { readdir, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { createLogger } from "../../shared/logger"
import { type ArgusRootResolver, defaultRootResolver } from "../../shared/path-root-resolver"
import { readEvents } from "./event-sink"

const logger = createLogger()

const DEFAULT_STALE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const DEFAULT_FINALIZED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export type PruneResult = {
  pruned: string[]
  kept: string[]
  errors: string[]
}

function isRunFinalized(events: Array<{ type: string }>): boolean {
  return events.some((e) => e.type === "run.finalized")
}

export async function pruneStaleRuns(
  projectDir: string,
  options: {
    staleTtlMs?: number
    finalizedRetentionMs?: number
    dryRun?: boolean
    resolver?: ArgusRootResolver
  } = {},
): Promise<PruneResult> {
  const {
    staleTtlMs = DEFAULT_STALE_TTL_MS,
    finalizedRetentionMs = DEFAULT_FINALIZED_RETENTION_MS,
    dryRun = false,
    resolver = defaultRootResolver,
  } = options

  const result: PruneResult = { pruned: [], kept: [], errors: [] }
  const runsDir = join(resolver.writeRoot(projectDir), "runs")

  let entries: string[]
  try {
    entries = await readdir(runsDir)
  } catch {
    return result
  }

  const now = Date.now()

  for (const entry of entries) {
    const runDir = join(runsDir, entry)
    try {
      const dirStat = await stat(runDir)
      if (!dirStat.isDirectory()) continue

      const journalPath = join(runDir, "events.jsonl")
      let journalMtime: number
      try {
        const journalStat = await stat(journalPath)
        journalMtime = journalStat.mtimeMs
      } catch {
        journalMtime = dirStat.mtimeMs
      }

      const age = now - journalMtime
      const events = await readEvents(entry, projectDir, resolver)
      const finalized = isRunFinalized(events)

      const shouldPrune =
        (finalized && age > finalizedRetentionMs) || (!finalized && age > staleTtlMs)

      if (shouldPrune) {
        if (!dryRun) {
          await rm(runDir, { recursive: true, force: true })
        }
        result.pruned.push(entry)
        logger.debug(
          `Pruned ${finalized ? "finalized" : "stale"} run ${entry} (age: ${Math.round(age / 3600000)}h)`,
        )
      } else {
        result.kept.push(entry)
      }
    } catch (err) {
      result.errors.push(`${entry}: ${String(err)}`)
    }
  }

  if (result.pruned.length > 0) {
    logger.debug(`Pruned ${result.pruned.length} run(s), kept ${result.kept.length}`)
  }

  return result
}
