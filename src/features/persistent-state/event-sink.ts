import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { appendFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { createLogger, type Logger } from "../../shared/logger"
import { type ArgusRootResolver, defaultRootResolver } from "../../shared/path-root-resolver"
import { validateRunId } from "../../shared/path-safety"
import type { AuditEvent, AuditEventType } from "../../state/schemas"

export type EventSinkErrorCode = "INVALID_EVENT" | "IO_ERROR"

export class EventSinkError extends Error {
  readonly code: EventSinkErrorCode

  constructor(code: EventSinkErrorCode, message: string) {
    super(message)
    this.name = "EventSinkError"
    this.code = code
  }
}

export interface EventSink {
  readonly runId: string
  /** Whether this sink has been marked as finalized. Post-finalization appends are silently dropped. */
  readonly isFinalized: boolean
  append(event: AuditEvent): Promise<void>
  readAll(): Promise<AuditEvent[]>
  /** Mark this sink as finalized. Subsequent appends (except run.finalized) are silently dropped. */
  markFinalized(): void
}

const VALID_EVENT_TYPES: ReadonlySet<string> = new Set<AuditEventType>([
  "session.created",
  "session.idle",
  "session.deleted",
  "tool.started",
  "tool.completed",
  "finding.added",
  "phase.changed",
  "run.finalized",
])

export const MUTEX_TIMEOUT_MS = 30_000

export interface MutexOptions {
  timeoutMs?: number
  logger?: Logger
}

export function createMutex(options: MutexOptions = {}) {
  const { timeoutMs = MUTEX_TIMEOUT_MS, logger } = options
  let chain = Promise.resolve()

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      const prev = chain
      let release!: () => void
      chain = new Promise<void>((r) => {
        release = r
      })

      const timer = setTimeout(() => {
        logger?.error("EventSink mutex held >30s — possible deadlock, still waiting")
      }, timeoutMs)

      await prev

      clearTimeout(timer)

      try {
        return await fn()
      } finally {
        release()
      }
    },
  }
}

function buildJournalPath(runId: string, projectDir: string, resolver: ArgusRootResolver): string {
  return join(resolver.writeRoot(projectDir), "runs", validateRunId(runId), "events.jsonl")
}

async function readRawContent(path: string): Promise<string> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return ""
  }
  return file.text()
}

function parseJournalLines(content: string): AuditEvent[] {
  if (!content.trim()) return []

  const lines = content.split("\n").filter(Boolean)
  const events: AuditEvent[] = []

  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as AuditEvent)
    } catch {
      /* skip malformed lines */
    }
  }

  // Canonical ordering: sort by timestamp (primary), written seq hint (secondary tiebreaker).
  // This produces a stable, deterministic order even when multiple writers assign
  // overlapping seq values — the written seq is a best-effort hint, not authoritative.
  events.sort((a, b) => {
    const tsDiff = a.timestamp - b.timestamp
    if (tsDiff !== 0) return tsDiff
    return a.seq - b.seq
  })

  // Assign canonical sequential seq numbers starting from 1.
  // All downstream consumers see clean, gap-free sequences regardless of
  // how many independent writers appended to the journal.
  for (let i = 0; i < events.length; i++) {
    ;(events[i] as AuditEvent).seq = i + 1
  }

  return events
}

/**
 * Replay-safe stateless read — returns all events for a run sorted by seq.
 */
export async function readEvents(
  runId: string,
  projectDir: string,
  resolver: ArgusRootResolver = defaultRootResolver,
): Promise<AuditEvent[]> {
  const journalPath = buildJournalPath(runId, projectDir, resolver)
  const content = await readRawContent(journalPath)
  return parseJournalLines(content)
}

const sinkRegistry = new Map<string, EventSink>()
export function releaseEventSink(runId: string): void {
  sinkRegistry.delete(runId)
}
export function resetSinkRegistry(): void {
  sinkRegistry.clear()
}

export function createEventSink(
  runId: string,
  projectDir: string,
  resolver: ArgusRootResolver = defaultRootResolver,
): EventSink {
  const existing = sinkRegistry.get(runId)
  if (existing) {
    return existing
  }

  const logger = createLogger()
  const journalPath = buildJournalPath(runId, projectDir, resolver)
  const markerPath = `${journalPath}.finalized`
  const mutex = createMutex({ logger })
  let lastSeq = 0
  let lastEventType: string | null = null
  let initialized = false
  const sinkState = { finalized: false }

  try {
    if (existsSync(markerPath)) {
      sinkState.finalized = true
    }
  } catch (err) {
    logger.warn(`Failed to check finalization marker: ${String(err)}`)
  }

  async function ensureInitialized(): Promise<void> {
    if (initialized) return

    try {
      const content = await readRawContent(journalPath)
      const events = parseJournalLines(content)
      const lastEvent = events.at(-1)
      if (lastEvent) {
        lastSeq = lastEvent.seq
        lastEventType = lastEvent.type
      }
    } catch (err) {
      throw new EventSinkError("IO_ERROR", `Failed to initialize event sink: ${String(err)}`)
    }

    initialized = true
  }

  function markFinalizedState(): void {
    sinkState.finalized = true
    try {
      mkdirSync(dirname(markerPath), { recursive: true })
      writeFileSync(markerPath, "")
    } catch (err) {
      logger.warn(`Failed to write finalization marker: ${String(err)}`)
    }
  }

  const sink: EventSink = {
    runId,

    get isFinalized() {
      return sinkState.finalized
    },

    markFinalized() {
      markFinalizedState()
    },

    async append(event: AuditEvent): Promise<void> {
      return mutex.run(async () => {
        await ensureInitialized()

        if (sinkState.finalized && event.type !== "run.finalized") {
          logger.debug(`Dropping ${event.type} for finalized run ${runId}`)
          return
        }

        // A run.finalized directly following another run.finalized is a duplicate from a
        // concurrent finalize path; drop it so the run is finalized exactly once. A
        // run.finalized after newer events is a legitimate re-finalization and is allowed.
        if (event.type === "run.finalized" && lastEventType === "run.finalized") {
          logger.debug(`Dropping duplicate run.finalized for run ${runId}`)
          return
        }

        if (event.run_id !== runId) {
          throw new EventSinkError(
            "INVALID_EVENT",
            `Event run_id "${event.run_id}" does not match sink run_id "${runId}"`,
          )
        }

        if (!event.type || !VALID_EVENT_TYPES.has(event.type)) {
          throw new EventSinkError("INVALID_EVENT", `Invalid event type "${String(event.type)}"`)
        }

        // Best-effort seq hint — may have duplicates across isolated writer instances.
        // Canonical seq is assigned at read time by parseJournalLines().
        const nextSeq = lastSeq + 1
        const eventToWrite: AuditEvent = { ...event, seq: nextSeq }

        await mkdir(dirname(journalPath), { recursive: true })

        // O_APPEND atomic write — the OS guarantees that seek-to-end + write is atomic
        // for regular files opened with O_APPEND, so concurrent appends from isolated
        // writer instances won't interleave or overwrite each other.
        try {
          await appendFile(journalPath, `${JSON.stringify(eventToWrite)}\n`)
        } catch (err) {
          throw new EventSinkError("IO_ERROR", `Failed to write event to journal: ${String(err)}`)
        }

        lastSeq = nextSeq
        lastEventType = event.type

        if (event.type === "run.finalized") {
          markFinalizedState()
        }
      })
    },

    async readAll(): Promise<AuditEvent[]> {
      const content = await readRawContent(journalPath)
      return parseJournalLines(content)
    },
  }

  sinkRegistry.set(runId, sink)
  return sink
}
