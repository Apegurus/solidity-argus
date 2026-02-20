import { describe, it, expect, afterEach, beforeEach } from "bun:test"
import ArgusPlugin from "./index"
import * as lifecycleModule from "./solodit-lifecycle"

const {
  _runMonitoringCycle,
  _resetSoloditState,
  _setTestConfig,
  stopSoloditMonitoring,
} = lifecycleModule

function createFakeChild(exitCode = 0) {
  return {
    kill: () => {},
    unref: () => {},
    exited: Promise.resolve(exitCode),
  }
}

describe("Solodit monitoring", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    _resetSoloditState()
    _setTestConfig({
      restartSettleMs: 0,
      retryBaseDelayMs: 1,
      spawnFn: () => createFakeChild(),
    })
  })

  afterEach(() => {
    _resetSoloditState()
    globalThis.fetch = originalFetch
  })

  it("soloditAvailable defaults to false", () => {
    expect(lifecycleModule.soloditAvailable).toBe(false)
  })

  it("monitoring cycle sets flag to true when health check passes", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch

    await _runMonitoringCycle(3000)

    expect(lifecycleModule.soloditAvailable).toBe(true)
  })

  it("monitoring cycle keeps flag true on consecutive healthy checks", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch

    await _runMonitoringCycle(3000)
    await _runMonitoringCycle(3000)

    expect(lifecycleModule.soloditAvailable).toBe(true)
  })

  it("monitoring cycle sets flag to false when previously available server fails", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch
    await _runMonitoringCycle(3000)
    expect(lifecycleModule.soloditAvailable).toBe(true)

    globalThis.fetch = (async () => {
      throw new Error("Connection refused")
    }) as unknown as typeof fetch
    await _runMonitoringCycle(3000)

    expect(lifecycleModule.soloditAvailable).toBe(false)
  })

  it("auto-restart triggered on failure restores availability when health recovers", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch
    await _runMonitoringCycle(3000)
    expect(lifecycleModule.soloditAvailable).toBe(true)

    let callCount = 0
    globalThis.fetch = (async () => {
      callCount++
      if (callCount <= 1) {
        throw new Error("Connection refused")
      }
      return { ok: true, status: 200 }
    }) as unknown as typeof fetch

    await _runMonitoringCycle(3000)

    expect(lifecycleModule.soloditAvailable).toBe(true)
  })

  it("monitoring cycle detects recovery after full failure", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch
    await _runMonitoringCycle(3000)

    globalThis.fetch = (async () => {
      throw new Error("Dead")
    }) as unknown as typeof fetch
    await _runMonitoringCycle(3000)
    expect(lifecycleModule.soloditAvailable).toBe(false)

    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch
    await _runMonitoringCycle(3000)

    expect(lifecycleModule.soloditAvailable).toBe(true)
  })

  it("monitoring cycle does not attempt restart when never available", async () => {
    globalThis.fetch = (async () => {
      throw new Error("Dead")
    }) as unknown as typeof fetch

    await _runMonitoringCycle(3000)

    expect(lifecycleModule.soloditAvailable).toBe(false)
  })

  it("monitoring cycle survives health check throwing synchronously", async () => {
    globalThis.fetch = (() => {
      throw new TypeError("NetworkError")
    }) as unknown as typeof fetch

    await _runMonitoringCycle(3000)

    expect(lifecycleModule.soloditAvailable).toBe(false)
  })

  it("stopSoloditMonitoring is idempotent", () => {
    stopSoloditMonitoring()
    stopSoloditMonitoring()
  })

  it("_resetSoloditState clears flag and is re-entrant", () => {
    _resetSoloditState()
    expect(lifecycleModule.soloditAvailable).toBe(false)
    _resetSoloditState()
    expect(lifecycleModule.soloditAvailable).toBe(false)
  })

  it("plugin initializes gracefully when Solodit never starts", async () => {
    globalThis.fetch = (async () => {
      throw new Error("Connection refused")
    }) as unknown as typeof fetch

    _setTestConfig({ spawnFn: () => createFakeChild(1) })

    const ctx = { directory: process.cwd() } as Parameters<typeof ArgusPlugin>[0]
    const result = await ArgusPlugin(ctx)

    expect(result.tool).toBeDefined()
    expect(Object.keys(result.tool ?? {}).length).toBeGreaterThan(0)
    expect(lifecycleModule.soloditAvailable).toBe(false)
  })

  it("restart uses mock spawn function instead of real Bun.spawn", async () => {
    let spawnCalled = false
    _setTestConfig({
      spawnFn: () => {
        spawnCalled = true
        return createFakeChild()
      },
    })

    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch
    await _runMonitoringCycle(3000)

    globalThis.fetch = (async () => {
      throw new Error("Dead")
    }) as unknown as typeof fetch
    await _runMonitoringCycle(3000)

    expect(spawnCalled).toBe(true)
  })
})
