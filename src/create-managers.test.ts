import { describe, expect, it, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createManagers } from "./create-managers"
import { ArgusConfigSchema } from "./config/schema"

describe("createManagers", () => {
  const tempDirs: string[] = []

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "argus-managers-test-"))
    tempDirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  it("returns object with backgroundManager and auditStateManager", () => {
    const dir = makeTempDir()
    const config = ArgusConfigSchema.parse({})
    const managers = createManagers({ projectDir: dir, config })

    expect(managers.backgroundManager).toBeDefined()
    expect(managers.auditStateManager).toBeDefined()
  })

  it("backgroundManager has required interface methods", () => {
    const dir = makeTempDir()
    const config = ArgusConfigSchema.parse({})
    const { backgroundManager } = createManagers({ projectDir: dir, config })

    expect(typeof backgroundManager.dispatch).toBe("function")
    expect(typeof backgroundManager.cancel).toBe("function")
    expect(typeof backgroundManager.getResult).toBe("function")
    expect(typeof backgroundManager.onComplete).toBe("function")
    expect(typeof backgroundManager.getActiveCount).toBe("function")
  })

  it("auditStateManager has required interface methods", () => {
    const dir = makeTempDir()
    const config = ArgusConfigSchema.parse({})
    const { auditStateManager } = createManagers({ projectDir: dir, config })

    expect(typeof auditStateManager.load).toBe("function")
    expect(typeof auditStateManager.save).toBe("function")
    expect(typeof auditStateManager.get).toBe("function")
    expect(typeof auditStateManager.update).toBe("function")
    expect(typeof auditStateManager.reset).toBe("function")
  })

  it("backgroundManager dispatch returns a taskId", () => {
    const dir = makeTempDir()
    const config = ArgusConfigSchema.parse({})
    const { backgroundManager } = createManagers({ projectDir: dir, config })

    const taskId = backgroundManager.dispatch("sentinel", "audit this contract")
    expect(typeof taskId).toBe("string")
    expect(taskId.length).toBeGreaterThan(0)
  })

  it("auditStateManager get returns initial state", () => {
    const dir = makeTempDir()
    const config = ArgusConfigSchema.parse({})
    const { auditStateManager } = createManagers({ projectDir: dir, config })

    const state = auditStateManager.get()
    expect(state).toBeDefined()
    expect(state).not.toBeNull()
  })

  it("backgroundManager starts with zero active tasks", () => {
    const dir = makeTempDir()
    const config = ArgusConfigSchema.parse({})
    const { backgroundManager } = createManagers({ projectDir: dir, config })

    expect(backgroundManager.getActiveCount()).toBe(0)
  })
})
