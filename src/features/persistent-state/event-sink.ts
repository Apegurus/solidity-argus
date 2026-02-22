import { mkdir, rename } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { AuditEvent, AuditEventType } from "../../state/schemas"

export type EventSinkErrorCode = "SEQUENCE_CONFLICT" | "INVALID_EVENT" | "IO_ERROR"

export class EventSinkError extends Error {
  readonly code: EventSinkErrorCode

  constructor(code: EventSinkErrorCode, message: string) {
    super(message)
    this.name = "EventSinkError"
    this.code = code
  }
}

export interface EventSink {
  append(event: AuditEvent): Promise<void>
  readAll(): Promise<AuditEvent[]>
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

function createMutex() {
  let chain = Promise.resolve()

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      const prev = chain
      let release!: () => void
      chain = new Promise<void>((r) => {
        release = r
      })

      await prev

      try {
        return await fn()
      } finally {
        release()
      }
    },
  }
}

function buildJournalPath(runId: string, projectDir: string): string {
  return join(projectDir, ".opencode", "runs", runId, "events.jsonl")
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

  events.sort((a, b) => a.seq - b.seq)
  return events
}

/**
 * Replay-safe stateless read — returns all events for a run sorted by seq.
 */
export async function readEvents(runId: string, projectDir: string): Promise<AuditEvent[]> {
  const journalPath = buildJournalPath(runId, projectDir)
  const content = await readRawContent(journalPath)
  return parseJournalLines(content)
}

/**
 * Append-only event sink with monotonic seq allocation, in-process mutex,
 * and atomic temp-file-then-rename writes. Restart-safe via journal replay.
 */
export function createEventSink(runId: string, projectDir: string): EventSink {
  const journalPath = buildJournalPath(runId, projectDir)
  const mutex = createMutex()
  let lastSeq = 0
  let initialized = false

  async function ensureInitialized(): Promise<void> {
    if (initialized) return

    try {
      const content = await readRawContent(journalPath)
      const events = parseJournalLines(content)
      const lastEvent = events.at(-1)
      if (lastEvent) {
        lastSeq = lastEvent.seq
      }
    } catch (err) {
      throw new EventSinkError("IO_ERROR", `Failed to initialize event sink: ${String(err)}`)
    }

    initialized = true
  }

  return {
    async append(event: AuditEvent): Promise<void> {
      return mutex.run(async () => {
        await ensureInitialized()

        if (event.run_id !== runId) {
          throw new EventSinkError(
            "INVALID_EVENT",
            `Event run_id "${event.run_id}" does not match sink run_id "${runId}"`,
          )
        }

        if (!event.type || !VALID_EVENT_TYPES.has(event.type)) {
          throw new EventSinkError("INVALID_EVENT", `Invalid event type "${String(event.type)}"`)
        }

        if (event.seq > 0 && event.seq <= lastSeq) {
          throw new EventSinkError(
            "SEQUENCE_CONFLICT",
            `Event seq ${event.seq} conflicts with last assigned seq ${lastSeq}; must be > ${lastSeq}`,
          )
        }

        const nextSeq = lastSeq + 1
        const eventToWrite: AuditEvent = { ...event, seq: nextSeq }

        const currentContent = await readRawContent(journalPath)
        const newContent = `${currentContent}${JSON.stringify(eventToWrite)}\n`

        await mkdir(dirname(journalPath), { recursive: true })

        const suffix = `${Date.now()}.${Math.random().toString(36).slice(2)}`
        const tempPath = `${journalPath}.${suffix}.tmp`

        try {
          await Bun.write(tempPath, newContent)
          await rename(tempPath, journalPath)
        } catch (err) {
          throw new EventSinkError("IO_ERROR", `Failed to write event to journal: ${String(err)}`)
        }

        lastSeq = nextSeq
      })
    },

    async readAll(): Promise<AuditEvent[]> {
      const content = await readRawContent(journalPath)
      return parseJournalLines(content)
    },
  }
}
