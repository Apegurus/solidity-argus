import type { Plugin } from "@opencode-ai/plugin"
import { spawn } from "node:child_process"
import { loadArgusConfig } from "./config/loader"
import { createHookGuard } from "./hooks/hook-system"
import { createTools } from "./create-tools"
import { createHooks } from "./create-hooks"
import { createManagers } from "./create-managers"
import { createPluginInterface } from "./plugin-interface"

function startSoloditMcp(port: number): void {
  const child = spawn("npx", ["-y", "@lyuboslavlyubenov/solodit-mcp"], {
    stdio: "ignore",
    detached: false,
    env: { ...process.env, PORT: String(port) },
  })
  child.unref()
  child.on("error", () => {})
}

const ArgusPlugin: Plugin = async (ctx) => {
  const projectDir = ctx.directory ?? process.cwd()
  const config = loadArgusConfig(projectDir)

  if (config.solodit?.enabled !== false) {
    startSoloditMcp(config.solodit?.port ?? 3000)
  }

  const isHookEnabled = createHookGuard(config.disabled_hooks)
  const managers = createManagers({ projectDir, config })
  const tools = createTools(config)
  const hooks = createHooks({ config, managers, projectDir, isHookEnabled })

  return createPluginInterface({ tools, hooks })
}

export default ArgusPlugin
