import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AuditEvent } from "../../state/schemas"
import { SCHEMA_VERSION } from "../../state/schemas"
import { createEventSink, EventSinkError, readEvents } from "./event-sink"

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
  })

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "argus-event-sink-"))
    tempDirs.push(dir)
    return dir
  }

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

  test("duplicate seq injection is rejected with SEQUENCE_CONFLICT", async () => {
    const projectDir = makeTempDir()
    const sink = createEventSink(RUN_ID, projectDir)

    await sink.append(makeEvent())
    await sink.append(makeEvent())

    let caught: unknown
    try {
      await sink.append(makeEvent({ seq: 1 }))
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(EventSinkError)
    expect((caught as EventSinkError).code).toBe("SEQUENCE_CONFLICT")

    let caught2: unknown
    try {
      await sink.append(makeEvent({ seq: 2 }))
    } catch (err) {
      caught2 = err
    }
    expect(caught2).toBeInstanceOf(EventSinkError)
    expect((caught2 as EventSinkError).code).toBe("SEQUENCE_CONFLICT")
  })

  test("restart: write events, reload from disk, events restored and seq continues", async () => {
    const projectDir = makeTempDir()

    const sink1 = createEventSink(RUN_ID, projectDir)
    await sink1.append(makeEvent({ type: "session.created" }))
    await sink1.append(makeEvent({ type: "tool.started" }))
    await sink1.append(makeEvent({ type: "tool.completed" }))

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

  test("event sink writes to .argus root by default", async () => {
    const { existsSync } = await import("node:fs")
    const projectDir = makeTempDir()
    const sink = createEventSink(RUN_ID, projectDir)

    await sink.append(makeEvent({ type: "tool.started" }))

    const expectedPath = join(projectDir, ".argus", "runs", RUN_ID, "events.jsonl")
    expect(existsSync(expectedPath)).toBe(true)
  })
})
