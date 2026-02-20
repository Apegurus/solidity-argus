import type { Plugin } from "@opencode-ai/plugin"
import { loadArgusConfig } from "./config/loader"
import { createHookGuard } from "./hooks/hook-system"
import { createTools } from "./create-tools"
import { createHooks } from "./create-hooks"
import { createManagers } from "./create-managers"
import { createPluginInterface } from "./plugin-interface"
import { checkSoloditHealth } from "./utils/solodit-health"
import { createLogger } from "./shared/logger"

let soloditChild: ReturnType<typeof Bun.spawn> | null = null

async function startSoloditMcp(port: number): Promise<void> {
  const logger = createLogger()

  const health = await checkSoloditHealth(port, true)
  if (health.reachable) {
    logger.debug(`Solodit MCP already running on port ${port} — skipping spawn`)
    return
  }

  soloditChild = Bun.spawn(["npx", "-y", "@lyuboslavlyubenov/solodit-mcp"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    env: { ...process.env, PORT: String(port) },
  })
  soloditChild.unref()

  const child = soloditChild
  setTimeout(async () => {
    const health = await checkSoloditHealth(port, true)
    if (!health.reachable) {
      logger.debug(`Solodit MCP not yet reachable on port ${port} — will retry on first use`)
    } else {
      logger.debug(`Solodit MCP healthy on port ${port}`)
    }
  }, 2000)

  child.exited.then((code) => {
    if (code !== 0 && code !== null) {
      logger.warn(`Solodit MCP exited with code ${code}`)
    }
    if (soloditChild === child) {
      soloditChild = null
    }
  })
}

const ArgusPlugin: Plugin = async (ctx) => {
  const projectDir = ctx.directory ?? process.cwd()
  const config = loadArgusConfig(projectDir)

  if (config.solodit?.enabled !== false) {
    // Fire-and-forget: startSoloditMcp is now async but we don't await
    // to avoid blocking plugin initialization
    startSoloditMcp(config.solodit?.port ?? 3000)
  }

  const isHookEnabled = createHookGuard(config.disabled_hooks)
  const managers = createManagers({ projectDir, config })
  const tools = createTools(config)
  const hooks = createHooks({ config, managers, projectDir, isHookEnabled })

  return createPluginInterface({ tools, hooks })
}

export default ArgusPlugin
