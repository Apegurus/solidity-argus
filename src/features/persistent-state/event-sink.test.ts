import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AuditEvent } from "../../state/schemas"
import { SCHEMA_VERSION } from "../../state/schemas"
import {
  createEventSink,
  createMutex,
  EventSinkError,
  MUTEX_TIMEOUT_MS,
  readEvents,
  releaseEventSink,
  resetSinkRegistry,
} from "./event-sink"

const RUN_ID = "test-run-1"

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    type: "tool.started",
    run_id: RUN_ID,
    seq: 0,
    session_id: "session-1",
    source: "test",
    schema_version: SCHEMA_VERSION,
    timestamp: Date.now(),
    payload: {},
    ...overrides,
  }
}

describe("EventSink", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
    resetSinkRegistry()
  })

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "argus-event-sink-"))
    tempDirs.push(dir)
    return dir
  }

  test("createEventSink rejects a runId with path traversal", () => {
    const projectDir = makeTempDir()
    expect(() => createEventSink("../../evil", projectDir)).toThrow(/invalid run_id/)
  })

  test("readEvents rejects a runId containing a path separator", async () => {
    const projectDir = makeTempDir()
    await expect(readEvents("runs/../escape", projectDir)).rejects.toThrow(/invalid run_id/)
  })

  test("sequential appends produce contiguous seq numbers 1-5", async () => {
    const projectDir = makeTempDir()
    const sink = createEventSink(RUN_ID, projectDir)

    for (let i = 0; i < 5; i++) {
      await sink.append(makeEvent())
    }

    const events = await sink.readAll()
    expect(events).toHaveLength(5)
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5])
  })

  test("run.finalization_failed marks the sink FAILED_RECOVERABLE and keeps it open (WS-3 I3)", async () => {
    const projectDir = makeTempDir()
    const sink = createEventSink(RUN_ID, projectDir)

    await sink.append(makeEvent({ type: "run.finalization_failed" }))
    expect(sink.state).toBe("FAILED_RECOVERABLE")
    expect(sink.isFinalized).toBe(false)

    await sink.append(makeEvent({ type: "finding.added" }))
    const events = await sink.readAll()
    expect(events.map((e) => e.type)).toEqual(["run.finalization_failed", "finding.added"])
  })

  test("run.finalized seals the sink (SEALED terminal) and drops later non-finalized events (WS-3 I3)", async () => {
    const projectDir = makeTempDir()
    const sink = createEventSink(RUN_ID, projectDir)

    await sink.append(makeEvent({ type: "run.finalized" }))
    expect(sink.state).toBe("SEALED")
    expect(sink.isFinalized).toBe(true)

    await sink.append(makeEvent({ type: "finding.added" }))
    const events = await sink.readAll()
    expect(events.map((e) => e.type)).toEqual(["run.finalized"])
  })

  test("concurrent appends (50 parallel) produce no duplicates and no gaps", async () => {
    const projectDir = makeTempDir()
    const sink = createEventSink(RUN_ID, projectDir)

    const promises = Array.from({ length: 50 }, (_, i) =>
      sink.append(makeEvent({ payload: { index: i } })),
    )
    await Promise.all(promises)

    const events = await sink.readAll()
    expect(events).toHaveLength(50)

    const seqs = events.map((e) => e.seq).sort((a, b) => a - b)
    expect(new Set(seqs).size).toBe(50)

    const expected = Array.from({ length: 50 }, (_, i) => i + 1)
    expect(seqs).toEqual(expected)
  })

  test("caller-provided seq is overwritten with canonical seq at read time", async () => {
    const projectDir = makeTempDir()
    const sink = createEventSink(RUN_ID, projectDir)

    // Append events with arbitrary caller seq values — all get overwritten.
    await sink.append(makeEvent({ seq: 999 }))
    await sink.append(makeEvent({ seq: 1 }))
    await sink.append(makeEvent({ seq: 0 }))

    const events = await sink.readAll()
    expect(events).toHaveLength(3)
    // Canonical seq is assigned at read time: 1, 2, 3
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3])
  })

  test("restart: write events, reload from disk, events restored and seq continues", async () => {
    const projectDir = makeTempDir()
    const sink1 = createEventSink(RUN_ID, projectDir)
    await sink1.append(makeEvent({ type: "session.created" }))
    await sink1.append(makeEvent({ type: "tool.started" }))
    await sink1.append(makeEvent({ type: "tool.completed" }))
    releaseEventSink(RUN_ID)

    const sink2 = createEventSink(RUN_ID, projectDir)
    const restored = await sink2.readAll()
    expect(restored).toHaveLength(3)
    expect(restored.map((e) => e.seq)).toEqual([1, 2, 3])
    await sink2.append(makeEvent({ type: "finding.added" }))
    const allEvents = await sink2.readAll()
    expect(allEvents).toHaveLength(4)
    expect(allEvents.map((e) => e.seq)).toEqual([1, 2, 3, 4])
    const last = allEvents.at(-1)
    expect(last).toBeDefined()
    expect(last?.type).toBe("finding.added")
  })

  test("createEventSink returns same instance for same runId", async () => {
    const projectDir = makeTempDir()
    const sink1 = createEventSink(RUN_ID, projectDir)
    const sink2 = createEventSink(RUN_ID, projectDir)
    expect(sink1).toBe(sink2)
  })

  test("releaseEventSink allows fresh instance creation", async () => {
    const projectDir = makeTempDir()
    const sink1 = createEventSink(RUN_ID, projectDir)
    await sink1.append(makeEvent())
    releaseEventSink(RUN_ID)
    const sink2 = createEventSink(RUN_ID, projectDir)
    expect(sink2).not.toBe(sink1)
    const events = await sink2.readAll()
    expect(events).toHaveLength(1)
    await sink2.append(makeEvent())
    const allEvents = await sink2.readAll()
    expect(allEvents).toHaveLength(2)
    expect(allEvents.map((e) => e.seq)).toEqual([1, 2])
  })

  test("concurrent callers sharing memoized sink produce contiguous sequences", async () => {
    const projectDir = makeTempDir()
    const sink1 = createEventSink(RUN_ID, projectDir)
    const sink2 = createEventSink(RUN_ID, projectDir)
    expect(sink1).toBe(sink2)
    const promises = [
      ...Array.from({ length: 25 }, (_, i) =>
        sink1.append(makeEvent({ payload: { index: i, from: 1 } })),
      ),
      ...Array.from({ length: 25 }, (_, i) =>
        sink2.append(makeEvent({ payload: { index: i, from: 2 } })),
      ),
    ]
    await Promise.all(promises)
    const events = await sink1.readAll()
    expect(events).toHaveLength(50)
    const seqs = events.map((e) => e.seq).sort((a, b) => a - b)
    expect(new Set(seqs).size).toBe(50)
    const expected = Array.from({ length: 50 }, (_, i) => i + 1)
    expect(seqs).toEqual(expected)
  })

  test("different runIds get different sink instances", async () => {
    const projectDir = makeTempDir()
    const sinkA = createEventSink("run-a", projectDir)
    const sinkB = createEventSink("run-b", projectDir)
    expect(sinkA).not.toBe(sinkB)
  })

  test("readEvents standalone returns events sorted by seq", async () => {
    const projectDir = makeTempDir()
    const sink = createEventSink(RUN_ID, projectDir)

    await sink.append(makeEvent({ type: "tool.started" }))
    await sink.append(makeEvent({ type: "finding.added" }))

    const events = await readEvents(RUN_ID, projectDir)
    expect(events).toHaveLength(2)
    expect(events.map((e) => e.seq)).toEqual([1, 2])
  })

  test("rejects event with mismatched run_id", async () => {
    const projectDir = makeTempDir()
    const sink = createEventSink(RUN_ID, projectDir)

    let caught: unknown
    try {
      await sink.append(makeEvent({ run_id: "wrong-run-id" }))
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(EventSinkError)
    expect((caught as EventSinkError).code).toBe("INVALID_EVENT")
  })

  test("readAll on empty sink returns empty array", async () => {
    const projectDir = makeTempDir()
    const sink = createEventSink(RUN_ID, projectDir)

    const events = await sink.readAll()
    expect(events).toHaveLength(0)
  })

  test("read after write returns events in seq order with correct types", async () => {
    const projectDir = makeTempDir()
    const sink = createEventSink(RUN_ID, projectDir)

    await sink.append(makeEvent({ type: "tool.started" }))
    await sink.append(makeEvent({ type: "finding.added" }))
    await sink.append(makeEvent({ type: "phase.changed" }))

    const events = await sink.readAll()
    expect(events).toHaveLength(3)
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(events.map((e) => e.type)).toEqual(["tool.started", "finding.added", "phase.changed"])
  })

  test("markFinalized prevents subsequent non-finalization appends", async () => {
    const projectDir = makeTempDir()
    const sink = createEventSink(RUN_ID, projectDir)

    await sink.append(makeEvent({ type: "session.created" }))
    expect(sink.isFinalized).toBe(false)

    sink.markFinalized()
    expect(sink.isFinalized).toBe(true)

    await sink.append(makeEvent({ type: "tool.started" }))
    await sink.append(makeEvent({ type: "session.idle" }))

    const events = await sink.readAll()
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe("session.created")
  })

  test("markFinalized still allows a run.finalized event after newer events", async () => {
    const projectDir = makeTempDir()
    const sink = createEventSink(RUN_ID, projectDir)

    await sink.append(makeEvent({ type: "session.created" }))
    sink.markFinalized()

    await sink.append(makeEvent({ type: "run.finalized" }))

    const events = await sink.readAll()
    expect(events).toHaveLength(2)
    expect(events[1]?.type).toBe("run.finalized")
  })

  test("concurrent run.finalized appends write exactly one run.finalized", async () => {
    const projectDir = makeTempDir()
    const sink = createEventSink(RUN_ID, projectDir)
    await sink.append(makeEvent({ type: "session.created" }))

    await Promise.all([
      sink.append(makeEvent({ type: "run.finalized" })),
      sink.append(makeEvent({ type: "run.finalized" })),
    ])

    const events = await sink.readAll()
    expect(events.filter((event) => event.type === "run.finalized")).toHaveLength(1)
    expect(sink.isFinalized).toBe(true)
  })

  test("finalization persists across process restart via marker file", async () => {
    const projectDir = makeTempDir()
    const sink1 = createEventSink(RUN_ID, projectDir)
    await sink1.append(makeEvent({ type: "session.created" }))
    sink1.markFinalized()
    releaseEventSink(RUN_ID)

    // Simulate process restart: new sink for same runId
    const sink2 = createEventSink(RUN_ID, projectDir)
    expect(sink2.isFinalized).toBe(true)

    // Non-finalization events should be silently dropped
    await sink2.append(makeEvent({ type: "tool.started" }))

    const events = await sink2.readAll()
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe("session.created")
  })

  test("finalization marker file allows run.finalized event on restarted sink", async () => {
    const projectDir = makeTempDir()
    const sink1 = createEventSink(RUN_ID, projectDir)
    await sink1.append(makeEvent({ type: "session.created" }))
    sink1.markFinalized()
    releaseEventSink(RUN_ID)

    // Simulate restart
    const sink2 = createEventSink(RUN_ID, projectDir)
    expect(sink2.isFinalized).toBe(true)

    // run.finalized after newer events is a legitimate re-finalization and is allowed.
    await sink2.append(makeEvent({ type: "run.finalized" }))

    const events = await sink2.readAll()
    expect(events).toHaveLength(2)
    expect(events[1]?.type).toBe("run.finalized")
  })

  test("drops a duplicate run.finalized that directly follows another", async () => {
    const projectDir = makeTempDir()
    const sink = createEventSink(RUN_ID, projectDir)
    await sink.append(makeEvent({ type: "session.created" }))
    await sink.append(makeEvent({ type: "run.finalized" }))
    await sink.append(makeEvent({ type: "run.finalized" }))

    const events = await sink.readAll()
    expect(events.filter((event) => event.type === "run.finalized")).toHaveLength(1)
  })

  test("finalization marker disk file exists after markFinalized", async () => {
    const { existsSync } = await import("node:fs")
    const projectDir = makeTempDir()
    const sink = createEventSink(RUN_ID, projectDir)
    await sink.append(makeEvent({ type: "session.created" }))

    // Before finalization: no marker file
    const expectedMarkerPath = join(projectDir, ".argus", "runs", RUN_ID, "events.jsonl.finalized")
    expect(existsSync(expectedMarkerPath)).toBe(false)

    sink.markFinalized()

    // After finalization: marker file exists on disk
    expect(existsSync(expectedMarkerPath)).toBe(true)
  })

  test("event sink writes to .argus root by default", async () => {
    const { existsSync } = await import("node:fs")
    const projectDir = makeTempDir()
    const sink = createEventSink(RUN_ID, projectDir)

    await sink.append(makeEvent({ type: "tool.started" }))

    const expectedPath = join(projectDir, ".argus", "runs", RUN_ID, "events.jsonl")
    expect(existsSync(expectedPath)).toBe(true)
  })
})

describe("createMutex timeout", () => {
  test("MUTEX_TIMEOUT_MS is 30 seconds", () => {
    expect(MUTEX_TIMEOUT_MS).toBe(30_000)
  })

  test("mutex timeout only logs a warning — does NOT skip waiting", async () => {
    // The timeout must only log; the waiter must remain blocked until the
    // holder explicitly resolves. This prevents concurrent critical-section
    // execution.
    const errors: string[] = []
    const testLogger = {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: (...args: unknown[]) => {
        errors.push(args.map(String).join(" "))
      },
    }

    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const capturedCallbacks: Array<() => void> = []

    globalThis.setTimeout = ((handler: unknown, _delay?: number) => {
      if (typeof handler === "function") {
        capturedCallbacks.push(handler as () => void)
      }
      return 1 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout
    globalThis.clearTimeout = (() => undefined) as typeof clearTimeout

    try {
      const mutex = createMutex({ timeoutMs: 100, logger: testLogger })

      let firstRelease!: () => void
      const firstDone = new Promise<void>((resolve) => {
        firstRelease = resolve
      })

      // Start a controlled first operation — holds the lock until we say so.
      const firstRun = mutex.run(() => firstDone)

      // Start a second operation — it must wait for the first.
      let secondStarted = false
      const secondRun = mutex.run(async () => {
        secondStarted = true
        return "completed"
      })

      // Fire the timeout callback — must only log, not release the lock.
      capturedCallbacks[0]?.()

      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0]).toContain("deadlock")

      // Second operation is still blocked.
      expect(secondStarted).toBe(false)

      // Release the first lock — now the second can proceed.
      firstRelease()
      await firstRun

      const result = await secondRun
      expect(result).toBe("completed")
      expect(secondStarted).toBe(true)
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
    }
  }, 5_000)

  test("mutex does NOT timeout when operations complete normally", async () => {
    const errors: string[] = []
    const testLogger = {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: (...args: unknown[]) => {
        errors.push(args.map(String).join(" "))
      },
    }
    const mutex = createMutex({ timeoutMs: 100, logger: testLogger })

    await mutex.run(async () => "first")
    await mutex.run(async () => "second")
    const result = await mutex.run(async () => "third")

    expect(result).toBe("third")
    expect(errors).toHaveLength(0) // No timeout errors for normal operations
  }, 5_000)
})
