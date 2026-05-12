import type { AuditStateManager } from "../../managers/types"
import { createLogger } from "../../shared/logger"
import type { AuditState } from "../../state/types"

export function createSessionRecoveryHandler(auditStateManager: AuditStateManager) {
  const logger = createLogger()

  return async (event: {
    type: string
    sessionId?: string
    setAuditState?: (state: AuditState | null) => void
  }): Promise<void> => {
    if (event.type !== "session.error") return

    logger.info("Session error detected, attempting state recovery...")

    try {
      const recovered = await auditStateManager.load()
      if (recovered) {
        event.setAuditState?.(recovered)
        logger.info(
          `State recovered: phase=${recovered.currentPhase}, findings=${recovered.findings.length}`,
        )
      } else {
        logger.warn("No persisted state available for recovery")
      }
    } catch (error) {
      logger.error("State recovery failed:", error)
    }
  }
}
