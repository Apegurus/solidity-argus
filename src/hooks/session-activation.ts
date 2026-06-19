import { createEventSink, type EventSink } from "../features/persistent-state/event-sink"
import { recordRun } from "../features/persistent-state/global-run-index"
import type { createRunJournal } from "../features/persistent-state/run-journal"
import { pruneStaleRuns } from "../features/persistent-state/run-pruner"
import type { AuditStateManager } from "../managers/types"
import { createAuditArtifactResolver } from "../shared/audit-artifact-resolver"
import type { Logger } from "../shared/logger"
import { ARGUS_BUILD_PROVENANCE, ARGUS_PLUGIN_BUILD } from "../shared/plugin-metadata"
import { createAuditState } from "../state/audit-state"
import { SCHEMA_VERSION } from "../state/schemas"
import type { AuditState } from "../state/types"
import type { AgentTracker } from "./agent-tracker"
import type { BoundedSinkRegistry } from "./bounded-sink-registry"

interface SessionActivatorOptions {
  projectDir: string
  agentTracker: Pick<AgentTracker, "getParentSession">
  sinkRegistry: BoundedSinkRegistry
  getAuditState: (sessionId?: string) => AuditState | null
  setAuditState: (state: AuditState | null, sessionId?: string) => void
  setEventSink: (sink: EventSink | null, sessionId?: string) => void
  getSessionManager: (sessionId: string) => AuditStateManager
  runJournal: ReturnType<typeof createRunJournal>
  logger: Logger
  activatedSessions: Set<string>
  pendingActivations: Set<string>
  pendingSinkCreations: Set<string>
}

export function createSessionActivator(options: SessionActivatorOptions) {
  const {
    projectDir,
    agentTracker,
    sinkRegistry,
    getAuditState,
    setAuditState,
    setEventSink,
    getSessionManager,
    runJournal,
    logger,
    activatedSessions,
    pendingActivations,
    pendingSinkCreations,
  } = options

  return async function activateSession(sessionId: string): Promise<void> {
    // Finalized-run stale guard: if this session was activated for a run that has since
    // been finalized, a new audit in the same OpenCode session must start a fresh run
    // rather than inherit the closed run's findings/phase. Reset only on a finalized sink
    // - not on reportGenerated, which is valid between report generation and disposition.
    // forceFreshRun bypasses ALL sink coalescing and recovered-state resumption below so
    // the fresh run cannot bind to the closed run or to an unrelated active run. It is a
    // local flag consumed within this activation - no leak-prone cross-activation marker.
    let forceFreshRun = false
    if (activatedSessions.has(sessionId)) {
      const priorRunId = getAuditState(sessionId)?.sessionId
      const priorSink = priorRunId ? sinkRegistry.getForRun(priorRunId) : undefined
      if (!priorSink?.isFinalized) return
      activatedSessions.delete(sessionId)
      sinkRegistry.deleteSession(sessionId)
      setAuditState(createAuditState(projectDir).state, sessionId)
      forceFreshRun = true
    }
    if (pendingActivations.has(sessionId)) return

    const auditState = getAuditState(sessionId)
    if (!auditState) return

    pendingActivations.add(sessionId)
    // Must be set BEFORE the try block - if two concurrent activateSession calls race,
    // the second must see this guard immediately to prevent duplicate sink creation.
    pendingSinkCreations.add(sessionId)
    let sessionActivated = false
    try {
      const timestamp = Date.now()
      const sessionManager = getSessionManager(sessionId)

      const existingSink = forceFreshRun
        ? null
        : (() => {
            const directSink = sinkRegistry.getForSession(sessionId)
            if (directSink) return directSink

            const parentSessionId = agentTracker.getParentSession(sessionId)
            if (parentSessionId) {
              const parentSink = sinkRegistry.getForSession(parentSessionId)
              if (parentSink) return parentSink
            }

            // Multiple active sinks - pick the most recently created one.
            // This handles the case where a stale run's sink was never finalized.
            return sinkRegistry.getNewestActiveRunSink()
          })()

      // Fallback: if no existing sink found via direct/parent/heuristic lookup,
      // try inheriting the parent's run ID via audit state.
      // This handles the timing race where the child's activateSession fires before
      // the parent's sink is registered by OpenCode session.
      const coalescedSink = forceFreshRun
        ? null
        : (existingSink ??
          (() => {
            const parentSessionId = agentTracker.getParentSession(sessionId)
            if (!parentSessionId) return null
            const parentState = getAuditState(parentSessionId)
            if (!parentState || parentState.sessionId.length === 0) return null
            const parentSink = sinkRegistry.getForRun(parentState.sessionId)
            return parentSink && !parentSink.isFinalized ? parentSink : null
          })())

      if (coalescedSink) {
        setEventSink(coalescedSink, sessionId)
        sinkRegistry.setForSession(sessionId, coalescedSink)
        sinkRegistry.setForRun(coalescedSink.runId, coalescedSink)

        const existingResolver = createAuditArtifactResolver(coalescedSink.runId, projectDir)
        recordRun({
          runId: coalescedSink.runId,
          opencodeSessionId: sessionId,
          projectDir: auditState?.projectDir ?? projectDir,
          statePath: existingResolver.paths().stateFile,
          journalPath: existingResolver.paths().journalFile,
          startedAt: auditState?.startTime ?? timestamp,
          phase: auditState?.currentPhase ?? "reconnaissance",
          findingsCount: auditState?.findings.length ?? 0,
        }).catch((err) =>
          logger.warn(`Failed to record run: ${err instanceof Error ? err.message : String(err)}`),
        )

        if (auditState) {
          setAuditState({ ...auditState, sessionId: coalescedSink.runId }, sessionId)
        }
        runJournal.log({ type: "state.loaded", timestamp, success: true, findingsCount: 0 })
        sessionActivated = true
        return
      }

      let recoveredState: AuditState | null = null
      try {
        recoveredState = await sessionManager.load()
      } finally {
        runJournal.log({
          type: "state.loaded",
          timestamp,
          success: recoveredState !== null,
          findingsCount: recoveredState?.findings.length ?? 0,
        })
      }

      // A session forced into a fresh run must not resume the finalized run's persisted
      // state, even if that snapshot predates a recorded report/disposition.
      if (forceFreshRun) {
        recoveredState = null
      }

      const STALE_STATE_TTL_MS = 24 * 60 * 60 * 1000
      if (recoveredState) {
        const isStale =
          typeof recoveredState.startTime === "number" &&
          timestamp - recoveredState.startTime > STALE_STATE_TTL_MS
        const isCompleted = recoveredState.reportGenerated === true
        if (isStale || isCompleted) {
          logger.debug(
            `Discarding recovered state for run ${recoveredState.sessionId}: ${isCompleted ? "report already generated" : "stale (>24h)"}`,
          )
          recoveredState = null
        }
      }

      if (recoveredState && auditState) {
        setAuditState(
          {
            ...recoveredState,
            sessionId: auditState.sessionId,
            projectDir: auditState.projectDir,
            startTime: auditState.startTime,
          },
          sessionId,
        )
      } else if (recoveredState) {
        setAuditState(recoveredState, sessionId)
      }

      const effectiveState = getAuditState(sessionId) ?? recoveredState
      if (effectiveState) {
        const raceSink = forceFreshRun ? null : sinkRegistry.getForSession(sessionId)
        if (raceSink) {
          setEventSink(raceSink, sessionId)
          sinkRegistry.setForRun(raceSink.runId, raceSink)
          if (auditState) {
            setAuditState({ ...auditState, sessionId: raceSink.runId }, sessionId)
          }
          runJournal.log({ type: "state.loaded", timestamp, success: true, findingsCount: 0 })
          sessionActivated = true
          return
        }

        const resolver = createAuditArtifactResolver(effectiveState.sessionId, projectDir)
        try {
          const sink = createEventSink(effectiveState.sessionId, projectDir)
          setEventSink(sink, sessionId)
          sinkRegistry.setForSession(sessionId, sink)
          sinkRegistry.setForRun(effectiveState.sessionId, sink)

          await sink.append({
            type: "session.created",
            run_id: effectiveState.sessionId,
            seq: 0,
            session_id: sessionId,
            source: "create-hooks",
            schema_version: SCHEMA_VERSION,
            timestamp,
            payload: {
              projectDir: effectiveState.projectDir,
              sessionId: effectiveState.sessionId,
              plugin_version: ARGUS_PLUGIN_BUILD,
              build_commit: ARGUS_BUILD_PROVENANCE.gitSha ?? null,
              build_dirty: ARGUS_BUILD_PROVENANCE.gitDirty ?? null,
              scope: effectiveState.scope,
            },
          })
        } catch (error) {
          logger.warn(
            `EventSink creation failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        recordRun({
          runId: effectiveState.sessionId,
          opencodeSessionId: sessionId,
          projectDir: effectiveState.projectDir,
          statePath: resolver.paths().stateFile,
          journalPath: resolver.paths().journalFile,
          startedAt: effectiveState.startTime,
          phase: effectiveState.currentPhase,
          findingsCount: effectiveState.findings.length,
          status: "active",
        }).catch((err) =>
          logger.warn(`Failed to record run: ${err instanceof Error ? err.message : String(err)}`),
        )

        pruneStaleRuns(effectiveState.projectDir).catch((err) =>
          logger.warn(
            `Failed to prune stale runs: ${err instanceof Error ? err.message : String(err)}`,
          ),
        )
      }

      sessionActivated = true
    } finally {
      if (sessionActivated) {
        activatedSessions.add(sessionId)
      }
      pendingActivations.delete(sessionId)
      pendingSinkCreations.delete(sessionId)
    }
  }
}
