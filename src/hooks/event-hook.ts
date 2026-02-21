import { createLogger } from "../shared/logger"
import { createAuditState } from "../state/audit-state"
import type { AuditState } from "../state/types"

export type AuditEventType =
  | "session.created"
  | "session.idle"
  | "session.error"
  | "session.deleted"
  | "audit.phase-changed"
  | "audit.finding-added"
  | "audit.complete"

export type EventHookFn = (input: {
  event: { type: string; sessionId?: string; properties?: Record<string, unknown> }
}) => Promise<void>

export type EventSubHandler = (event: {
  type: string
  sessionId?: string
  auditState: AuditState | null
  setAuditState: (state: AuditState | null) => void
}) => Promise<void>

export function createEventHook(
  projectDir?: string,
  subHandlers: EventSubHandler[] = [],
): {
  hook: EventHookFn
  getAuditState: () => AuditState | null
  setAuditState: (state: AuditState | null) => void
} {
  const logger = createLogger()
  let currentAuditState: AuditState | null = null

  const getAuditState = (): AuditState | null => currentAuditState
  const setAuditState = (state: AuditState | null): void => {
    currentAuditState = state
  }

  const hook: EventHookFn = async (input): Promise<void> => {
    const { type, sessionId } = input.event

    switch (type) {
      case "session.created": {
        const dir = projectDir ?? process.cwd()
        const { state } = createAuditState(dir)
        currentAuditState = state
        break
      }

      case "session.idle": {
        if (currentAuditState) {
          logger.debug(
            `Session idle — phase: ${currentAuditState.currentPhase}, findings: ${currentAuditState.findings.length}`,
          )
        }
        break
      }

      case "session.error": {
        if (currentAuditState) {
          logger.error(
            `Session error — state snapshot: ${JSON.stringify({
              sessionId: currentAuditState.sessionId,
              phase: currentAuditState.currentPhase,
              findingsCount: currentAuditState.findings.length,
              contractsReviewed: currentAuditState.contractsReviewed,
            })}`,
          )
        }
        break
      }

      case "session.deleted": {
        currentAuditState = null
        break
      }

      default:
        break
    }

    for (const handler of subHandlers) {
      try {
        await handler({
          type,
          sessionId,
          auditState: currentAuditState,
          setAuditState,
        })
      } catch (error) {
        logger.error(`Sub-handler failed for event ${type}:`, error)
      }
    }
  }

  return { hook, getAuditState, setAuditState }
}
