import { withRetry } from "./knowledge/retry"
import { createLogger } from "./shared/logger"
import { buildSafeEnv } from "./shared/process-runner"
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
let restartPromise: Promise<boolean | undefined> | null = null
let startupPromise: Promise<void> | null = null

/** Whether the Solodit MCP server is currently available for tool calls. */
let _soloditAvailable = false

/** Returns whether the Solodit MCP server is currently available. */
export function isSoloditAvailable(): boolean {
  return _soloditAvailable
}

let lifecycleState: LifecycleState = "stopped"
let lifecycleError: string | undefined

const DEFAULT_RESTART_SETTLE_MS = 2_000
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000
const HEALTH_CHECK_INTERVAL_MS = 60_000

let restartSettleMs = DEFAULT_RESTART_SETTLE_MS
let retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS

function withSuppressedParentOutput<T>(fn: () => T): T {
  const savedStdoutWrite = process.stdout.write.bind(process.stdout)
  const savedStderrWrite = process.stderr.write.bind(process.stderr)
  const noop = (() => true) as typeof process.stdout.write

  process.stdout.write = noop
  process.stderr.write = noop

  try {
    return fn()
  } finally {
    process.stdout.write = savedStdoutWrite
    process.stderr.write = savedStderrWrite
  }
}

// Pin the auto-installed Solodit MCP package: an unpinned `npx -y <pkg>` executes
// whatever the registry currently serves as latest (supply-chain risk). Pair it with
// a minimal, secret-free environment instead of the full inherited process.env.
const SOLODIT_MCP_PACKAGE = "@lyuboslavlyubenov/solodit-mcp@1.1.1"

export function buildSoloditSpawnConfig(port: number): {
  cmd: string[]
  env: Record<string, string>
} {
  return {
    cmd: ["npx", "-y", SOLODIT_MCP_PACKAGE],
    env: buildSafeEnv({ PORT: String(port) }),
  }
}

const defaultSpawnFn = (port: number): SoloditChildProcess => {
  const { cmd, env } = buildSoloditSpawnConfig(port)
  return withSuppressedParentOutput(() =>
    Bun.spawn(cmd, {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env,
    }),
  )
}

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
  child.exited
    .then((code) => {
      if (code !== 0 && code !== null) {
        logger.warn(`Solodit MCP exited with code ${code}`)
      }
      if (soloditChild === child) {
        soloditChild = null
      }
    })
    .catch((error) => {
      logger.warn(
        `Solodit MCP exit tracking failed: ${error instanceof Error ? error.message : String(error)}`,
      )
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
let sigintHandler: (() => void) | null = null
let sigtermHandler: (() => void) | null = null

function ensureExitHandler(): void {
  if (exitHandlerRegistered) return
  exitHandlerRegistered = true
  process.on("exit", killSoloditChild)
  sigintHandler = () => {
    killSoloditChild()
    process.exit(130)
  }
  sigtermHandler = () => {
    killSoloditChild()
    process.exit(143)
  }
  process.on("SIGINT", sigintHandler)
  process.on("SIGTERM", sigtermHandler)
}

async function restartSoloditMcp(port: number): Promise<boolean> {
  const logger = createLogger()

  // Pre-check: if existing instance recovered, skip restart entirely
  const preCheck = await checkSoloditHealth(port, true)
  if (preCheck.reachable) {
    _soloditAvailable = true
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
    _soloditAvailable = false
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
    _soloditAvailable = true
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
  // Use a promise-based mutex to prevent concurrent restart attempts.
  // If a restart is already in flight, wait for it rather than starting another.
  if (restartPromise) {
    await restartPromise.catch(() => {})
    return
  }
  const logger = createLogger()
  try {
    const health = await checkSoloditHealth(port, true)
    if (health.reachable) {
      if (!_soloditAvailable) {
        _soloditAvailable = true
        lifecycleState = "running"
        lifecycleError = undefined
        logger.info("Solodit MCP recovered — now available")
      }
    } else if (_soloditAvailable) {
      _soloditAvailable = false
      logger.warn("Solodit MCP health check failed, attempting restart...")
      restartPromise = restartSoloditMcp(port).finally(() => {
        restartPromise = null
      })
      await restartPromise
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
  _soloditAvailable = false
  restartPromise = null
  startupPromise = null
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
  // Remove registered signal/exit handlers to prevent accumulation
  process.removeListener("exit", killSoloditChild)
  if (sigintHandler) {
    process.removeListener("SIGINT", sigintHandler)
    sigintHandler = null
  }
  if (sigtermHandler) {
    process.removeListener("SIGTERM", sigtermHandler)
    sigtermHandler = null
  }
  // Reset exit handler so tests can re-register cleanly
  exitHandlerRegistered = false
}

/** Set _soloditAvailable flag — for testing only. */
export function _setSoloditAvailable(value: boolean): void {
  _soloditAvailable = value
}

async function startSoloditMcpInternal(port: number): Promise<void> {
  const logger = createLogger()
  lifecycleState = "starting"
  lifecycleError = undefined
  ensureExitHandler()

  const health = await checkSoloditHealth(port, true)
  if (health.reachable) {
    logger.debug(`Solodit MCP already running on port ${port} — skipping spawn`)
    _soloditAvailable = true
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
    _soloditAvailable = false
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
      _soloditAvailable = true
      lifecycleState = "running"
      logger.debug(`Solodit MCP healthy on port ${port}`)
      break
    }
  }
  if (!_soloditAvailable) {
    lifecycleState = "failed"
    lifecycleError = "Solodit MCP not reachable after startup — monitoring will retry"
    logger.warn(lifecycleError)
  }

  startMonitoring(port)
}

export async function startSoloditMcp(
  port: number,
  options: { waitForHealth?: boolean } = {},
): Promise<void> {
  const waitForHealth = options.waitForHealth ?? true

  if (startupPromise) {
    if (waitForHealth) {
      await startupPromise
    }
    return
  }

  let promise!: Promise<void>
  promise = startSoloditMcpInternal(port).finally(() => {
    if (startupPromise === promise) {
      startupPromise = null
    }
  })
  startupPromise = promise

  if (waitForHealth) {
    await promise
  }
}
