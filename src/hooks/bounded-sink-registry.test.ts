import { afterEach, describe, expect, test } from "bun:test"
import type { EventSink } from "../features/persistent-state/event-sink"
import { createBoundedSinkRegistry } from "./bounded-sink-registry"

const originalDateNow = Date.now

function makeSink(runId: string): EventSink {
  let finalized = false

  return {
    runId,
    get isFinalized() {
      return finalized
    },
    async append(): Promise<void> {},
    async readAll() {
      return []
    },
    markFinalized(): void {
      finalized = true
    },
  }
}

describe("createBoundedSinkRegistry", () => {
  afterEach(() => {
    Date.now = originalDateNow
  })

  test("tracks sinks by OpenCode session and run id", () => {
    const registry = createBoundedSinkRegistry({ maxSinks: 10, ttlMs: 1_000 })
    const sink = makeSink("run-1")

    registry.setForSession("session-1", sink)
    registry.setForRun("run-1", sink)

    expect(registry.getForSession("session-1")).toBe(sink)
    expect(registry.getForRun("run-1")).toBe(sink)
    expect(registry.getActiveRunSinks()).toEqual([sink])
  })

  test("returns the newest active run sink", () => {
    const registry = createBoundedSinkRegistry({ maxSinks: 10, ttlMs: 1_000 })
    const olderSink = makeSink("run-older")
    const newerSink = makeSink("run-newer")

    Date.now = () => 100
    registry.setForRun("run-older", olderSink)
    Date.now = () => 200
    registry.setForRun("run-newer", newerSink)

    expect(registry.getNewestActiveRunSink()).toBe(newerSink)
  })

  test("evicts and finalizes the oldest sink when max size is reached", () => {
    const registry = createBoundedSinkRegistry({ maxSinks: 1, ttlMs: 1_000 })
    const oldestSink = makeSink("run-old")
    const newestSink = makeSink("run-new")

    registry.setForSession("session-old", oldestSink)
    registry.setForSession("session-new", newestSink)

    expect(oldestSink.isFinalized).toBe(true)
    expect(registry.getForSession("session-old")).toBeUndefined()
    expect(registry.getForSession("session-new")).toBe(newestSink)
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
})
