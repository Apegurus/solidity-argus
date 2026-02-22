import type { EventSink } from "../features/persistent-state/event-sink"
import { finalizeRun } from "../features/persistent-state/run-finalizer"
import type { FinalizationResult } from "../features/persistent-state/run-finalizer"
import { createLogger } from "../shared/logger"
import { createAuditState } from "../state/audit-state"
import type { AuditEvent } from "../state/schemas"
import { SCHEMA_VERSION } from "../state/schemas"
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
  setEventSink: (sink: EventSink | null) => void
  getLastFinalizationResult: () => FinalizationResult | null
} {
  const logger = createLogger()
  let currentAuditState: AuditState | null = null
  let eventSink: EventSink | null = null
  let lastFinalizationResult: FinalizationResult | null = null

  const getAuditState = (): AuditState | null => currentAuditState
  const setAuditState = (state: AuditState | null): void => {
    currentAuditState = state
  }
  const setEventSink = (sink: EventSink | null): void => {
    eventSink = sink
  }

  async function emitToSink(
    type: AuditEvent["type"],
    runId: string,
    sessionId: string | undefined,
    payload: unknown,
  ): Promise<void> {
    if (!eventSink) return
    try {
      await eventSink.append({
        type,
        run_id: runId,
        seq: 0, // auto-assigned by sink
        session_id: sessionId ?? "",
        source: "event-hook",
        schema_version: SCHEMA_VERSION,
        timestamp: Date.now(),
        payload,
      })
    } catch (error) {
      logger.error(
        `Failed to emit ${type} event to sink: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const hook: EventHookFn = async (input): Promise<void> => {
    const { type, sessionId } = input.event
    let preDeleteState: AuditState | null = null

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
        preDeleteState = currentAuditState
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

    // Emit canonical events to sink (after sub-handlers, so sink may have been set during session.created)
    switch (type) {
      case "session.created": {
        if (currentAuditState) {
          await emitToSink("session.created", currentAuditState.sessionId, sessionId, {
            projectDir: currentAuditState.projectDir,
            sessionId: currentAuditState.sessionId,
          })
        }
        break
      }

      case "session.idle": {
        if (currentAuditState) {
          await emitToSink("session.idle", currentAuditState.sessionId, sessionId, {
            findingsCount: currentAuditState.findings.length,
            toolsExecutedCount: currentAuditState.toolsExecuted.length,
            phase: currentAuditState.currentPhase,
          })
        }
        break
      }

      case "session.deleted": {
        if (preDeleteState) {
          await emitToSink("session.deleted", preDeleteState.sessionId, sessionId, {
            archived: true,
          })

          if (eventSink) {
            try {
              lastFinalizationResult = await finalizeRun(
                preDeleteState.sessionId,
                preDeleteState.projectDir,
                eventSink,
              )
            } catch (error) {
              logger.error(
                `Failed to finalize run ${preDeleteState.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }
        }
        eventSink = null
        break
      }

      default:
        break
    }
  }

  const getLastFinalizationResult = (): FinalizationResult | null => lastFinalizationResult

  return { hook, getAuditState, setAuditState, setEventSink, getLastFinalizationResult }
}
