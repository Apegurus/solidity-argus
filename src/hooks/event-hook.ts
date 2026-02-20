import type { AuditState } from "../state/types"
import { createAuditState } from "../state/audit-state"
import { createLogger } from "../shared/logger"

export type EventHookFn = (input: {
  event: { type: string; sessionId?: string }
}) => Promise<void>

/**
 * Creates a session lifecycle event hook that manages audit state.
 *
 * Returns the hook function plus accessors for reading/writing the
 * closure-held audit state. Other hooks (compaction, tool tracking,
 * system prompt) share the same state instance via these accessors.
 */
export function createEventHook(projectDir?: string): {
  hook: EventHookFn
  getAuditState: () => AuditState | null
  setAuditState: (state: AuditState | null) => void
} {
  let currentAuditState: AuditState | null = null

  const getAuditState = (): AuditState | null => currentAuditState

  const setAuditState = (state: AuditState | null): void => {
    currentAuditState = state
  }

  const hook: EventHookFn = async (input): Promise<void> => {
    const { type } = input.event

    switch (type) {
      case "session.created": {
        const dir = projectDir ?? process.cwd()
        const { state } = createAuditState(dir)
        currentAuditState = state
        break
      }

      case "session.idle": {
         if (currentAuditState) {
           createLogger().debug(
             `[state] Session idle — phase: ${currentAuditState.currentPhase}, findings: ${currentAuditState.findings.length}, contracts: ${currentAuditState.contractsReviewed.length}`
           )
         }
         break
       }

      case "session.error": {
        if (currentAuditState) {
          createLogger().error(
            `Session error — state snapshot: ${JSON.stringify({
              sessionId: currentAuditState.sessionId,
              phase: currentAuditState.currentPhase,
              findingsCount: currentAuditState.findings.length,
              contractsReviewed: currentAuditState.contractsReviewed,
            })}`
          )
        }
        break
      }

      case "session.deleted": {
        currentAuditState = null
        break
      }

      // Unknown events: no-op — never throw
      default:
        break
    }
  }

  return { hook, getAuditState, setAuditState }
}
