import type { ArgusConfig } from "./config/types"
import type { Managers } from "./managers/types"
import { createBackgroundManager } from "./features/background-agent/background-manager"
import { createAuditStateManager } from "./features/persistent-state/audit-state-manager"
import { createLogger } from "./shared/logger"

export function createManagers(args: {
  projectDir: string
  config: ArgusConfig
}): Managers {
  const { projectDir } = args
  const logger = createLogger()

  const backgroundManager = createBackgroundManager(
    async (agentName: string, prompt: string) => {
      logger.warn(
        `Background dispatch not wired: ${agentName} (${prompt.slice(0, 50)}...)`,
      )
      return `noop-${Date.now()}`
    },
  )

  const auditStateManager = createAuditStateManager(projectDir)

  return { backgroundManager, auditStateManager }
}
