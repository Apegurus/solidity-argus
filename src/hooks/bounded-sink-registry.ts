import { type EventSink, releaseEventSink } from "../features/persistent-state/event-sink"

export interface BoundedSinkRegistry {
  getForSession(sessionId: string): EventSink | undefined
  getForRun(runId: string): EventSink | undefined
  setForSession(sessionId: string, sink: EventSink): void
  setForRun(runId: string, sink: EventSink): void
  deleteSession(sessionId: string): void
  getNewestActiveRunSink(): EventSink | null
  getActiveRunSinks(): EventSink[]
  releaseUnreferencedRuns(): void
  releaseGlobalRun(runId: string): void
}

export function createBoundedSinkRegistry(options: {
  maxSinks: number
  ttlMs: number
  onSet?: () => void
}): BoundedSinkRegistry {
  const { maxSinks, ttlMs, onSet } = options
  const byOpencodeSession = new Map<string, EventSink>()
  const byRunId = new Map<string, EventSink>()
  const createdAtBySession = new Map<string, number>()
  const createdAtByRunId = new Map<string, number>()

  function markFinalizedBestEffort(sink: EventSink): void {
    if (sink.isFinalized) return

    try {
      sink.markFinalized()
    } catch {
      /* noop - best-effort finalization */
    }
  }

  function evictOldest(sinkMap: Map<string, EventSink>, timestampMap: Map<string, number>): void {
    const oldestKey = sinkMap.keys().next().value
    if (oldestKey === undefined) return

    const sink = sinkMap.get(oldestKey)
    if (sink) {
      markFinalizedBestEffort(sink)
    }
    sinkMap.delete(oldestKey)
    timestampMap.delete(oldestKey)
  }

  function evictStale(sinkMap: Map<string, EventSink>, timestampMap: Map<string, number>): void {
    const now = Date.now()
    for (const [key, createdAt] of timestampMap) {
      if (now - createdAt <= ttlMs) continue

      const sink = sinkMap.get(key)
      if (sink) {
        markFinalizedBestEffort(sink)
      }
      sinkMap.delete(key)
      timestampMap.delete(key)
    }
  }

  function setBounded(
    sinkMap: Map<string, EventSink>,
    timestampMap: Map<string, number>,
    key: string,
    sink: EventSink,
  ): void {
    evictStale(sinkMap, timestampMap)
    if (sinkMap.size >= maxSinks && !sinkMap.has(key)) {
      evictOldest(sinkMap, timestampMap)
    }
    sinkMap.set(key, sink)
    if (!timestampMap.has(key)) {
      timestampMap.set(key, Date.now())
    }
    onSet?.()
  }

  return {
    getForSession(sessionId: string): EventSink | undefined {
      return byOpencodeSession.get(sessionId)
    },

    getForRun(runId: string): EventSink | undefined {
      return byRunId.get(runId)
    },

    setForSession(sessionId: string, sink: EventSink): void {
      setBounded(byOpencodeSession, createdAtBySession, sessionId, sink)
    },

    setForRun(runId: string, sink: EventSink): void {
      setBounded(byRunId, createdAtByRunId, runId, sink)
    },

    deleteSession(sessionId: string): void {
      byOpencodeSession.delete(sessionId)
      createdAtBySession.delete(sessionId)
    },

    getNewestActiveRunSink(): EventSink | null {
      const activeSinks = Array.from(byRunId.values()).filter((sink) => !sink.isFinalized)
      if (activeSinks.length === 1) {
        return activeSinks[0] ?? null
      }
      if (activeSinks.length === 0) {
        return null
      }

      const newest = [...createdAtByRunId.entries()]
        .filter(([runId]) => {
          const sink = byRunId.get(runId)
          return sink != null && !sink.isFinalized
        })
        .sort((a, b) => b[1] - a[1])[0]

      return newest ? (byRunId.get(newest[0]) ?? null) : null
    },

    getActiveRunSinks(): EventSink[] {
      return Array.from(byRunId.values()).filter((sink) => !sink.isFinalized)
    },

    releaseUnreferencedRuns(): void {
      const activeRunIds = new Set(Array.from(byOpencodeSession.values()).map((sink) => sink.runId))
      for (const runId of Array.from(byRunId.keys())) {
        if (activeRunIds.has(runId)) continue

        releaseEventSink(runId)
        byRunId.delete(runId)
        createdAtByRunId.delete(runId)
      }
    },

    releaseGlobalRun(runId: string): void {
      releaseEventSink(runId)
    },
  }
}
