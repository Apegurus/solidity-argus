import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createEventSink,
  type EventSink,
  resetSinkRegistry,
  type SinkState,
} from "../features/persistent-state/event-sink"
import { createBoundedSinkRegistry } from "./bounded-sink-registry"

const originalDateNow = Date.now

function makeSink(runId: string, initialState: SinkState = "ACTIVE"): EventSink {
  let state: SinkState = initialState
  const owners = new Set<string>()

  return {
    runId,
    get state() {
      return state
    },
    get isFinalized() {
      return state === "SEALED"
    },
    get ownerSet(): ReadonlySet<string> {
      return owners
    },
    addOwner(sessionId: string): void {
      owners.add(sessionId)
    },
    removeOwner(sessionId: string): void {
      owners.delete(sessionId)
    },
    async append(): Promise<void> {},
    async readAll() {
      return []
    },
    markFinalized(): void {
      state = "SEALED"
    },
    markDraining(): void {
      if (state === "ACTIVE") state = "DRAINING"
    },
    markFailedRecoverable(): void {
      if (state !== "SEALED") state = "FAILED_RECOVERABLE"
    },
  }
}

describe("createBoundedSinkRegistry", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    Date.now = originalDateNow
    resetSinkRegistry()
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "argus-bounded-sink-registry-"))
    tempDirs.push(dir)
    return dir
  }

  test("tracks sinks by OpenCode session and run id", () => {
    const registry = createBoundedSinkRegistry({ maxSinks: 10, ttlMs: 1_000 })
    const sink = makeSink("run-1")

    registry.setForSession("session-1", sink)
    registry.setForRun("run-1", sink)

    expect(registry.getForSession("session-1")).toBe(sink)
    expect(registry.getForRun("run-1")).toBe(sink)
    expect(registry.getActiveRunSinks()).toEqual([sink])
  })

  test("removes only the evicted session owner when its shared live sink reaches capacity", () => {
    const registry = createBoundedSinkRegistry({ maxSinks: 1, ttlMs: 1_000 })
    const oldestSink = makeSink("run-old")
    const newestSink = makeSink("run-new")

    registry.setForSession("session-old", oldestSink)
    registry.setForRun("run-old", oldestSink)
    registry.setForSession("session-new", newestSink)

    expect(oldestSink.isFinalized).toBe(false)
    expect(oldestSink.ownerSet.has("session-old")).toBe(false)
    expect(registry.getForSession("session-old")).toBeUndefined()
    expect(registry.getForRun("run-old")).toBe(oldestSink)
    expect(registry.getForSession("session-new")).toBe(newestSink)
  })

  test("same-key TTL refresh preserves the live session owner", () => {
    const registry = createBoundedSinkRegistry({ maxSinks: 10, ttlMs: 10 })
    const sink = makeSink("run-refresh")

    Date.now = () => 100
    registry.setForSession("session-refresh", sink)
    Date.now = () => 111
    registry.setForSession("session-refresh", sink)

    expect(registry.getForSession("session-refresh")).toBe(sink)
    expect(sink.ownerSet.has("session-refresh")).toBe(true)
  })

  test("same-key writes refresh TTL before another key triggers eviction", () => {
    const registry = createBoundedSinkRegistry({ maxSinks: 10, ttlMs: 10 })
    const refreshed = makeSink("run-refresh")

    Date.now = () => 100
    registry.setForSession("session-refresh", refreshed)
    Date.now = () => 109
    registry.setForSession("session-refresh", refreshed)
    Date.now = () => 111
    registry.setForSession("session-other", makeSink("run-other"))

    expect(registry.getForSession("session-refresh")).toBe(refreshed)
  })

  test("eviction does not force-seal a FAILED_RECOVERABLE sink (adj_11)", () => {
    const registry = createBoundedSinkRegistry({ maxSinks: 1, ttlMs: 60 * 60 * 1000 })
    const failed = makeSink("run-failed", "FAILED_RECOVERABLE")

    registry.setForRun("run-failed", failed)
    registry.setForRun("run-other", makeSink("run-other"))

    expect(failed.state).toBe("FAILED_RECOVERABLE")
    expect(failed.isFinalized).toBe(false)
  })

  test("releases the global run sink cache when max size evicts a run entry", () => {
    const projectDir = makeTempDir()
    const registry = createBoundedSinkRegistry({ maxSinks: 1, ttlMs: 1_000 })
    const oldestSink = createEventSink("run-old", projectDir)
    const newestSink = createEventSink("run-new", projectDir)

    registry.setForRun("run-old", oldestSink)
    expect(createEventSink("run-old", projectDir)).toBe(oldestSink)

    registry.setForRun("run-new", newestSink)

    expect(oldestSink.isFinalized).toBe(true)
    expect(registry.getForRun("run-old")).toBeUndefined()
    expect(createEventSink("run-old", projectDir)).not.toBe(oldestSink)
  })

  test("evicts and finalizes stale sinks on write", () => {
    const registry = createBoundedSinkRegistry({ maxSinks: 10, ttlMs: 10 })
    const staleSink = makeSink("run-stale")
    const freshSink = makeSink("run-fresh")

    Date.now = () => 100
    registry.setForRun("run-stale", staleSink)
    Date.now = () => 111
    registry.setForRun("run-fresh", freshSink)

    expect(staleSink.isFinalized).toBe(true)
    expect(registry.getForRun("run-stale")).toBeUndefined()
    expect(registry.getForRun("run-fresh")).toBe(freshSink)
  })

  test("releases the global run sink cache when TTL evicts a run entry", () => {
    const projectDir = makeTempDir()
    const registry = createBoundedSinkRegistry({ maxSinks: 10, ttlMs: 10 })
    const staleSink = createEventSink("run-stale", projectDir)
    const freshSink = createEventSink("run-fresh", projectDir)

    Date.now = () => 100
    registry.setForRun("run-stale", staleSink)
    expect(createEventSink("run-stale", projectDir)).toBe(staleSink)

    Date.now = () => 111
    registry.setForRun("run-fresh", freshSink)

    expect(staleSink.isFinalized).toBe(true)
    expect(registry.getForRun("run-stale")).toBeUndefined()
    expect(createEventSink("run-stale", projectDir)).not.toBe(staleSink)
  })

  test("releases unreferenced run sinks while preserving session-backed runs", () => {
    const registry = createBoundedSinkRegistry({ maxSinks: 10, ttlMs: 1_000 })
    const referencedSink = makeSink("run-referenced")
    const unreferencedSink = makeSink("run-unreferenced")

    registry.setForRun("run-referenced", referencedSink)
    registry.setForRun("run-unreferenced", unreferencedSink)
    registry.setForSession("session-1", referencedSink)

    registry.releaseUnreferencedRuns()

    expect(registry.getForRun("run-referenced")).toBe(referencedSink)
    expect(registry.getForRun("run-unreferenced")).toBeUndefined()
  })

  test("max-size eviction does not evict/finalize a run sink referenced by a live session (WS-3 I1)", () => {
    const registry = createBoundedSinkRegistry({ maxSinks: 1, ttlMs: 1_000 })
    const referencedSink = makeSink("run-ref")
    const otherSink = makeSink("run-other")

    registry.setForSession("session-1", referencedSink)
    registry.setForRun("run-ref", referencedSink)
    registry.setForRun("run-other", otherSink)

    expect(referencedSink.isFinalized).toBe(false)
    expect(registry.getForRun("run-ref")).toBe(referencedSink)
  })

  test("TTL eviction does not evict/finalize a run sink referenced by a live session (WS-3 I1)", () => {
    const registry = createBoundedSinkRegistry({ maxSinks: 10, ttlMs: 10 })
    const referencedSink = makeSink("run-ref")
    const freshSink = makeSink("run-fresh")

    Date.now = () => 100
    registry.setForSession("session-1", referencedSink)
    registry.setForRun("run-ref", referencedSink)
    Date.now = () => 200
    registry.setForRun("run-fresh", freshSink)

    expect(referencedSink.isFinalized).toBe(false)
    expect(registry.getForRun("run-ref")).toBe(referencedSink)
  })
})
