import type { Plugin } from "@opencode-ai/plugin"
import { loadArgusConfig } from "./config/loader"
import { createHookGuard } from "./hooks/hook-system"
import { createTools } from "./create-tools"
import { createHooks } from "./create-hooks"
import { createManagers } from "./create-managers"
import { createPluginInterface } from "./plugin-interface"
import { startSoloditMcp } from "./solodit-lifecycle"
import type { Dispatcher } from "./features/background-agent/background-manager"

const ArgusPlugin: Plugin = async (ctx) => {
  const projectDir = ctx.directory ?? process.cwd()
  const config = loadArgusConfig(projectDir)

  if (config.solodit?.enabled !== false) {
    startSoloditMcp(config.solodit?.port ?? 3000)
  }

  const isHookEnabled = createHookGuard(config.disabled_hooks)
  const taskCandidate = (ctx as Record<string, unknown>)["task"]
  const backgroundDispatcher: Dispatcher | undefined =
    typeof taskCandidate === "function"
      ? async (agentName: string, prompt: string) => {
          const result = await taskCandidate(agentName, prompt)
          if (typeof result === "string") {
            return result
          }
          if (typeof result === "object" && result !== null) {
            const taskId = (result as Record<string, unknown>)["task_id"]
            if (typeof taskId === "string") {
              return taskId
            }
          }
          return `task-${Date.now()}`
        }
      : undefined

  const managers = createManagers({ projectDir, config, backgroundDispatcher })
  const tools = createTools(config)
  const hooks = createHooks({ config, managers, projectDir, isHookEnabled })

  return createPluginInterface({ tools, hooks })
}

export default ArgusPlugin
