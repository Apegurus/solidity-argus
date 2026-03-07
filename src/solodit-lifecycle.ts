import { withRetry } from "./knowledge/retry"
import { createLogger } from "./shared/logger"
import { checkSoloditHealth } from "./utils/solodit-health"

interface SoloditChildProcess {
  kill(signal?: number): void
  unref(): void
  readonly exited: Promise<number | null>
  readonly pid?: number
}

export type LifecycleState = "starting" | "running" | "failed" | "stopped"

export interface LifecycleStatus {
  state: LifecycleState
  error?: string
  pid?: number
}

let soloditChild: SoloditChildProcess | null = null
let monitorTimer: ReturnType<typeof setInterval> | null = null
let isRestarting = false

/** Whether the Solodit MCP server is currently available for tool calls. */
export let soloditAvailable = false

let lifecycleState: LifecycleState = "stopped"
let lifecycleError: string | undefined

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

/** Returns the current lifecycle status of the Solodit MCP server. */
export function getLifecycleStatus(): LifecycleStatus {
  const status: LifecycleStatus = { state: lifecycleState }
  if (lifecycleError) status.error = lifecycleError
  if (soloditChild?.pid !== undefined) status.pid = soloditChild.pid
  return status
}

function classifySpawnError(err: unknown, port: number): string {
  const error = err instanceof Error ? err : new Error(String(err))
  const code = (error as NodeJS.ErrnoException).code
  if (code === "EADDRINUSE") {
    return `Port ${port} already in use — cannot spawn Solodit MCP (EADDRINUSE)`
  }
  if (code === "ENOENT") {
    return `Solodit MCP binary not found — ensure npx and @lyuboslavlyubenov/solodit-mcp are available (ENOENT)`
  }
  return `Failed to spawn Solodit MCP on port ${port}: ${error.message}`
}

function spawnSoloditChild(port: number): SoloditChildProcess {
  try {
    const child = spawnFn(port)
    // Do NOT unref() — child must die with the parent process.
    // unref() lets the parent exit without waiting for the child,
    // creating orphaned solodit-mcp processes that hoard ports.
    return child
  } catch (err) {
    const message = classifySpawnError(err, port)
    lifecycleState = "failed"
    lifecycleError = message
    throw new Error(message)
  }
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

/** Kill the solodit-mcp child process. Called on parent exit to prevent orphans. */
function killSoloditChild(): void {
  if (soloditChild) {
    try {
      soloditChild.kill()
    } catch {
      // Process already dead — ignore.
    }
    soloditChild = null
  }
}

// Register once: kill child on parent exit to prevent orphaned processes.
let exitHandlerRegistered = false
function ensureExitHandler(): void {
  if (exitHandlerRegistered) return
  exitHandlerRegistered = true
  process.on("exit", killSoloditChild)
  process.on("SIGINT", () => {
    killSoloditChild()
    process.exitCode = 130
  })
  process.on("SIGTERM", () => {
    killSoloditChild()
    process.exitCode = 143
  })
}

async function restartSoloditMcp(port: number): Promise<boolean> {
  const logger = createLogger()

  // Pre-check: if existing instance recovered, skip restart entirely
  const preCheck = await checkSoloditHealth(port, true)
  if (preCheck.reachable) {
    soloditAvailable = true
    lifecycleState = "running"
    lifecycleError = undefined
    logger.info("Solodit MCP already healthy — skipping restart")
    return true
  }

  if (soloditChild) {
    try {
      soloditChild.kill()
    } catch {
      logger.debug("Solodit MCP process already dead")
    }
    soloditChild = null
  }

  try {
    lifecycleState = "starting"
    lifecycleError = undefined
    soloditChild = spawnSoloditChild(port)
    trackChildExit(soloditChild)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(`Solodit MCP spawn failed: ${message}`)
    lifecycleState = "failed"
    lifecycleError = message
    soloditAvailable = false
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
    lifecycleState = "running"
    lifecycleError = undefined
    logger.info("Solodit MCP restarted successfully")
    return true
  }

  lifecycleState = "failed"
  lifecycleError = "Solodit MCP not reachable after restart attempts"
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
        lifecycleState = "running"
        lifecycleError = undefined
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
  lifecycleState = "stopped"
  lifecycleError = undefined
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
  // Reset exit handler so tests can re-register cleanly
  exitHandlerRegistered = false
}

/** Set soloditAvailable flag — for testing only. */
export function _setSoloditAvailable(value: boolean): void {
  soloditAvailable = value
}

export async function startSoloditMcp(port: number): Promise<void> {
  const logger = createLogger()
  lifecycleState = "starting"
  lifecycleError = undefined
  ensureExitHandler()

  const health = await checkSoloditHealth(port, true)
  if (health.reachable) {
    logger.debug(`Solodit MCP already running on port ${port} — skipping spawn`)
    soloditAvailable = true
    lifecycleState = "running"
    startMonitoring(port)
    return
  }

  try {
    soloditChild = spawnSoloditChild(port)
    trackChildExit(soloditChild)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(`Solodit MCP startup failed: ${message}`)
    lifecycleState = "failed"
    lifecycleError = message
    soloditAvailable = false
    startMonitoring(port)
    return
  }

  const deadline = AbortSignal.timeout(5000)
  const delays = [1000, 2000]
  for (const delay of delays) {
    if (deadline.aborted) break
    await Bun.sleep(delay)
    if (deadline.aborted) break
    const healthResult = await checkSoloditHealth(port, true)
    if (healthResult.reachable) {
      soloditAvailable = true
      lifecycleState = "running"
      logger.debug(`Solodit MCP healthy on port ${port}`)
      break
    }
  }
  if (!soloditAvailable) {
    lifecycleState = "failed"
    lifecycleError = "Solodit MCP not reachable after startup — monitoring will retry"
    logger.warn(lifecycleError)
  }

  startMonitoring(port)
}
