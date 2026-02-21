import { withRetry } from "./knowledge/retry"
import { createLogger } from "./shared/logger"
import { checkSoloditHealth } from "./utils/solodit-health"

interface SoloditChildProcess {
  kill(signal?: number): void
  unref(): void
  readonly exited: Promise<number | null>
}

let soloditChild: SoloditChildProcess | null = null
let monitorTimer: ReturnType<typeof setInterval> | null = null
let isRestarting = false

/** Whether the Solodit MCP server is currently available for tool calls. */
export let soloditAvailable = false

const DEFAULT_RESTART_SETTLE_MS = 2_000
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000
const HEALTH_CHECK_INTERVAL_MS = 60_000

let restartSettleMs = DEFAULT_RESTART_SETTLE_MS
let retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS

const defaultSpawnFn = (port: number): SoloditChildProcess =>
  Bun.spawn(["npx", "-y", "@lyuboslavlyubenov/solodit-mcp"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    env: { ...process.env, PORT: String(port) },
  })

let spawnFn: (port: number) => SoloditChildProcess = defaultSpawnFn

/** Override internal timing and spawn for testing. */
export function _setTestConfig(config: {
  restartSettleMs?: number
  retryBaseDelayMs?: number
  spawnFn?: (port: number) => SoloditChildProcess
}): void {
  if (config.restartSettleMs !== undefined) restartSettleMs = config.restartSettleMs
  if (config.retryBaseDelayMs !== undefined) retryBaseDelayMs = config.retryBaseDelayMs
  if (config.spawnFn !== undefined) spawnFn = config.spawnFn
}

function spawnSoloditChild(port: number): SoloditChildProcess {
  const child = spawnFn(port)
  child.unref()
  return child
}

function trackChildExit(child: SoloditChildProcess): void {
  const logger = createLogger()
  child.exited.then((code) => {
    if (code !== 0 && code !== null) {
      logger.warn(`Solodit MCP exited with code ${code}`)
    }
    if (soloditChild === child) {
      soloditChild = null
    }
  })
}

async function restartSoloditMcp(port: number): Promise<boolean> {
  const logger = createLogger()

  if (soloditChild) {
    try {
      soloditChild.kill()
    } catch {
      logger.debug("Solodit MCP process already dead")
    }
    soloditChild = null
  }

  try {
    soloditChild = spawnSoloditChild(port)
    trackChildExit(soloditChild)
  } catch (err) {
    logger.warn("Failed to spawn Solodit MCP:", err)
    return false
  }

  await Bun.sleep(restartSettleMs)

  const result = await withRetry(
    async () => {
      const health = await checkSoloditHealth(port, true)
      if (!health.reachable) throw new Error("Solodit not reachable after restart")
      return health
    },
    {
      maxAttempts: 3,
      baseDelayMs: retryBaseDelayMs,
      shouldRetry: () => true,
      onRetry: (attempt) => logger.debug(`Solodit restart health retry ${attempt}`),
    },
  )

  if (result.success) {
    soloditAvailable = true
    logger.info("Solodit MCP restarted successfully")
    return true
  }

  logger.warn("Solodit MCP restart failed — will retry next cycle")
  return false
}

export async function _runMonitoringCycle(port: number): Promise<void> {
  if (isRestarting) return
  const logger = createLogger()
  try {
    const health = await checkSoloditHealth(port, true)
    if (health.reachable) {
      if (!soloditAvailable) {
        soloditAvailable = true
        logger.info("Solodit MCP recovered — now available")
      }
    } else if (soloditAvailable) {
      soloditAvailable = false
      logger.warn("Solodit MCP health check failed, attempting restart...")
      isRestarting = true
      try {
        await restartSoloditMcp(port)
      } finally {
        isRestarting = false
      }
    }
  } catch {
    logger.debug("Monitoring cycle encountered an error")
  }
}

function startMonitoring(port: number): void {
  if (monitorTimer) return
  monitorTimer = setInterval(() => {
    _runMonitoringCycle(port)
  }, HEALTH_CHECK_INTERVAL_MS)
  if (monitorTimer && typeof (monitorTimer as NodeJS.Timeout).unref === "function") {
    ;(monitorTimer as NodeJS.Timeout).unref()
  }
}

/** Stop periodic health monitoring. */
export function stopSoloditMonitoring(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer)
    monitorTimer = null
  }
}

/** Reset all Solodit state — for testing only. */
export function _resetSoloditState(): void {
  stopSoloditMonitoring()
  soloditAvailable = false
  isRestarting = false
  restartSettleMs = DEFAULT_RESTART_SETTLE_MS
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS
  spawnFn = defaultSpawnFn
  if (soloditChild) {
    try {
      soloditChild.kill()
    } catch {
      createLogger().debug("Failed to kill Solodit MCP on reset")
    }
    soloditChild = null
  }
}

export async function startSoloditMcp(port: number): Promise<void> {
  const logger = createLogger()

  const health = await checkSoloditHealth(port, true)
  if (health.reachable) {
    logger.debug(`Solodit MCP already running on port ${port} — skipping spawn`)
    soloditAvailable = true
    startMonitoring(port)
    return
  }

  soloditChild = spawnSoloditChild(port)
  trackChildExit(soloditChild)

  const deadline = AbortSignal.timeout(5000)
  const delays = [1000, 2000]
  for (const delay of delays) {
    if (deadline.aborted) break
    await Bun.sleep(delay)
    if (deadline.aborted) break
    const healthResult = await checkSoloditHealth(port, true)
    if (healthResult.reachable) {
      soloditAvailable = true
      logger.debug(`Solodit MCP healthy on port ${port}`)
      break
    }
  }
  if (!soloditAvailable) {
    logger.warn(`Solodit MCP not reachable after startup — monitoring will retry`)
  }

  startMonitoring(port)
}
