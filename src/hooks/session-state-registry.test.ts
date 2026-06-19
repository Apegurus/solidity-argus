import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSessionStateRegistry } from "./session-state-registry"

describe("createSessionStateRegistry", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "argus-session-state-registry-"))
    tempDirs.push(dir)
    return dir
  }

  test("caches a state manager per session", () => {
    const registry = createSessionStateRegistry({ projectDir: makeTempDir(), maxSessions: 10 })

    const first = registry.getManager("session-1")
    const second = registry.getManager("session-1")

    expect(second).toBe(first)
    expect(registry.getExistingManager("session-1")).toBe(first)
    expect(registry.hasManager("session-1")).toBe(true)
  })

  test("caches debounced saves per session", () => {
    const registry = createSessionStateRegistry({ projectDir: makeTempDir(), maxSessions: 10 })

    const first = registry.getDebouncedSave("session-1")
    const second = registry.getDebouncedSave("session-1")

    expect(second).toBe(first)
    expect(registry.hasManager("session-1")).toBe(true)
  })

  test("deleteSession removes manager and debounced save ownership", () => {
    const registry = createSessionStateRegistry({ projectDir: makeTempDir(), maxSessions: 10 })
    const debouncedSave = registry.getDebouncedSave("session-1")

    registry.deleteSession("session-1")

    expect(registry.getExistingManager("session-1")).toBeUndefined()
    expect(registry.hasManager("session-1")).toBe(false)
    expect(registry.getDebouncedSave("session-1")).not.toBe(debouncedSave)
  })

  test("evicts the oldest session when the tracking limit is exceeded", () => {
    const registry = createSessionStateRegistry({ projectDir: makeTempDir(), maxSessions: 1 })
    const first = registry.getManager("session-1")
    const second = registry.getManager("session-2")

    expect(second).not.toBe(first)
    expect(registry.hasManager("session-1")).toBe(false)
    expect(registry.hasManager("session-2")).toBe(true)
  })
})
