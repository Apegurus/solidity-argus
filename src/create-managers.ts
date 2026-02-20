import type { ArgusConfig } from "./config/types"
import type { Managers } from "./managers/types"
import { createBackgroundManager } from "./features/background-agent/background-manager"
import type { Dispatcher } from "./features/background-agent/background-manager"
import { createAuditStateManager } from "./features/persistent-state/audit-state-manager"
import { createLogger } from "./shared/logger"

export function createManagers(args: {
  projectDir: string
  config: ArgusConfig
  backgroundDispatcher?: Dispatcher
}): Managers {
  const { projectDir, config, backgroundDispatcher } = args
  const logger = createLogger()

  const backgroundManager = createBackgroundManager(
    backgroundDispatcher ?? (async (agentName: string, prompt: string) => {
      logger.warn(
        `Background dispatch not wired: ${agentName} (${prompt.slice(0, 50)}...)`,
      )
      return `noop-${Date.now()}`
    }),
    { maxConcurrent: config.background?.max_concurrent ?? 3 },
  )

  const auditStateManager = createAuditStateManager(projectDir)

  return { backgroundManager, auditStateManager }
}
