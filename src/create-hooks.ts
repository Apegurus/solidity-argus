import type { Hooks as PluginHooks } from "@opencode-ai/plugin"
import type { ArgusConfig } from "./config/types"
import { createAuditEnforcer } from "./features/audit-enforcer/audit-enforcer"
import { createContextMonitor, createToolOutputTruncator } from "./features/context-monitor"
import { createToolErrorRecoveryHandler } from "./features/error-recovery"

import {
  createAuditStateManager,
  createDebouncedSave,
} from "./features/persistent-state/audit-state-manager"
import {
  createEventSink,
  type EventSink,
  releaseEventSink,
} from "./features/persistent-state/event-sink"
import {
  materializeFindings,
  materializeFindingsForRun,
  materializeReportInput,
} from "./features/persistent-state/findings-materializer"
import { recordRun, updateRunStatus } from "./features/persistent-state/global-run-index"
import { finalizeRun } from "./features/persistent-state/run-finalizer"
import { createRunJournal } from "./features/persistent-state/run-journal"
import { pruneStaleRuns } from "./features/persistent-state/run-pruner"
import { createAgentTracker } from "./hooks/agent-tracker"
import { createCompactionHook } from "./hooks/compaction-hook"
import { createConfigHandler } from "./hooks/config-handler"
import { getTokenBudgetForAgent } from "./hooks/context-budget"
import { createEventHook, extractSessionId } from "./hooks/event-hook"
import type { ReconContext } from "./hooks/recon-context-builder"
import { buildReconContextBlock } from "./hooks/recon-context-builder"
import { safeCreateHook } from "./hooks/safe-create-hook"
import { createSystemPromptHook } from "./hooks/system-prompt-hook"
import { createToolTrackingHook } from "./hooks/tool-tracking-hook"
import type { HookName } from "./hooks/types"
import type { AuditStateManager, Managers } from "./managers/types"
import { createAuditArtifactResolver } from "./shared/audit-artifact-resolver"
import { createLogger } from "./shared/logger"
import { ARGUS_PLUGIN_VERSION } from "./shared/plugin-metadata"
import { SCHEMA_VERSION } from "./state/schemas"
import type { AuditState } from "./state/types"
import { detectAuditArtifacts } from "./utils/audit-artifact-detector"
import { detectProject, type ProjectConfig } from "./utils/project-detector"

const logger = createLogger()

export type AgentTrackerRef = {
  getAgentForSession(sessionID: string): string | undefined
  isArgusAgent(sessionID: string): boolean
}

let _agentTrackerRef: AgentTrackerRef | undefined

const REPORT_METADATA_REGEX = /<!-- argus:report_metadata (.+?) -->/

function extractRunIdFromReportToolOutput(result: string): string | undefined {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>
    if (typeof parsed.run_id === "string" && parsed.run_id.length > 0) {
      return parsed.run_id
    }

    if (typeof parsed.report === "string") {
      const match = parsed.report.match(REPORT_METADATA_REGEX)
      if (match?.[1]) {
        const metadata = JSON.parse(match[1]) as Record<string, unknown>
        if (typeof metadata.run_id === "string" && metadata.run_id.length > 0) {
          return metadata.run_id
        }
      }
    }
  } catch {
    return undefined
  }

  return undefined
}

function extractReportFilePathFromToolOutput(result: string): string | undefined {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>
    if (typeof parsed.filePath === "string" && parsed.filePath.length > 0) {
      return parsed.filePath
    }
  } catch {
    return undefined
  }

  return undefined
}

function extractReportErrorFromToolOutput(result: string): string | undefined {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>
    const error = parsed.error
    if (typeof error === "object" && error !== null && !Array.isArray(error)) {
      const message = (error as Record<string, unknown>).message
      if (typeof message === "string" && message.length > 0) {
        return message
      }
      return "argus_generate_report returned an unknown error"
    }
  } catch {
    return "argus_generate_report output was not valid JSON"
  }

  return undefined
}

export function getAgentForSession(sessionID: string): string | undefined {
  return _agentTrackerRef?.getAgentForSession(sessionID)
}

export function isArgusAgent(sessionID: string): boolean {
  return _agentTrackerRef?.isArgusAgent(sessionID) ?? false
}

export type Hooks = Pick<
  PluginHooks,
  | "config"
  | "chat.params"
  | "chat.message"
  | "experimental.chat.system.transform"
  | "experimental.session.compacting"
  | "tool.execute.after"
  | "event"
> & {
  /** Release the process-wide instance lock so the plugin can be re-initialized. */
  dispose?: () => void
}

/**
 * Creates the hook handlers for the Argus plugin.
 *
 * Context Delivery Strategy:
 * - Prompt: Static agent identity (src/agents/*-prompt.ts) — methodology, personality, tool instructions
 * - Hook: Dynamic state injection via experimental.chat.system.transform — audit progress, findings, phase
 * - Skill-load: On-demand knowledge via argus_skill_load tool — vulnerability patterns, protocol knowledge
 *
 * The system.transform hook injects dynamic audit context only for Argus-family agents
 * (argus, sentinel, pythia, scribe). Non-audit agents receive no injection.
 */
export function createHooks(args: {
  config: ArgusConfig
  managers: Managers
  projectDir: string
  isHookEnabled: (name: HookName) => boolean
}): Hooks {
  // Instance-level mutex: when OpenCode loads the plugin multiple times in the
  // same process (e.g. re-adding "solidity-argus" to global config), only the
  // first instance runs full initialization.  Subsequent calls get inert hooks
  // with only the config handler active (agent/MCP registration is idempotent).
  const INSTANCE_LOCK = Symbol.for("solidity-argus:instance-lock")
  const globals = globalThis as unknown as Record<symbol, boolean>
  const releaseInstanceLock = () => {
    delete globals[INSTANCE_LOCK]
  }

  if (globals[INSTANCE_LOCK]) {
    logger.debug("[plugin] Duplicate instance detected — returning inert hooks")
    return {
      config: createConfigHandler(args.config, args.projectDir),
      "chat.params": undefined,
      "chat.message": undefined,
      "experimental.chat.system.transform": undefined,
      "experimental.session.compacting": undefined,
      "tool.execute.after": undefined,
      event: undefined,
      dispose: releaseInstanceLock,
    }
  }
  globals[INSTANCE_LOCK] = true

  const { config, managers, projectDir, isHookEnabled } = args
  const { auditStateManager } = managers
  const agentTracker = createAgentTracker()
  _agentTrackerRef = agentTracker

  const contextMonitor = createContextMonitor()
  const debouncedSave = createDebouncedSave(auditStateManager.save)

  const exitHandler = () => {
    try {
      debouncedSave.dispose()
      for (const sessionDebouncedSave of debouncedSavesBySession.values()) {
        sessionDebouncedSave.dispose()
      }
    } catch {
      /* noop */
    }
  }
  process.on("exit", exitHandler)

  const fullDispose = () => {
    _agentTrackerRef = undefined
    process.removeListener("exit", exitHandler)
    releaseInstanceLock()
  }

  const runJournal = createRunJournal(projectDir)
  let auditStateGetter: (() => AuditState | null) | undefined
  const toolErrorRecoveryHandler = createToolErrorRecoveryHandler(
    () => auditStateGetter?.() ?? null,
    (patch) => auditStateManager.update(patch),
  )
  const outputTruncator = createToolOutputTruncator()

  // Memory-leak guard: cap unbounded EventSink maps at 100 entries with 24-hour TTL.
  const MAX_SINKS = 100
  const MAX_SESSION_TRACKING = 500
  const SINK_TTL_MS = 24 * 60 * 60 * 1000

  const eventSinksByOpencodeSession = new Map<string, EventSink>()
  const eventSinksByRunId = new Map<string, EventSink>()

  const sinkCreatedAtBySession = new Map<string, number>()
  const sinkCreatedAtByRunId = new Map<string, number>()

  const pendingSinkCreations = new Set<string>()
  const activatedSessions = new Set<string>()
  const sessionManagers = new Map<string, AuditStateManager>()
  const debouncedSavesBySession = new Map<string, ReturnType<typeof createDebouncedSave>>()

  const pendingActivations = new Set<string>()

  function getSessionManager(sessionId: string): AuditStateManager {
    let manager = sessionManagers.get(sessionId)
    if (!manager) {
      manager = createAuditStateManager(projectDir)
      manager.bindSession(sessionId)
      sessionManagers.set(sessionId, manager)

      if (sessionManagers.size > MAX_SESSION_TRACKING) {
        const oldest = sessionManagers.keys().next()
        if (!oldest.done) {
          const oldestSessionId = oldest.value
          if (oldestSessionId !== sessionId) {
            const oldestDebouncedSave = debouncedSavesBySession.get(oldestSessionId)
            oldestDebouncedSave?.dispose()
            debouncedSavesBySession.delete(oldestSessionId)
            sessionManagers.delete(oldestSessionId)
          }
        }
      }
    }

    return manager
  }

  function getSessionDebouncedSave(sessionId: string): ReturnType<typeof createDebouncedSave> {
    let sessionDebouncedSave = debouncedSavesBySession.get(sessionId)
    if (!sessionDebouncedSave) {
      sessionDebouncedSave = createDebouncedSave(getSessionManager(sessionId).save)
      debouncedSavesBySession.set(sessionId, sessionDebouncedSave)
    }
    return sessionDebouncedSave
  }

  /**
   * Prevent session-tracking Sets from growing unboundedly in long-running processes.
   *
   * activatedSessions uses FIFO eviction because it is a permanent dedup guard —
   * losing an entry could cause a redundant (but harmless) re-activation.
   *
   * pendingSinkCreations and pendingActivations are transient guards that are
   * removed after their async operation completes. If they overflow, .clear() is
   * safe — the worst case is a redundant activation attempt that the rest of the
   * pipeline handles idempotently.
   */
  function trimSessionSets(): void {
    if (activatedSessions.size > MAX_SESSION_TRACKING) {
      const excess = activatedSessions.size - MAX_SESSION_TRACKING
      const iterator = activatedSessions.values()
      for (let i = 0; i < excess; i++) {
        const next = iterator.next()
        if (!next.done) activatedSessions.delete(next.value)
      }
    }
    if (pendingSinkCreations.size > MAX_SESSION_TRACKING) {
      pendingSinkCreations.clear()
    }
    if (pendingActivations.size > MAX_SESSION_TRACKING) {
      pendingActivations.clear()
    }
  }

  async function activateSession(sessionId: string): Promise<void> {
    if (activatedSessions.has(sessionId)) return
    if (pendingActivations.has(sessionId)) return

    const auditState = getAuditState(sessionId)
    if (!auditState) return

    pendingActivations.add(sessionId)
    // Must be set BEFORE the try block — if two concurrent activateSession calls race,
    // the second must see this guard immediately to prevent duplicate sink creation.
    pendingSinkCreations.add(sessionId)
    let sessionActivated = false
    try {
      const timestamp = Date.now()
      const sessionManager = getSessionManager(sessionId)

      const existingSink = (() => {
        const directSink = eventSinksByOpencodeSession.get(sessionId)
        if (directSink) return directSink

        const parentSessionId = agentTracker.getParentSession(sessionId)
        if (parentSessionId) {
          const parentSink = eventSinksByOpencodeSession.get(parentSessionId)
          if (parentSink) return parentSink
        }

        const activeSinks = Array.from(eventSinksByRunId.values()).filter((s) => !s.isFinalized)
        if (activeSinks.length === 1) return activeSinks[0] ?? null
        if (activeSinks.length > 1) {
          // Multiple active sinks — pick the most recently created one.
          // This handles the case where a stale run's sink was never finalized.
          const sorted = [...sinkCreatedAtByRunId.entries()]
            .filter(([rid]) => {
              const s = eventSinksByRunId.get(rid)
              return s != null && !s.isFinalized
            })
            .sort((a, b) => b[1] - a[1])
          const newest = sorted[0]
          return newest ? (eventSinksByRunId.get(newest[0]) ?? null) : null
        }
        return null
      })()

      // Fallback: if no existing sink found via direct/parent/heuristic lookup,
      // try inheriting the parent's run ID via audit state → eventSinksByRunId.
      // This handles the timing race where the child's activateSession fires before
      // the parent's sink is registered in eventSinksByOpencodeSession.
      const coalescedSink =
        existingSink ??
        (() => {
          const parentSessionId = agentTracker.getParentSession(sessionId)
          if (!parentSessionId) return null
          const parentState = getAuditState(parentSessionId)
          if (!parentState || parentState.sessionId.length === 0) return null
          const parentSink = eventSinksByRunId.get(parentState.sessionId)
          return parentSink && !parentSink.isFinalized ? parentSink : null
        })()

      if (coalescedSink) {
        setEventSink(coalescedSink, sessionId)
        setBoundedSink(
          eventSinksByOpencodeSession,
          sinkCreatedAtBySession,
          sessionId,
          coalescedSink,
        )
        setBoundedSink(eventSinksByRunId, sinkCreatedAtByRunId, coalescedSink.runId, coalescedSink)

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
        const raceSink = eventSinksByOpencodeSession.get(sessionId)
        if (raceSink) {
          setEventSink(raceSink, sessionId)
          setBoundedSink(eventSinksByRunId, sinkCreatedAtByRunId, raceSink.runId, raceSink)
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
          setBoundedSink(eventSinksByOpencodeSession, sinkCreatedAtBySession, sessionId, sink)
          setBoundedSink(eventSinksByRunId, sinkCreatedAtByRunId, effectiveState.sessionId, sink)

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
              plugin_version: ARGUS_PLUGIN_VERSION,
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

  /** Evict the oldest entry from a bounded EventSink map and its companion timestamp map. */
  function evictOldestSink(
    sinkMap: Map<string, EventSink>,
    timestampMap: Map<string, number>,
  ): void {
    const oldestKey = sinkMap.keys().next().value
    if (oldestKey === undefined) return
    const sink = sinkMap.get(oldestKey)
    if (sink && !sink.isFinalized) {
      try {
        sink.markFinalized()
      } catch {
        /* noop — best-effort finalization */
      }
    }
    sinkMap.delete(oldestKey)
    timestampMap.delete(oldestKey)
  }

  /** Evict any entries older than SINK_TTL_MS from a bounded EventSink map. */
  function evictStaleSinks(
    sinkMap: Map<string, EventSink>,
    timestampMap: Map<string, number>,
  ): void {
    const now = Date.now()
    for (const [key, createdAt] of timestampMap) {
      if (now - createdAt > SINK_TTL_MS) {
        const sink = sinkMap.get(key)
        if (sink && !sink.isFinalized) {
          try {
            sink.markFinalized()
          } catch {
            /* noop */
          }
        }
        sinkMap.delete(key)
        timestampMap.delete(key)
      }
    }
  }

  /** Add a sink to a bounded map, evicting oldest entries if the limit is reached. */
  function setBoundedSink(
    sinkMap: Map<string, EventSink>,
    timestampMap: Map<string, number>,
    key: string,
    sink: EventSink,
  ): void {
    evictStaleSinks(sinkMap, timestampMap)
    if (sinkMap.size >= MAX_SINKS && !sinkMap.has(key)) {
      evictOldestSink(sinkMap, timestampMap)
    }
    sinkMap.set(key, sink)
    if (!timestampMap.has(key)) {
      timestampMap.set(key, Date.now())
    }
    trimSessionSets()
  }

  // Sub-handlers run sequentially. The state persistence handler MUST be first:
  // it loads persisted state on session.created, overriding the fresh default.
  const {
    hook: eventHook,
    getAuditState,
    setAuditState,
    setEventSink,
    getLastFinalizationResult,
  } = createEventHook(projectDir, [
    async ({ type, sessionId, auditState, setAuditState: _setState }) => {
      if (type === "session.created") {
        // Lazy activation: on session.created we don't yet know which agent
        // the user will select (chat.params fires later).  We only create
        // in-memory state here; all disk I/O (EventSink, state persistence,
        // run recording) is deferred to activateSession() which is triggered
        // by chat.params (Argus agent) or tool.execute.after (argus_* tool).
        return
      }

      if (type === "session.idle" && auditState) {
        if (sessionId && !activatedSessions.has(sessionId)) return

        if (sessionId) {
          await getSessionDebouncedSave(sessionId).flush()
        } else {
          await debouncedSave.flush()
        }

        let saveSuccess = true
        try {
          const idleManager = sessionId ? sessionManagers.get(sessionId) : auditStateManager
          if (idleManager) {
            await idleManager.save(auditState)
          }
        } catch {
          saveSuccess = false
        } finally {
          runJournal.log({
            type: "state.saved",
            timestamp: Date.now(),
            success: saveSuccess,
          })
        }

        runJournal.log({
          type: "session.idle",
          timestamp: Date.now(),
          findingsCount: auditState.findings.length,
          toolsExecutedCount: auditState.toolsExecuted.length,
        })

        const idleResolver = createAuditArtifactResolver(
          auditState.sessionId,
          auditState.projectDir,
        )
        recordRun({
          runId: auditState.sessionId,
          opencodeSessionId: sessionId,
          projectDir: auditState.projectDir,
          statePath: idleResolver.paths().stateFile,
          journalPath: idleResolver.paths().journalFile,
          startedAt: auditState.startTime,
          phase: auditState.currentPhase,
          findingsCount: auditState.findings.length,
        }).catch((err) =>
          logger.warn(
            `Failed to record run on idle: ${err instanceof Error ? err.message : String(err)}`,
          ),
        )

        try {
          await materializeReportInput(auditState.sessionId, auditState.projectDir, sessionId)
        } catch (error) {
          logger.warn(
            `Failed to materialize report-input artifact on session.idle for run ${auditState.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }

        if (auditState.reportGenerated) {
          const runSink =
            eventSinksByRunId.get(auditState.sessionId) ??
            (sessionId ? (eventSinksByOpencodeSession.get(sessionId) ?? null) : null)

          if (runSink && !runSink.isFinalized) {
            try {
              const idleFinalization = await finalizeRun(
                auditState.sessionId,
                auditState.projectDir,
                runSink,
              )
              updateRunStatus(
                auditState.sessionId,
                idleFinalization.invariantsPassed ? "finalized" : "failed",
              ).catch((err) =>
                logger.warn(
                  `Failed to update run status: ${err instanceof Error ? err.message : String(err)}`,
                ),
              )
              if (!idleFinalization.invariantsPassed) {
                logger.warn(
                  `Idle finalization for run ${auditState.sessionId} has invariant errors: ${idleFinalization.errors.join("; ")}`,
                )
              }
            } catch (error) {
              logger.warn(
                `Failed to finalize run ${auditState.sessionId} on session.idle: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }
        }

        return
      }

      if (type === "session.deleted") {
        if (sessionId && !activatedSessions.has(sessionId)) return

        if (sessionId) {
          await getSessionDebouncedSave(sessionId).flush()
        } else {
          await debouncedSave.flush()
        }

        const deletedManager = sessionId ? sessionManagers.get(sessionId) : auditStateManager
        if (deletedManager) {
          if (auditState) {
            await deletedManager.save(auditState)
          }
          try {
            await deletedManager.dispose()
          } catch (error) {
            logger.warn(
              `State manager dispose failed: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        runJournal.log({
          type: "state.saved",
          timestamp: Date.now(),
          success: true,
        })
      }
    },
    async ({ type, sessionId, setAuditState: setState }) => {
      if (type !== "session.error") {
        return
      }

      const recoveryManager = sessionId ? getSessionManager(sessionId) : auditStateManager
      try {
        const recoveredState = await recoveryManager.load()
        if (recoveredState) {
          setState(recoveredState)
        }
      } catch (error) {
        logger.warn(
          `Session recovery failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    },
    async () => {},
  ])

  auditStateGetter = () => getAuditState()

  const initialState = auditStateManager.get()
  if (initialState) {
    setAuditState(initialState)
  }

  const auditEnforcer = createAuditEnforcer()

  const systemPromptHook = createSystemPromptHook({
    getAuditState: (sessionId?: string) => getAuditState(sessionId),
    getAgentForSession: agentTracker.getAgentForSession,
    isArgusAgent: agentTracker.isArgusAgent,
    getContextPressure: (systemText: string, sessionId?: string) => {
      const status = contextMonitor.getContextStatus(systemText, getAuditState(sessionId))
      return status.usage
    },
    getTokenBudget: getTokenBudgetForAgent,
    getEnforcerReminder: auditEnforcer,
    getReconBlock: () =>
      buildReconContextBlock({
        projectConfig: reconProjectConfig,
        dependencyRisks: reconProjectConfig?.dependencyRisks ?? [],
        auditArtifacts: detectAuditArtifacts(projectDir),
      }),
  })

  let reconProjectConfig: ProjectConfig | null = null

  detectProject(projectDir)
    .then((config) => {
      reconProjectConfig = config
    })
    .catch(() => {
      logger.debug("Project detection failed, using fallback recon context")
    })

  const getReconContext = (): ReconContext => ({
    projectConfig: reconProjectConfig,
    dependencyRisks: reconProjectConfig?.dependencyRisks ?? [],
    auditArtifacts: detectAuditArtifacts(projectDir),
  })

  const compactionHook = isHookEnabled("compaction")
    ? safeCreateHook(
        () =>
          createCompactionHook((sessionId?: string) => getAuditState(sessionId), getReconContext),
        "compaction",
      )
    : undefined

  const toolTrackingHook = isHookEnabled("tool-tracking")
    ? safeCreateHook(
        () =>
          createToolTrackingHook(
            (sessionId?: string) => getAuditState(sessionId),
            ({ tool, findingsCount, sessionId }) => {
              if (sessionId && !activatedSessions.has(sessionId)) return

              const currentState = getAuditState(sessionId)
              if (currentState) {
                if (sessionId && sessionManagers.has(sessionId)) {
                  getSessionDebouncedSave(sessionId).save(currentState)
                } else {
                  debouncedSave.save(currentState)
                }
              }

              runJournal.log({
                type: "tool.executed",
                tool,
                timestamp: Date.now(),
                findingsCount,
              })
            },
            {
              getEventSink: () => {
                const state = getAuditState()
                if (!state || state.sessionId.length === 0) {
                  return null
                }
                return eventSinksByRunId.get(state.sessionId) ?? null
              },
              getEventSinkForSession: (sessionId: string) =>
                eventSinksByOpencodeSession.get(sessionId) ??
                (() => {
                  const parentSessionId = agentTracker.getParentSession(sessionId)
                  if (parentSessionId) {
                    const parentSink = eventSinksByOpencodeSession.get(parentSessionId)
                    if (parentSink) {
                      setBoundedSink(
                        eventSinksByOpencodeSession,
                        sinkCreatedAtBySession,
                        sessionId,
                        parentSink,
                      )
                      return parentSink
                    }
                  }
                  const state = getAuditState(sessionId)
                  if (state && state.sessionId.length > 0) {
                    const runSink = eventSinksByRunId.get(state.sessionId)
                    if (runSink) {
                      setBoundedSink(
                        eventSinksByOpencodeSession,
                        sinkCreatedAtBySession,
                        sessionId,
                        runSink,
                      )
                      return runSink
                    }
                  }
                  return null
                })(),
              getEventSinkForRun: (runId: string) => eventSinksByRunId.get(runId) ?? null,
              projectDir,
              getActiveRunSinks: () =>
                Array.from(eventSinksByRunId.values()).filter((s) => !s.isFinalized),
              getAgentNameForSession: (sessionId: string) => {
                const directAgent = agentTracker.getAgentForSession(sessionId)
                const parentSessionId = agentTracker.getParentSession(sessionId)
                const inheritedAgent =
                  !directAgent && parentSessionId
                    ? agentTracker.getAgentForSession(parentSessionId)
                    : undefined
                const agent = directAgent ?? inheritedAgent
                if (
                  agent === "argus" ||
                  agent === "sentinel" ||
                  agent === "pythia" ||
                  agent === "scribe" ||
                  agent === "unknown"
                ) {
                  return agent
                }

                return "unknown"
              },
              onChildSessionDetected: (parentSessionId: string, childSessionId: string) => {
                if (parentSessionId && childSessionId) {
                  agentTracker.trackChildSession(parentSessionId, childSessionId)

                  const parentSink = eventSinksByOpencodeSession.get(parentSessionId)
                  if (parentSink && toolTrackingHook) {
                    setBoundedSink(
                      eventSinksByOpencodeSession,
                      sinkCreatedAtBySession,
                      childSessionId,
                      parentSink,
                    )
                    void toolTrackingHook
                      .flushOrphanEvents(childSessionId, parentSink)
                      .catch((error: unknown) => {
                        logger.warn(
                          `Failed to flush orphan events for child session ${childSessionId}: ${error instanceof Error ? error.message : String(error)}`,
                        )
                      })
                  }
                }
              },
            },
          ),
        "tool-tracking",
        { critical: true },
      )
    : undefined

  const runMaterializeFindings = (
    runId: string,
    projectDirForRun: string,
    sessionIdForRun: string | undefined,
    trigger: "session.idle" | "session.deleted" | "tool.execute.after",
    failFast = false,
  ): Promise<void> =>
    materializeFindingsForRun(runId, projectDirForRun, sessionIdForRun, trigger, {
      failFast,
      warn: (msg) => logger.warn(msg),
    })

  const safeEventHook = isHookEnabled("event")
    ? safeCreateHook(
        () => async (input: Parameters<typeof eventHook>[0]) => {
          const isSessionDeleted = input.event.type === "session.deleted"
          const eventSessionId = extractSessionId(input.event)
          const finalizationBeforeDelete = isSessionDeleted ? getLastFinalizationResult() : null

          try {
            await eventHook(input)
          } finally {
            if (isSessionDeleted) {
              const finalizationResult = getLastFinalizationResult()
              const hasNewFinalization =
                finalizationResult !== null && finalizationResult !== finalizationBeforeDelete

              if (hasNewFinalization && finalizationResult.runId.length > 0) {
                try {
                  await runMaterializeFindings(
                    finalizationResult.runId,
                    projectDir,
                    eventSessionId,
                    "session.deleted",
                    true,
                  )
                } catch (error) {
                  logger.warn(
                    `Failed to materialize findings artifact for run ${finalizationResult.runId}: ${error instanceof Error ? error.message : String(error)}`,
                  )
                }
                try {
                  await materializeReportInput(finalizationResult.runId, projectDir, eventSessionId)
                } catch (error) {
                  logger.warn(
                    `Failed to materialize report-input artifact for run ${finalizationResult.runId}: ${error instanceof Error ? error.message : String(error)}`,
                  )
                }
              }

              // Only archive audit state when the root session is deleted.
              // Child sessions (sentinel/pythia/scribe) may end before the parent
              // audit completes — archiving here would wipe live state.
              const deletedSessionId = eventSessionId
              const isChildSession =
                deletedSessionId != null && agentTracker.getParentSession(deletedSessionId) != null
              if (!isChildSession) {
                const deletedManager =
                  deletedSessionId != null
                    ? (sessionManagers.get(deletedSessionId) ?? auditStateManager)
                    : auditStateManager
                await deletedManager.archive()
              }

              if (deletedSessionId) {
                agentTracker.clearSession(deletedSessionId)
                eventSinksByOpencodeSession.delete(deletedSessionId)
                pendingSinkCreations.delete(deletedSessionId)
                pendingActivations.delete(deletedSessionId)
                activatedSessions.delete(deletedSessionId)
                const deletedDebouncedSave = debouncedSavesBySession.get(deletedSessionId)
                deletedDebouncedSave?.dispose()
                debouncedSavesBySession.delete(deletedSessionId)
                sessionManagers.delete(deletedSessionId)

                if (sessionManagers.size > MAX_SESSION_TRACKING) {
                  const oldest = sessionManagers.keys().next()
                  if (!oldest.done) {
                    const oldestSessionId = oldest.value
                    const oldestDebouncedSave = debouncedSavesBySession.get(oldestSessionId)
                    oldestDebouncedSave?.dispose()
                    debouncedSavesBySession.delete(oldestSessionId)
                    sessionManagers.delete(oldestSessionId)
                  }
                }
              }

              const activeRunIds = new Set(
                Array.from(eventSinksByOpencodeSession.values()).map((sink) => sink.runId),
              )
              for (const trackedRunId of Array.from(eventSinksByRunId.keys())) {
                if (!activeRunIds.has(trackedRunId)) {
                  releaseEventSink(trackedRunId)
                  eventSinksByRunId.delete(trackedRunId)
                }
              }

              if (finalizationResult && finalizationResult.runId.length > 0) {
                releaseEventSink(finalizationResult.runId)
              }

              runJournal.log({
                type: "session.deleted",
                timestamp: Date.now(),
                archived: true,
                finalizationPassed: finalizationResult?.invariantsPassed ?? null,
              })
            }
          }
        },
        "event",
        { critical: true },
      )
    : undefined

  return {
    config: createConfigHandler(config, projectDir),
    "chat.params": async (input, output) => {
      agentTracker.chatParamsHook(input)

      // Enforce deterministic LLM output for Argus-family agents (temperature=0).
      // Per-agent overrides are supported via config.agents.<name>.temperature.
      // Non-Argus sessions are left untouched so other plugins are not affected.
      if (agentTracker.isArgusAgent(input.sessionID)) {
        const agentName = agentTracker.getAgentForSession(input.sessionID)
        const agentConfig = agentName
          ? config.agents?.[agentName as keyof typeof config.agents]
          : undefined
        output.temperature = agentConfig?.temperature ?? 0

        await activateSession(input.sessionID)
      }
    },
    "chat.message": async (input) => {
      agentTracker.chatMessageHook(input)
    },
    "experimental.chat.system.transform": isHookEnabled("system-prompt")
      ? async (input, output) => {
          await systemPromptHook(input, output)
        }
      : undefined,
    "experimental.session.compacting": compactionHook
      ? async (input, output) => {
          const block = await compactionHook({
            summary: output.context.join("\n"),
            sessionId: input.sessionID,
          })
          if (block) output.context.push(block)
        }
      : undefined,
    "tool.execute.after": toolTrackingHook
      ? async (input, output) => {
          const toolName = typeof input.tool === "string" ? input.tool : ""
          if (!toolName.startsWith("argus_") && toolName !== "task") {
            return
          }

          if (toolName.startsWith("argus_") && input.sessionID) {
            await activateSession(input.sessionID)
          }

          const toolOutput = typeof output.output === "string" ? output.output : ""

          const recoveryHint = toolErrorRecoveryHandler({
            tool: toolName,
            result: toolOutput,
          })

          await toolTrackingHook({
            tool: toolName,
            args: input.args,
            result: toolOutput,
            sessionID: input.sessionID,
            callID: input.callID,
          })

          if (toolName === "argus_generate_report") {
            const state = getAuditState(input.sessionID)
            if (!state || state.sessionId.length === 0) {
              throw new Error("argus_generate_report completed without active audit state")
            }

            const reportedError = extractReportErrorFromToolOutput(toolOutput)
            if (reportedError) {
              throw new Error(`argus_generate_report failed: ${reportedError}`)
            }

            const reportFilePath = extractReportFilePathFromToolOutput(toolOutput)
            if (!reportFilePath) {
              throw new Error("argus_generate_report completed without report filePath")
            }

            const extractedRunId = extractRunIdFromReportToolOutput(toolOutput)
            if (!extractedRunId) {
              throw new Error("argus_generate_report completed without run_id")
            }
            if (extractedRunId !== state.sessionId) {
              logger.warn(
                `argus_generate_report run_id ${extractedRunId} differs from state.sessionId ${state.sessionId} — proceeding with report`,
              )
            }

            await runMaterializeFindings(
              state.sessionId,
              state.projectDir,
              input.sessionID,
              "tool.execute.after",
              false,
            )

            try {
              await materializeReportInput(state.sessionId, state.projectDir, input.sessionID)
            } catch (error) {
              logger.warn(
                `Failed to materialize report-input artifact for run ${state.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
              )
            }

            // Trigger finalization immediately after report generation.
            // The session.idle handler also checks reportGenerated, but in
            // `opencode run` mode the process may exit before another idle
            // event fires.  Finalizing here guarantees the run is closed.
            if (state.reportGenerated) {
              const runSink =
                eventSinksByRunId.get(state.sessionId) ??
                (input.sessionID
                  ? (eventSinksByOpencodeSession.get(input.sessionID) ?? null)
                  : null)

              if (runSink) {
                try {
                  const reportFinalization = await finalizeRun(
                    state.sessionId,
                    state.projectDir,
                    runSink,
                  )
                  updateRunStatus(
                    state.sessionId,
                    reportFinalization.invariantsPassed ? "finalized" : "failed",
                  ).catch((err) =>
                    logger.warn(
                      `Failed to update run status: ${err instanceof Error ? err.message : String(err)}`,
                    ),
                  )
                  if (!reportFinalization.invariantsPassed) {
                    logger.warn(
                      `Report-triggered finalization for run ${state.sessionId} has invariant errors: ${reportFinalization.errors.join("; ")}`,
                    )
                  }
                } catch (error) {
                  logger.warn(
                    `Report-triggered finalization failed for run ${state.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
                  )
                }
              }
            }
          }

          if (toolName.startsWith("argus_")) {
            const outputWithHint = recoveryHint ? `${toolOutput}${recoveryHint}` : toolOutput
            output.output = outputTruncator(outputWithHint)
          }
        }
      : undefined,
    event: safeEventHook,
    dispose: fullDispose,
  }
}
