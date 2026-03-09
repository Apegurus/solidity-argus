import type { Plugin } from "@opencode-ai/plugin"
import { loadArgusConfig } from "./config/loader"
import { createHooks } from "./create-hooks"
import { createManagers } from "./create-managers"
import { createTools } from "./create-tools"
import type { Dispatcher } from "./features/background-agent/background-manager"
import { createConfigHandler } from "./hooks/config-handler"
import { createHookGuard } from "./hooks/hook-system"
import { createPluginInterface } from "./plugin-interface"
import { createLogger } from "./shared/logger"
import { startSoloditMcp } from "./solodit-lifecycle"
import { DEFAULT_SOLODIT_PORT } from "./tools/solodit-search-tool"

const logger = createLogger()

// Instance-level mutual exclusion: when OpenCode loads the plugin multiple
// times (e.g. local dev path + npm package + fixture config), only the first
// load gets stateful hooks. Subsequent loads register tools and agent config
// only — no event handlers, no state management, no duplicate sinks.
const INSTANCE_LOCK_KEY = Symbol.for("solidity-argus:instanceLock")
const globalRecord = globalThis as unknown as Record<symbol, boolean>

export function _resetInstanceLockForTesting(): void {
  delete globalRecord[INSTANCE_LOCK_KEY]
}

const ArgusPlugin: Plugin = async (ctx) => {
  const projectDir = ctx.directory ?? process.cwd()
  const config = loadArgusConfig(projectDir)
  const tools = createTools(config)

  if (globalRecord[INSTANCE_LOCK_KEY]) {
    logger.warn(
      "Another solidity-argus instance is already active in this process — registering tools and agents only (hooks disabled)",
    )
    return { tool: tools, config: createConfigHandler(config, projectDir) }
  }
  globalRecord[INSTANCE_LOCK_KEY] = true

  if (config.solodit?.enabled !== false) {
    // Suppress Bun auto-install stdout/stderr noise during Solodit MCP startup.
    // Bun prints "bun install v..." and internal warnings to the parent process
    // when resolving dependencies, which pollutes OpenCode's TUI.
    const savedStdoutWrite = process.stdout.write.bind(process.stdout)
    const savedStderrWrite = process.stderr.write.bind(process.stderr)
    const noop = (() => true) as typeof process.stdout.write
    process.stdout.write = noop
    process.stderr.write = noop
    try {
      await startSoloditMcp(config.solodit?.port ?? DEFAULT_SOLODIT_PORT)
    } finally {
      process.stdout.write = savedStdoutWrite
      process.stderr.write = savedStderrWrite
    }
  }

  const isHookEnabled = createHookGuard(config.disabled_hooks)
  const taskCandidate = (ctx as Record<string, unknown>).task
  const backgroundDispatcher: Dispatcher | undefined =
    typeof taskCandidate === "function"
      ? async (agentName: string, prompt: string) => {
          const result = await taskCandidate(agentName, prompt)
          if (typeof result === "string") {
            return result
          }
          if (typeof result === "object" && result !== null) {
            const taskId = (result as Record<string, unknown>).task_id
            if (typeof taskId === "string") {
              return taskId
            }
          }
          return `task-${Date.now()}`
        }
      : undefined

  const managers = createManagers({ projectDir, config, backgroundDispatcher })
  const hooks = createHooks({ config, managers, projectDir, isHookEnabled })

  return createPluginInterface({ tools, hooks })
}

export default ArgusPlugin
