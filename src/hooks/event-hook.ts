import type { EventSink } from "../features/persistent-state/event-sink"
import { updateRunStatus } from "../features/persistent-state/global-run-index"
import type { FinalizationResult } from "../features/persistent-state/run-finalizer"
import { finalizeRun } from "../features/persistent-state/run-finalizer"
import { createLogger } from "../shared/logger"
import { ARGUS_PLUGIN_VERSION } from "../shared/plugin-metadata"
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
  event: { type: string; properties?: Record<string, unknown> }
}) => Promise<void>

/**
 * Extract the OpenCode session ID from an SDK Event object.
 *
 * The OpenCode SDK Event union uses different shapes depending on event type:
 *   - session.created / session.deleted → { properties: { info: { id: string } } }
 *   - session.idle / session.error      → { properties: { sessionID: string } }
 *   - Other events may have properties.sessionID or none at all.
 */
function extractSessionId(event: {
  type: string
  properties?: Record<string, unknown>
}): string | undefined {
  const props = event.properties
  if (!props) return undefined

  // session.idle, session.error, and many other events use properties.sessionID
  if (typeof props.sessionID === "string" && props.sessionID.length > 0) {
    return props.sessionID
  }

  // session.created and session.deleted wrap a Session object at properties.info
  const info = props.info
  if (info && typeof info === "object" && info !== null) {
    const infoRecord = info as Record<string, unknown>
    if (typeof infoRecord.id === "string" && infoRecord.id.length > 0) {
      return infoRecord.id
    }
  }

  return undefined
}

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
  getAuditState: (sessionId?: string) => AuditState | null
  setAuditState: (state: AuditState | null, sessionId?: string) => void
  setEventSink: (sink: EventSink | null, sessionId?: string) => void
  getEventSink: (sessionId?: string) => EventSink | null
  getLastFinalizationResult: () => FinalizationResult | null
} {
  const logger = createLogger()
  const statesBySessionId = new Map<string, AuditState>()
  const sinksBySessionId = new Map<string, EventSink>()
  let fallbackAuditState: AuditState | null = null
  let fallbackEventSink: EventSink | null = null
  let activeSessionId = ""
  let lastFinalizationResult: FinalizationResult | null = null

  const getAuditState = (sessionId?: string): AuditState | null => {
    if (sessionId && sessionId.length > 0) {
      const sessionState = statesBySessionId.get(sessionId)
      if (sessionState) {
        return sessionState
      }
      // Fall through to activeSessionId — child sessions (e.g. sentinel)
      // may not have their own state entry but share the parent's state.
    }

    if (activeSessionId.length > 0) {
      return statesBySessionId.get(activeSessionId) ?? fallbackAuditState
    }

    return fallbackAuditState
  }

  const setAuditState = (state: AuditState | null, sessionId?: string): void => {
    if (sessionId && sessionId.length > 0) {
      if (state) {
        statesBySessionId.set(sessionId, state)
        activeSessionId = sessionId
      } else {
        statesBySessionId.delete(sessionId)
      }
      return
    }

    fallbackAuditState = state
  }

  const getEventSink = (sessionId?: string): EventSink | null => {
    if (sessionId && sessionId.length > 0) {
      const sessionSink = sinksBySessionId.get(sessionId)
      if (sessionSink) {
        return sessionSink
      }
      return fallbackEventSink
    }

    if (activeSessionId.length > 0) {
      return sinksBySessionId.get(activeSessionId) ?? fallbackEventSink
    }

    return fallbackEventSink
  }

  const setEventSink = (sink: EventSink | null, sessionId?: string): void => {
    if (sessionId && sessionId.length > 0) {
      if (sink) {
        sinksBySessionId.set(sessionId, sink)
      } else {
        sinksBySessionId.delete(sessionId)
      }
      return
    }

    fallbackEventSink = sink
  }

  async function emitToSink(
    sink: EventSink | null,
    type: AuditEvent["type"],
    runId: string,
    sessionId: string | undefined,
    payload: unknown,
  ): Promise<void> {
    if (!sink) return
    try {
      await sink.append({
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
    const type = input.event.type
    const sessionId = extractSessionId(input.event)
    const sessionKey = sessionId && sessionId.length > 0 ? sessionId : activeSessionId
    let stateForSession = getAuditState(sessionKey)
    let preDeleteState: AuditState | null = null
    const preDeleteSink = getEventSink(sessionKey)

    switch (type) {
      case "session.created": {
        const dir = projectDir ?? process.cwd()
        const { state } = createAuditState(dir)
        if (sessionId && sessionId.length > 0) {
          statesBySessionId.set(sessionId, state)
          activeSessionId = sessionId
        } else {
          fallbackAuditState = state
        }
        stateForSession = state
        break
      }

      case "session.idle": {
        if (stateForSession) {
          logger.debug(
            `Session idle — phase: ${stateForSession.currentPhase}, findings: ${stateForSession.findings.length}`,
          )
        }
        break
      }

      case "session.error": {
        if (stateForSession) {
          logger.error(
            `Session error — state snapshot: ${JSON.stringify({
              sessionId: stateForSession.sessionId,
              phase: stateForSession.currentPhase,
              findingsCount: stateForSession.findings.length,
              contractsReviewed: stateForSession.contractsReviewed,
            })}`,
          )
        }
        break
      }

      case "session.deleted": {
        preDeleteState = stateForSession
        break
      }

      default:
        break
    }

    for (const handler of subHandlers) {
      try {
        const setStateForSession = (state: AuditState | null): void => {
          setAuditState(state, sessionKey)
          stateForSession = state
        }

        await handler({
          type,
          sessionId,
          auditState: stateForSession,
          setAuditState: setStateForSession,
        })
      } catch (error) {
        logger.error(`Sub-handler failed for event ${type}:`, error)
      }
    }

    // Emit canonical events to sink (after sub-handlers, so sink may have been set during session.created)
    const sinkForSession = getEventSink(sessionKey)
    switch (type) {
      case "session.created": {
        if (stateForSession) {
          await emitToSink(
            sinkForSession,
            "session.created",
            stateForSession.sessionId,
            sessionId,
            {
              projectDir: stateForSession.projectDir,
              sessionId: stateForSession.sessionId,
              plugin_version: ARGUS_PLUGIN_VERSION,
              scope: stateForSession.scope,
            },
          )
        }
        break
      }

      case "session.idle": {
        if (stateForSession) {
          await emitToSink(sinkForSession, "session.idle", stateForSession.sessionId, sessionId, {
            findingsCount: stateForSession.findings.length,
            toolsExecutedCount: stateForSession.toolsExecuted.length,
            phase: stateForSession.currentPhase,
          })
        }
        break
      }

      case "session.deleted": {
        if (preDeleteState) {
          await emitToSink(preDeleteSink, "session.deleted", preDeleteState.sessionId, sessionId, {
            archived: true,
            plugin_version: ARGUS_PLUGIN_VERSION,
          })

          const hasSiblingSessionForRun =
            typeof sessionKey === "string" && sessionKey.length > 0
              ? Array.from(sinksBySessionId.entries()).some(
                  ([mappedSessionId, mappedSink]) =>
                    mappedSessionId !== sessionKey && mappedSink.runId === preDeleteState.sessionId,
                )
              : false

          if (preDeleteSink && !preDeleteSink.isFinalized && !hasSiblingSessionForRun) {
            try {
              lastFinalizationResult = await finalizeRun(
                preDeleteState.sessionId,
                preDeleteState.projectDir,
                preDeleteSink,
              )
              void updateRunStatus(
                preDeleteState.sessionId,
                lastFinalizationResult.invariantsPassed ? "finalized" : "failed",
              )
            } catch (error) {
              logger.error(
                `Failed to finalize run ${preDeleteState.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }
        }

        if (sessionKey && sessionKey.length > 0) {
          statesBySessionId.delete(sessionKey)
          sinksBySessionId.delete(sessionKey)
          if (activeSessionId === sessionKey) {
            const nextSession = statesBySessionId.keys().next().value
            activeSessionId = typeof nextSession === "string" ? nextSession : ""
          }
        } else {
          fallbackAuditState = null
          fallbackEventSink = null
        }
        break
      }

      default:
        break
    }
  }

  const getLastFinalizationResult = (): FinalizationResult | null => lastFinalizationResult

  return {
    hook,
    getAuditState,
    setAuditState,
    setEventSink,
    getEventSink,
    getLastFinalizationResult,
  }
}
