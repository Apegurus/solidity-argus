import type { Plugin } from "@opencode-ai/plugin"
import { loadArgusConfig } from "./config/loader"
import { createHooks } from "./create-hooks"
import { createTools } from "./create-tools"
import { createAuditStateManager } from "./features/persistent-state/audit-state-manager"
import { createHookGuard } from "./hooks/hook-system"
import { createLogger } from "./shared/logger"

const logger = createLogger()

const ArgusPlugin: Plugin = async (ctx) => {
  const projectDir = ctx.directory ?? process.cwd()
  const config = loadArgusConfig(projectDir)

  const { resolveBuildProvenance, formatBuildBanner } = await import("./shared/plugin-metadata")
  const buildBanner = `[argus] ${formatBuildBanner(resolveBuildProvenance())} — auditing ${projectDir}`
  // Emit to stderr (visible at TUI startup) and the file-backed log so an operator can
  // grep the loaded commit/dir to prove which build is live.
  console.error(buildBanner)
  logger.info(buildBanner)

  const isHookEnabled = createHookGuard(config.disabled_hooks)
  const auditStateManager = createAuditStateManager(projectDir)
  const tools = createTools(config)
  const hooks = createHooks({ config, auditStateManager, projectDir, isHookEnabled })

  return {
    tool: tools,
    config: hooks.config,
    ...(hooks["chat.params"] ? { "chat.params": hooks["chat.params"] } : {}),
    ...(hooks["chat.message"] ? { "chat.message": hooks["chat.message"] } : {}),
    ...(hooks["experimental.chat.system.transform"]
      ? { "experimental.chat.system.transform": hooks["experimental.chat.system.transform"] }
      : {}),
    ...(hooks["experimental.session.compacting"]
      ? { "experimental.session.compacting": hooks["experimental.session.compacting"] }
      : {}),
    ...(hooks["experimental.text.complete"]
      ? { "experimental.text.complete": hooks["experimental.text.complete"] }
      : {}),
    ...(hooks["tool.execute.after"] ? { "tool.execute.after": hooks["tool.execute.after"] } : {}),
    ...(hooks.event ? { event: hooks.event } : {}),
  }
}

export default ArgusPlugin
