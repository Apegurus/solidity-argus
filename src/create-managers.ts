import type { ArgusConfig } from "./config/types"
import type { Dispatcher } from "./features/background-agent/background-manager"
import { createBackgroundManager } from "./features/background-agent/background-manager"
import { createAuditStateManager } from "./features/persistent-state/audit-state-manager"
import type { Managers } from "./managers/types"
import { createLogger } from "./shared/logger"

export function createManagers(args: {
  projectDir: string
  config: ArgusConfig
  backgroundDispatcher?: Dispatcher
}): Managers {
  const { projectDir, config, backgroundDispatcher } = args
  const logger = createLogger()

  const backgroundManager = createBackgroundManager(
    backgroundDispatcher ??
      (async (agentName: string, prompt: string) => {
        logger.warn(
          `Background dispatcher not configured — task will not be executed: ${agentName} (${prompt.slice(0, 50)}...)`,
        )
        return ""
      }),
    { maxConcurrent: config.background?.max_concurrent ?? 3 },
  )

  const auditStateManager = createAuditStateManager(projectDir)

  return { backgroundManager, auditStateManager }
}
