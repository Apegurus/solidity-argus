import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAuditStateManager } from "../features/persistent-state/audit-state-manager"
import { createAuditState } from "../state/audit-state"
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

  test("deleteSession removes manager and debounced save ownership", async () => {
    const registry = createSessionStateRegistry({ projectDir: makeTempDir(), maxSessions: 10 })
    const debouncedSave = registry.getDebouncedSave("session-1")

    await registry.deleteSession("session-1")

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

  test("deleteSession flushes pending debounced saves before dispose (WS-3 I2)", async () => {
    const projectDir = makeTempDir()
    const registry = createSessionStateRegistry({ projectDir, maxSessions: 10 })
    const sessionId = "ses_flush_test"
    const state = createAuditState(projectDir).state

    registry.getDebouncedSave(sessionId).save(state)
    await registry.deleteSession(sessionId)

    const reader = createAuditStateManager(projectDir)
    reader.bindSession(sessionId)
    const loaded = await reader.load()
    expect(loaded).not.toBeNull()
    expect(loaded?.sessionId).toBe(state.sessionId)
  })
})
