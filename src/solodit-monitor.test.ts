import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import ArgusPlugin from "./index"
import * as lifecycleModule from "./solodit-lifecycle"

const {
  _runMonitoringCycle,
  _resetSoloditState,
  _setTestConfig,
  stopSoloditMonitoring,
  startSoloditMcp,
  getLifecycleStatus,
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

describe("Solodit lifecycle status", () => {
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

  it("getLifecycleStatus returns stopped after reset", () => {
    expect(getLifecycleStatus()).toEqual({ state: "stopped" })
  })

  it("getLifecycleStatus returns running after health check passes", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch

    await _runMonitoringCycle(3000)

    const status = getLifecycleStatus()
    expect(status.state).toBe("running")
    expect(status.error).toBeUndefined()
  })

  it("getLifecycleStatus returns failed after restart failure", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch
    await _runMonitoringCycle(3000)

    globalThis.fetch = (async () => {
      throw new Error("Dead")
    }) as unknown as typeof fetch
    await _runMonitoringCycle(3000)

    const status = getLifecycleStatus()
    expect(status.state).toBe("failed")
    expect(status.error).toBeDefined()
  })
})

describe("Solodit healthy instance reuse", () => {
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

  it("startSoloditMcp reuses healthy external instance without spawning", async () => {
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

    await startSoloditMcp(3000)

    expect(spawnCalled).toBe(false)
    expect(lifecycleModule.soloditAvailable).toBe(true)
    expect(getLifecycleStatus().state).toBe("running")
  })

  it("restart skips spawn when server recovered between check and restart", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch
    await _runMonitoringCycle(3000)
    expect(lifecycleModule.soloditAvailable).toBe(true)

    let fetchCallCount = 0
    globalThis.fetch = (async () => {
      fetchCallCount++
      if (fetchCallCount === 1) {
        throw new Error("Connection refused")
      }
      return { ok: true, status: 200 }
    }) as unknown as typeof fetch

    let spawnCalled = false
    _setTestConfig({
      restartSettleMs: 0,
      retryBaseDelayMs: 1,
      spawnFn: () => {
        spawnCalled = true
        return createFakeChild()
      },
    })

    await _runMonitoringCycle(3000)

    expect(spawnCalled).toBe(false)
    expect(lifecycleModule.soloditAvailable).toBe(true)
    expect(getLifecycleStatus().state).toBe("running")
  })
})

describe("Solodit spawn error handling", () => {
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

  it("EADDRINUSE sets failed state with port conflict diagnostic", async () => {
    const eaddrinuse = new Error("listen EADDRINUSE: address already in use :::3000")
    Object.assign(eaddrinuse, { code: "EADDRINUSE" })

    _setTestConfig({
      spawnFn: () => {
        throw eaddrinuse
      },
    })

    globalThis.fetch = (async () => {
      throw new Error("Connection refused")
    }) as unknown as typeof fetch

    await startSoloditMcp(3000)

    expect(lifecycleModule.soloditAvailable).toBe(false)
    const status = getLifecycleStatus()
    expect(status.state).toBe("failed")
    expect(status.error).toContain("EADDRINUSE")
    expect(status.error).toContain("Port 3000")
  })

  it("ENOENT sets failed state with binary-not-found diagnostic", async () => {
    const enoent = new Error("spawn npx ENOENT")
    Object.assign(enoent, { code: "ENOENT" })

    _setTestConfig({
      spawnFn: () => {
        throw enoent
      },
    })

    globalThis.fetch = (async () => {
      throw new Error("Connection refused")
    }) as unknown as typeof fetch

    await startSoloditMcp(3000)

    expect(lifecycleModule.soloditAvailable).toBe(false)
    const status = getLifecycleStatus()
    expect(status.state).toBe("failed")
    expect(status.error).toContain("ENOENT")
  })

  it("generic spawn error surfaces message in lifecycle status", async () => {
    _setTestConfig({
      spawnFn: () => {
        throw new Error("Unexpected spawn failure")
      },
    })

    globalThis.fetch = (async () => {
      throw new Error("Connection refused")
    }) as unknown as typeof fetch

    await startSoloditMcp(3000)

    expect(lifecycleModule.soloditAvailable).toBe(false)
    const status = getLifecycleStatus()
    expect(status.state).toBe("failed")
    expect(status.error).toContain("Unexpected spawn failure")
  })

  it("EADDRINUSE during restart sets failed state with diagnostic", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch
    await _runMonitoringCycle(3000)
    expect(lifecycleModule.soloditAvailable).toBe(true)

    globalThis.fetch = (async () => {
      throw new Error("Dead")
    }) as unknown as typeof fetch

    const eaddrinuse = new Error("EADDRINUSE")
    Object.assign(eaddrinuse, { code: "EADDRINUSE" })
    _setTestConfig({
      restartSettleMs: 0,
      retryBaseDelayMs: 1,
      spawnFn: () => {
        throw eaddrinuse
      },
    })

    await _runMonitoringCycle(3000)

    expect(lifecycleModule.soloditAvailable).toBe(false)
    const status = getLifecycleStatus()
    expect(status.state).toBe("failed")
    expect(status.error).toContain("EADDRINUSE")
  })
})

describe("Solodit deterministic restart", () => {
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

  it("restart spawns new process and recovers when health returns", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch
    await _runMonitoringCycle(3000)
    expect(lifecycleModule.soloditAvailable).toBe(true)

    let fetchCallCount = 0
    globalThis.fetch = (async () => {
      fetchCallCount++
      if (fetchCallCount <= 2) {
        throw new Error("Dead")
      }
      return { ok: true, status: 200 }
    }) as unknown as typeof fetch

    _setTestConfig({
      restartSettleMs: 0,
      retryBaseDelayMs: 1,
      spawnFn: () => createFakeChild(),
    })

    await _runMonitoringCycle(3000)

    expect(lifecycleModule.soloditAvailable).toBe(true)
    expect(getLifecycleStatus().state).toBe("running")
  })

  it("lifecycle transitions: stopped -> starting -> running", async () => {
    expect(getLifecycleStatus().state).toBe("stopped")

    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch

    await startSoloditMcp(3000)

    expect(getLifecycleStatus().state).toBe("running")
  })

  it("lifecycle transitions: stopped -> starting -> failed on spawn error", async () => {
    expect(getLifecycleStatus().state).toBe("stopped")

    _setTestConfig({
      spawnFn: () => {
        throw new Error("boom")
      },
    })

    globalThis.fetch = (async () => {
      throw new Error("Connection refused")
    }) as unknown as typeof fetch

    await startSoloditMcp(3000)

    expect(getLifecycleStatus().state).toBe("failed")
    expect(getLifecycleStatus().error).toContain("boom")
  })

  it("reset returns lifecycle to stopped", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch
    await _runMonitoringCycle(3000)
    expect(getLifecycleStatus().state).toBe("running")

    _resetSoloditState()

    expect(getLifecycleStatus().state).toBe("stopped")
    expect(getLifecycleStatus().error).toBeUndefined()
  })
})
