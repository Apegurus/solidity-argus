import { type EventSink, releaseEventSink } from "../features/persistent-state/event-sink"

export interface BoundedSinkRegistry {
  getForSession(sessionId: string): EventSink | undefined
  getForRun(runId: string): EventSink | undefined
  setForSession(sessionId: string, sink: EventSink): void
  setForRun(runId: string, sink: EventSink): void
  deleteSession(sessionId: string): void
  deleteRun(runId: string): void
  getActiveRunSinks(): EventSink[]
  releaseUnreferencedRuns(): void
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
    // A FAILED_RECOVERABLE sink (failed finalization awaiting remediation/disposition/regen,
    // WS-3 I3) must NOT be force-sealed by capacity/TTL eviction — sealing would drop those
    // later events. Its state is re-derived from the journal on the next createEventSink.
    if (sink.isFinalized || sink.state === "FAILED_RECOVERABLE") return

    try {
      sink.markFinalized()
    } catch {
      /* noop - best-effort finalization */
    }
  }

  function evictOldest(options: {
    sinkMap: Map<string, EventSink>
    timestampMap: Map<string, number>
    releaseRunSink: boolean
  }): void {
    const { sinkMap, timestampMap, releaseRunSink } = options
    // Referenced-exempt (WS-3 I1/I11): a run sink whose ownerSet is non-empty is never
    // sealed or released by eviction — skip to the oldest UNREFERENCED run sink instead.
    let oldestKey: string | undefined
    for (const key of sinkMap.keys()) {
      if (releaseRunSink && (sinkMap.get(key)?.ownerSet.size ?? 0) > 0) continue
      oldestKey = key
      break
    }
    if (oldestKey === undefined) return

    const sink = sinkMap.get(oldestKey)
    if (sink) {
      if (releaseRunSink) {
        markFinalizedBestEffort(sink)
      } else {
        sink.removeOwner(oldestKey)
      }
    }
    sinkMap.delete(oldestKey)
    timestampMap.delete(oldestKey)
    if (releaseRunSink) {
      releaseEventSink(oldestKey)
    }
  }

  function evictStale(options: {
    sinkMap: Map<string, EventSink>
    timestampMap: Map<string, number>
    releaseRunSink: boolean
  }): void {
    const { sinkMap, timestampMap, releaseRunSink } = options
    const now = Date.now()
    for (const [key, createdAt] of timestampMap) {
      if (now - createdAt <= ttlMs) continue

      const sink = sinkMap.get(key)
      // Referenced run sinks are TTL-exempt (WS-3 I1): a live session still holds the run.
      if (releaseRunSink && (sink?.ownerSet.size ?? 0) > 0) continue
      if (sink) {
        if (releaseRunSink) {
          markFinalizedBestEffort(sink)
        } else {
          sink.removeOwner(key)
        }
      }
      sinkMap.delete(key)
      timestampMap.delete(key)
      if (releaseRunSink) {
        releaseEventSink(key)
      }
    }
  }

  function setBounded(
    sinkMap: Map<string, EventSink>,
    timestampMap: Map<string, number>,
    key: string,
    sink: EventSink,
    releaseRunSink: boolean,
  ): void {
    evictStale({ sinkMap, timestampMap, releaseRunSink })
    if (sinkMap.size >= maxSinks && !sinkMap.has(key)) {
      evictOldest({ sinkMap, timestampMap, releaseRunSink })
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
      const previousSink = byOpencodeSession.get(sessionId)
      if (previousSink && previousSink !== sink) {
        previousSink.removeOwner(sessionId)
      }
      setBounded(byOpencodeSession, createdAtBySession, sessionId, sink, false)
      sink.addOwner(sessionId)
    },

    setForRun(runId: string, sink: EventSink): void {
      setBounded(byRunId, createdAtByRunId, runId, sink, true)
    },

    deleteSession(sessionId: string): void {
      byOpencodeSession.get(sessionId)?.removeOwner(sessionId)
      byOpencodeSession.delete(sessionId)
      createdAtBySession.delete(sessionId)
    },

    deleteRun(runId: string): void {
      releaseEventSink(runId)
      byRunId.delete(runId)
      createdAtByRunId.delete(runId)
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
  }
}
