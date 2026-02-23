import { appendFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { createLogger } from "../../shared/logger"
import { type ArgusRootResolver, defaultRootResolver } from "../../shared/path-root-resolver"

const logger = createLogger()

const JOURNAL_FILE = "argus-journal.jsonl"

export type JournalEvent =
  | { type: "session.created"; sessionId?: string; timestamp: number }
  | {
      type: "session.idle"
      timestamp: number
      findingsCount: number
      toolsExecutedCount: number
    }
  | {
      type: "session.deleted"
      timestamp: number
      archived: boolean
      finalizationPassed: boolean | null
    }
  | {
      type: "tool.executed"
      tool: string
      timestamp: number
      findingsCount: number
    }
  | { type: "state.saved"; timestamp: number; success: boolean }
  | {
      type: "state.loaded"
      timestamp: number
      success: boolean
      findingsCount: number
    }

export function createRunJournal(
  projectDir: string,
  resolver: ArgusRootResolver = defaultRootResolver,
): {
  log(event: JournalEvent): void
  close(): Promise<void>
  getPath(): string
} {
  const journalPath = join(resolver.writeRoot(projectDir), JOURNAL_FILE)
  let ensureDirPromise: Promise<void> | null = null
  const pendingWrites = new Set<Promise<void>>()

  function ensureDirectory(): Promise<void> {
    if (!ensureDirPromise) {
      ensureDirPromise = (async () => {
        try {
          await mkdir(dirname(journalPath), { recursive: true })
        } catch {
          logger.debug("Failed to create run journal directory")
        }
      })()
    }

    return ensureDirPromise
  }

  function trackWrite(writePromise: Promise<void>): void {
    pendingWrites.add(writePromise)
    void writePromise.finally(() => {
      pendingWrites.delete(writePromise)
    })
  }

  function log(event: JournalEvent): void {
    const line = `${JSON.stringify(event)}\n`

    const writePromise = ensureDirectory()
      .then(async () => {
        await appendFile(journalPath, line, "utf8")
      })
      .catch(() => {
        logger.debug("Failed to append run journal event")
      })

    trackWrite(writePromise)
  }

  async function close(): Promise<void> {
    await Promise.allSettled(Array.from(pendingWrites))
  }

  return {
    log,
    close,
    getPath: () => journalPath,
  }
}
