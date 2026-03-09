import type { Hooks as PluginHooks } from "@opencode-ai/plugin"
import type { ArgusConfig } from "./config/types"
import { createAuditEnforcer } from "./features/audit-enforcer/audit-enforcer"
import { createContextMonitor, createToolOutputTruncator } from "./features/context-monitor"
import {
  createSessionRecoveryHandler,
  createToolErrorRecoveryHandler,
} from "./features/error-recovery"
import { getMigrationMode } from "./features/migration"
import { adaptLegacyFindings } from "./features/migration/migration-adapter"
import { computeParityMetrics, formatParityReport } from "./features/migration/parity-telemetry"
import { createDebouncedSave } from "./features/persistent-state/audit-state-manager"
import {
  createEventSink,
  type EventSink,
  releaseEventSink,
} from "./features/persistent-state/event-sink"
import {
  materializeFindings,
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
import { createEventHook } from "./hooks/event-hook"
import type { ReconContext } from "./hooks/recon-context-builder"
import { buildReconContextBlock } from "./hooks/recon-context-builder"
import { safeCreateHook } from "./hooks/safe-create-hook"
import { createSystemPromptHook } from "./hooks/system-prompt-hook"
import { createToolTrackingHook } from "./hooks/tool-tracking-hook"
import type { HookName } from "./hooks/types"
import type { Managers } from "./managers/types"
import { createAuditArtifactResolver } from "./shared/audit-artifact-resolver"
import { createLogger } from "./shared/logger"
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

function resolveOpencodeEventSessionId(event: {
  properties?: Record<string, unknown>
}): string | undefined {
  if (!event.properties || typeof event.properties !== "object") {
    return undefined
  }

  const info = event.properties.info
  if (typeof info === "object" && info !== null && !Array.isArray(info)) {
    const infoId = (info as Record<string, unknown>).id
    if (typeof infoId === "string" && infoId.length > 0) {
      return infoId
    }
  }

  const sessionId = event.properties.sessionID
  if (typeof sessionId === "string" && sessionId.length > 0) {
    return sessionId
  }

  return undefined
}

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
>

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
  const { config, managers, projectDir, isHookEnabled } = args
  const { auditStateManager, backgroundManager } = managers
  const agentTracker = createAgentTracker()
  _agentTrackerRef = agentTracker

  const migrationMode = getMigrationMode(config)
  logger.debug(`Migration mode: ${migrationMode}`)

  const contextMonitor = createContextMonitor()
  const sessionRecoveryHandler = createSessionRecoveryHandler(auditStateManager)
  const debouncedSave = createDebouncedSave(auditStateManager.save)

  process.on("exit", () => {
    try {
      debouncedSave.dispose()
    } catch {
      /* noop */
    }
  })

  const runJournal = createRunJournal(projectDir)
  let auditStateGetter: (() => AuditState | null) | undefined
  const toolErrorRecoveryHandler = createToolErrorRecoveryHandler(
    () => auditStateGetter?.() ?? null,
    (patch) => auditStateManager.update(patch),
  )
  const outputTruncator = createToolOutputTruncator()

  // Memory-leak guard: cap unbounded EventSink maps at 100 entries with 24-hour TTL.
  const MAX_SINKS = 100
  const SINK_TTL_MS = 24 * 60 * 60 * 1000

  const eventSinksByOpencodeSession = new Map<string, EventSink>()
  const eventSinksByRunId = new Map<string, EventSink>()

  const sinkCreatedAtBySession = new Map<string, number>()
  const sinkCreatedAtByRunId = new Map<string, number>()

  const pendingSinkCreations = new Set<string>()

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
    async ({ type, sessionId, auditState, setAuditState: setState }) => {
      if (type === "session.created") {
        const timestamp = Date.now()
        let recoveredState: AuditState | null = null

        // Bind state manager to this OpenCode session BEFORE loading.
        // bindSession is idempotent — only the first call (primary Argus session)
        // takes effect. Sub-agent sessions (Sentinel, Pythia) are no-ops.
        if (sessionId) {
          auditStateManager.bindSession(sessionId)
        }

        const existingSink = (() => {
          if (!sessionId) {
            return null
          }

          const directSink = eventSinksByOpencodeSession.get(sessionId)
          if (directSink) {
            return directSink
          }

          const parentSessionId = agentTracker.getParentSession(sessionId)
          if (parentSessionId) {
            const parentSink = eventSinksByOpencodeSession.get(parentSessionId)
            if (parentSink) {
              return parentSink
            }
          }

          // Single-run coalescence: if no direct or parent sink was found but
          // there is exactly one active (non-finalized) run sink, attach this
          // session to it.  This handles child sessions (sentinel, pythia, scribe)
          // that are created before trackChildSession establishes the parent link.
          const activeSinks = Array.from(eventSinksByRunId.values()).filter((s) => !s.isFinalized)
          const coalescedSink = activeSinks.length === 1 ? activeSinks[0] : undefined
          if (coalescedSink) {
            logger.debug(`Coalescing session ${sessionId} into active run ${coalescedSink.runId}`)
            return coalescedSink
          }

          return null
        })()
        if (existingSink) {
          if (sessionId) {
            setEventSink(existingSink, sessionId)
            setBoundedSink(
              eventSinksByOpencodeSession,
              sinkCreatedAtBySession,
              sessionId,
              existingSink,
            )
          }
          setBoundedSink(eventSinksByRunId, sinkCreatedAtByRunId, existingSink.runId, existingSink)

          const existingRunId = existingSink.runId
          const existingResolver = createAuditArtifactResolver(existingRunId, projectDir)
          void recordRun({
            runId: existingRunId,
            opencodeSessionId: sessionId,
            projectDir: auditState?.projectDir ?? projectDir,
            statePath: existingResolver.paths().stateFile,
            journalPath: existingResolver.paths().journalFile,
            startedAt: auditState?.startTime ?? timestamp,
            phase: auditState?.currentPhase ?? "reconnaissance",
            findingsCount: auditState?.findings.length ?? 0,
          })

          // Set this session's state sessionId to match the primary run_id.
          // The event-hook will emit session.created with stateForSession.sessionId,
          // which must match the sink's runId to avoid rejection.
          if (auditState) {
            setState({ ...auditState, sessionId: existingSink.runId })
          }
          runJournal.log({
            type: "state.loaded",
            timestamp,
            success: true,
            findingsCount: 0,
          })
          return
        }

        if (sessionId) {
          if (pendingSinkCreations.has(sessionId)) {
            runJournal.log({ type: "state.loaded", timestamp, success: false, findingsCount: 0 })
            return
          }
          pendingSinkCreations.add(sessionId)
        }

        try {
          recoveredState = await auditStateManager.load()
        } finally {
          runJournal.log({
            type: "state.loaded",
            timestamp,
            success: recoveredState !== null,
            findingsCount: recoveredState?.findings.length ?? 0,
          })
        }

        // Discard recovered state if it belongs to a completed or stale run.
        // This prevents findings/tools from a prior audit accumulating into
        // the new session's state (Fix #4: state accumulation across sessions).
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
          // Merge recovered audit data (findings, tools, phase) into this session's
          // fresh state. We preserve the fresh auditState.sessionId as the run identity
          // because each audit run needs its own EventSink journal (run directory).
          // The session-scoped state file prevents cross-instance contamination,
          // while the fresh sessionId ensures EventSink run_id consistency.
          setState({
            ...recoveredState,
            sessionId: auditState.sessionId,
            projectDir: auditState.projectDir,
            startTime: auditState.startTime,
          })
        } else if (recoveredState) {
          setState(recoveredState)
        }

        const effectiveState = auditState ?? recoveredState
        if (effectiveState) {
          if (sessionId) {
            const raceSink = eventSinksByOpencodeSession.get(sessionId)
            if (raceSink) {
              setEventSink(raceSink, sessionId)
              setBoundedSink(eventSinksByRunId, sinkCreatedAtByRunId, raceSink.runId, raceSink)
              if (auditState) {
                setState({ ...auditState, sessionId: raceSink.runId })
              }
              runJournal.log({ type: "state.loaded", timestamp, success: true, findingsCount: 0 })
              return
            }
          }

          const resolver = createAuditArtifactResolver(effectiveState.sessionId, projectDir)
          try {
            const sink = createEventSink(effectiveState.sessionId, projectDir)
            setEventSink(sink, sessionId)
            if (sessionId) {
              setBoundedSink(eventSinksByOpencodeSession, sinkCreatedAtBySession, sessionId, sink)
            }
            setBoundedSink(eventSinksByRunId, sinkCreatedAtByRunId, effectiveState.sessionId, sink)
          } catch (error) {
            logger.warn(
              `EventSink creation failed: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
          void recordRun({
            runId: effectiveState.sessionId,
            opencodeSessionId: sessionId,
            projectDir: effectiveState.projectDir,
            statePath: resolver.paths().stateFile,
            journalPath: resolver.paths().journalFile,
            startedAt: effectiveState.startTime,
            phase: effectiveState.currentPhase,
            findingsCount: effectiveState.findings.length,
            status: "active",
          })

          void pruneStaleRuns(effectiveState.projectDir)
        }

        return
      }

      if (type === "session.idle" && auditState) {
        await debouncedSave.flush()

        let saveSuccess = true
        try {
          await auditStateManager.save(auditState)
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
        void recordRun({
          runId: auditState.sessionId,
          opencodeSessionId: sessionId,
          projectDir: auditState.projectDir,
          statePath: idleResolver.paths().stateFile,
          journalPath: idleResolver.paths().journalFile,
          startedAt: auditState.startTime,
          phase: auditState.currentPhase,
          findingsCount: auditState.findings.length,
        })

        // Materialize report-input.json on idle so Scribe can read it
        // via argus_read_findings before generating the report.
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
              void updateRunStatus(
                auditState.sessionId,
                idleFinalization.invariantsPassed ? "finalized" : "failed",
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

        if (migrationMode !== "legacy") {
          try {
            const { legacyFindings, canonicalFindings } = adaptLegacyFindings(
              auditState,
              migrationMode,
              auditState.sessionId,
            )
            const parityMetrics = computeParityMetrics(legacyFindings, canonicalFindings)
            logger.debug(formatParityReport(parityMetrics))
          } catch (error) {
            logger.warn(
              `Migration parity check failed: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        return
      }

      if (type === "session.deleted") {
        await debouncedSave.flush()
        if (auditState) {
          await auditStateManager.save(auditState)
        }
        try {
          await auditStateManager.dispose()
        } catch (error) {
          logger.warn(
            `State manager dispose failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        runJournal.log({
          type: "state.saved",
          timestamp: Date.now(),
          success: true,
        })
      }
    },
    async ({ type, sessionId, setAuditState: setState }) => {
      await sessionRecoveryHandler({ type, sessionId, setAuditState: setState })
    },
    async ({ type }) => {
      if (type === "session.idle") {
        backgroundManager.getActiveCount()
      }
    },
  ])

  auditStateGetter = () => getAuditState()

  const initialState = auditStateManager.get()
  if (initialState) {
    setAuditState(initialState)
  }

  const auditEnforcer = createAuditEnforcer()

  const systemPromptHook = createSystemPromptHook({
    getAuditState: () => getAuditState(),
    getAgentForSession: agentTracker.getAgentForSession,
    isArgusAgent: agentTracker.isArgusAgent,
    getContextPressure: (systemText: string) => {
      const status = contextMonitor.getContextStatus(systemText, getAuditState())
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
        () => createCompactionHook(() => getAuditState(), getReconContext),
        "compaction",
      )
    : undefined

  const toolTrackingHook = isHookEnabled("tool-tracking")
    ? safeCreateHook(
        () =>
          createToolTrackingHook(
            (sessionId?: string) => getAuditState(sessionId),
            ({ tool, findingsCount }) => {
              const currentState = getAuditState()
              if (currentState) {
                debouncedSave.save(currentState)
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
                  const state = getAuditState()
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
                }
              },
            },
          ),
        "tool-tracking",
        { critical: true },
      )
    : undefined

  const materializeFindingsForRun = async (
    runId: string,
    projectDirForRun: string,
    sessionIdForRun: string | undefined,
    trigger: "session.idle" | "session.deleted" | "tool.execute.after",
    failFast = false,
  ): Promise<void> => {
    if (!runId || runId.length === 0) {
      return
    }

    try {
      await materializeFindings(runId, projectDirForRun, sessionIdForRun, {
        validateSessionId: false,
        requireEvents: true,
      })
    } catch (error) {
      if (failFast) {
        throw new Error(
          `Failed to materialize findings artifact on ${trigger} for run ${runId}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      logger.warn(
        `Failed to materialize findings artifact on ${trigger} for run ${runId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const safeEventHook = isHookEnabled("event")
    ? safeCreateHook(
        () => async (input: Parameters<typeof eventHook>[0]) => {
          const isSessionDeleted = input.event.type === "session.deleted"
          const eventSessionId = resolveOpencodeEventSessionId(input.event)
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
                  await materializeFindingsForRun(
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

              await auditStateManager.archive()

              const deletedSessionId = eventSessionId
              if (deletedSessionId) {
                agentTracker.clearSession(deletedSessionId)
                eventSinksByOpencodeSession.delete(deletedSessionId)
                pendingSinkCreations.delete(deletedSessionId)
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
    "chat.params": async (input) => {
      agentTracker.chatParamsHook(input)
    },
    "chat.message": async (input) => {
      agentTracker.chatMessageHook(input)
    },
    "experimental.chat.system.transform": async (input, output) => {
      await systemPromptHook(input, output)
    },
    "experimental.session.compacting": compactionHook
      ? async (_input, output) => {
          const block = await compactionHook({ summary: output.context.join("\n") })
          if (block) output.context.push(block)
        }
      : undefined,
    "tool.execute.after": toolTrackingHook
      ? async (input, output) => {
          // Only intercept argus tools and the task tool (for child session tracking).
          // Non-argus tools (read, grep, MCP calls, etc.) must pass through untouched.
          if (!input.tool.startsWith("argus_") && input.tool !== "task") {
            return
          }

          const recoveryHint = toolErrorRecoveryHandler({
            tool: input.tool,
            result: output.output,
          })

          await toolTrackingHook({
            tool: input.tool,
            args: input.args,
            result: output.output,
            sessionID: input.sessionID,
            callID: input.callID,
          })

          if (input.tool === "argus_generate_report") {
            const state = getAuditState()
            if (!state || state.sessionId.length === 0) {
              throw new Error("argus_generate_report completed without active audit state")
            }

            const reportedError = extractReportErrorFromToolOutput(output.output)
            if (reportedError) {
              throw new Error(`argus_generate_report failed: ${reportedError}`)
            }

            const reportFilePath = extractReportFilePathFromToolOutput(output.output)
            if (!reportFilePath) {
              throw new Error("argus_generate_report completed without report filePath")
            }

            const extractedRunId = extractRunIdFromReportToolOutput(output.output)
            if (!extractedRunId) {
              throw new Error("argus_generate_report completed without run_id")
            }
            if (extractedRunId !== state.sessionId) {
              logger.warn(
                `argus_generate_report run_id ${extractedRunId} differs from state.sessionId ${state.sessionId} — proceeding with report`,
              )
            }

            await materializeFindingsForRun(
              state.sessionId,
              state.projectDir,
              input.sessionID,
              "tool.execute.after",
              true,
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
                  void updateRunStatus(
                    state.sessionId,
                    reportFinalization.invariantsPassed ? "finalized" : "failed",
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

          const outputWithHint = recoveryHint ? `${output.output}${recoveryHint}` : output.output
          output.output = outputTruncator(outputWithHint)
        }
      : undefined,
    event: safeEventHook,
  }
}
