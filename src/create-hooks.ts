import type { Hooks as PluginHooks } from "@opencode-ai/plugin"
import type { ArgusConfig } from "./config/types"
import { createAuditEnforcer } from "./features/audit-enforcer/audit-enforcer"
import { createContextMonitor, createToolOutputTruncator } from "./features/context-monitor"
import { createToolErrorRecoveryHandler } from "./features/error-recovery"

import { createDebouncedSave } from "./features/persistent-state/audit-state-manager"
import {
  materializeFindingsForRun,
  materializeReportInput,
} from "./features/persistent-state/findings-materializer"
import { recordRun, updateRunStatus } from "./features/persistent-state/global-run-index"
import {
  finalizeRun,
  hasResolvedThemisDispositionAfterReport,
} from "./features/persistent-state/run-finalizer"
import { createRunJournal } from "./features/persistent-state/run-journal"
import { createAgentTracker } from "./hooks/agent-tracker"
import { createAuditSpecialistWatchdog } from "./hooks/audit-specialist-watchdog"
import { createBoundedSinkRegistry } from "./hooks/bounded-sink-registry"
import { createCompactionHook } from "./hooks/compaction-hook"
import { createConfigHandler } from "./hooks/config-handler"
import { getTokenBudgetForAgent } from "./hooks/context-budget"
import { createEventHook, extractParentSessionId, extractSessionId } from "./hooks/event-hook"
import type { ReconContext } from "./hooks/recon-context-builder"
import { buildReconContextBlock } from "./hooks/recon-context-builder"
import { createSessionActivator } from "./hooks/session-activation"
import { createSessionStateRegistry } from "./hooks/session-state-registry"
import { createSystemPromptHook } from "./hooks/system-prompt-hook"
import { createToolTrackingHook } from "./hooks/tool-tracking-hook"
import type { HookName } from "./hooks/types"
import type { AuditStateManager } from "./managers/types"
import { createAuditArtifactResolver } from "./shared/audit-artifact-resolver"
import { createLogger } from "./shared/logger"
import { getToolResultCache, type ToolResultCache } from "./shared/tool-result-cache"
import type { AuditState } from "./state/types"
import { detectAuditArtifacts } from "./utils/audit-artifact-detector"
import { detectProject, type ProjectConfig } from "./utils/project-detector"

const logger = createLogger()
const RUNTIME_TO_CONFIG_AGENT_NAMES = {
  argus: "argus",
  sentinel: "sentinel",
  pythia: "pythia",
  "audit-specialist": "auditSpecialist",
  scribe: "scribe",
  themis: "themis",
} as const

function isRuntimeConfigAgentName(
  agentName: string,
): agentName is keyof typeof RUNTIME_TO_CONFIG_AGENT_NAMES {
  return Object.hasOwn(RUNTIME_TO_CONFIG_AGENT_NAMES, agentName)
}

export function selectToolResultForParsing(
  rawOutput: string,
  sessionID: string | undefined,
  tool: string,
  cache: ToolResultCache,
): string {
  if (typeof sessionID !== "string") return rawOutput
  const trackingResult = cache.takeTrackingMatch(sessionID, tool, rawOutput)
  if (trackingResult !== undefined) return trackingResult
  // Same-tool parallel calls share the (sessionID, tool) key; prefix-match first, then FIFO for replacement truncation stubs.
  const capturedFull = cache.takeMatch(sessionID, tool, rawOutput)
  if (capturedFull !== undefined && capturedFull.length > rawOutput.length) {
    return capturedFull
  }

  if (/bytes truncated|output was truncated|tool call succeeded/i.test(rawOutput)) {
    const replacementFull = cache.takeNext(sessionID, tool)
    if (replacementFull !== undefined && replacementFull.length > rawOutput.length) {
      return replacementFull
    }
  }

  return rawOutput
}

export function trimDeletedSessionTombstones(
  deletedSessions: Set<string>,
  pendingActivations: ReadonlySet<string>,
  maxSessions: number,
): void {
  let excess = deletedSessions.size - maxSessions
  if (excess <= 0) return
  for (const sessionId of deletedSessions) {
    if (excess === 0) break
    if (pendingActivations.has(sessionId)) continue
    deletedSessions.delete(sessionId)
    excess -= 1
  }
}

export type AgentTrackerRef = {
  getAgentForSession(sessionID: string): string | undefined
  isArgusAgent(sessionID: string): boolean
}

type TextCompleteOutput = {
  text: string
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

function isSuccessfulReportToolOutput(result: string): boolean {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>
    return parsed.success === true
  } catch {
    return false
  }
}

export function getAgentForSession(sessionID: string): string | undefined {
  return _agentTrackerRef?.getAgentForSession(sessionID)
}

export function isArgusAgent(sessionID: string): boolean {
  return _agentTrackerRef?.isArgusAgent(sessionID) ?? false
}

export function applyAuditSpecialistWatchdogRecovery(
  output: TextCompleteOutput,
  recovered: string | undefined,
): void {
  if (recovered !== undefined) output.text = recovered
}

export type Hooks = Pick<
  PluginHooks,
  | "config"
  | "chat.params"
  | "chat.message"
  | "experimental.chat.system.transform"
  | "experimental.session.compacting"
  | "experimental.text.complete"
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
  auditStateManager: AuditStateManager
  projectDir: string
  isHookEnabled: (name: HookName) => boolean
  toolResultCache?: ToolResultCache
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
      config: createConfigHandler(args.config),
      "chat.params": undefined,
      "chat.message": undefined,
      "experimental.chat.system.transform": undefined,
      "experimental.session.compacting": undefined,
      "experimental.text.complete": undefined,
      "tool.execute.after": undefined,
      event: undefined,
      dispose: releaseInstanceLock,
    }
  }
  globals[INSTANCE_LOCK] = true

  const { config, auditStateManager, projectDir, isHookEnabled } = args
  const toolResultCache = args.toolResultCache ?? getToolResultCache()
  const agentTracker = createAgentTracker()
  _agentTrackerRef = agentTracker

  const contextMonitor = createContextMonitor()
  const debouncedSave = createDebouncedSave(auditStateManager.save)

  // Memory-leak guard: cap unbounded EventSink maps at 100 entries with 24-hour TTL.
  const MAX_SINKS = 100
  const MAX_SESSION_TRACKING = 500
  const SINK_TTL_MS = 24 * 60 * 60 * 1000

  const activatedSessions = new Set<string>()
  const pendingActivations = new Set<string>()
  const deletedSessions = new Set<string>()

  const sessionStateRegistry = createSessionStateRegistry({
    projectDir,
    maxSessions: MAX_SESSION_TRACKING,
  })

  function getSessionManager(sessionId: string) {
    return sessionStateRegistry.getManager(sessionId)
  }

  function getSessionDebouncedSave(sessionId: string) {
    return sessionStateRegistry.getDebouncedSave(sessionId)
  }

  /**
   * Prevent session-tracking Sets from growing unboundedly in long-running processes.
   *
   * activatedSessions uses FIFO eviction because it is a permanent dedup guard —
   * losing an entry could cause a redundant (but harmless) re-activation.
   *
   * pendingActivations is a transient guard removed after its async operation completes.
   */
  function trimOldestSessions(sessions: Set<string>): void {
    const excess = sessions.size - MAX_SESSION_TRACKING
    if (excess <= 0) return
    const iterator = sessions.values()
    for (let i = 0; i < excess; i++) {
      const next = iterator.next()
      if (!next.done) sessions.delete(next.value)
    }
  }

  function trimSessionSets(): void {
    trimOldestSessions(activatedSessions)
    trimDeletedSessionTombstones(deletedSessions, pendingActivations, MAX_SESSION_TRACKING)
  }

  const sinkRegistry = createBoundedSinkRegistry({
    maxSinks: MAX_SINKS,
    ttlMs: SINK_TTL_MS,
    onSet: trimSessionSets,
  })

  const exitHandler = () => {
    try {
      debouncedSave.dispose()
      sessionStateRegistry.disposeDebouncedSaves()
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
          const idleManager = sessionId
            ? sessionStateRegistry.getExistingManager(sessionId)
            : auditStateManager
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

        // Finalize on idle from the run event stream (report followed by a resolved Themis
        // disposition), independent of auditState.reportGenerated which is siloed per session.
        const idleRunSink =
          sinkRegistry.getForRun(auditState.sessionId) ??
          (sessionId ? (sinkRegistry.getForSession(sessionId) ?? null) : null)

        if (idleRunSink && !idleRunSink.isFinalized) {
          const idleEvents = await idleRunSink.readAll()
          if (hasResolvedThemisDispositionAfterReport(idleEvents)) {
            try {
              const idleFinalization = await finalizeRun(
                auditState.sessionId,
                auditState.projectDir,
                idleRunSink,
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

        const deletedManager = sessionId
          ? sessionStateRegistry.getExistingManager(sessionId)
          : auditStateManager
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

  const activateSession = createSessionActivator({
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
    isSessionDeleted: (sessionId: string) => deletedSessions.has(sessionId),
  })

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
    getReportingThresholds: () => ({
      confidenceThreshold: args.config.reporting.confidenceThreshold,
      severityThreshold: args.config.reporting.severityThreshold,
    }),
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
    ? createCompactionHook((sessionId?: string) => getAuditState(sessionId), getReconContext)
    : undefined

  const auditSpecialistWatchdog = isHookEnabled("audit-specialist-watchdog")
    ? createAuditSpecialistWatchdog({
        getAgentForSession: agentTracker.getAgentForSession,
      })
    : undefined

  const toolTrackingHook = isHookEnabled("tool-tracking")
    ? createToolTrackingHook(
        (sessionId?: string) => getAuditState(sessionId),
        ({ tool, findingsCount, sessionId }) => {
          if (sessionId && !activatedSessions.has(sessionId)) return

          const currentState = getAuditState(sessionId)
          if (currentState) {
            if (sessionId && sessionStateRegistry.hasManager(sessionId)) {
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
            return sinkRegistry.getForRun(state.sessionId) ?? null
          },
          getEventSinkForSession: (sessionId: string) =>
            sinkRegistry.getForSession(sessionId) ??
            (() => {
              const parentSessionId = agentTracker.getParentSession(sessionId)
              if (parentSessionId) {
                const parentSink = sinkRegistry.getForSession(parentSessionId)
                if (parentSink) {
                  sinkRegistry.setForSession(sessionId, parentSink)
                  return parentSink
                }
              }
              const state = getAuditState(sessionId)
              if (state && state.sessionId.length > 0) {
                const runSink = sinkRegistry.getForRun(state.sessionId)
                if (runSink) {
                  sinkRegistry.setForSession(sessionId, runSink)
                  return runSink
                }
              }
              return null
            })(),
          getEventSinkForRun: (runId: string) => sinkRegistry.getForRun(runId) ?? null,
          projectDir,
          getActiveRunSinks: () => sinkRegistry.getActiveRunSinks(),
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
              agent === "audit-specialist" ||
              agent === "scribe" ||
              agent === "themis" ||
              agent === "unknown"
            ) {
              return agent
            }

            return "unknown"
          },
          onChildSessionDetected: (parentSessionId: string, childSessionId: string) => {
            if (parentSessionId && childSessionId) {
              agentTracker.trackChildSession(parentSessionId, childSessionId)

              const parentSink = sinkRegistry.getForSession(parentSessionId)
              if (parentSink && toolTrackingHook) {
                sinkRegistry.setForSession(childSessionId, parentSink)
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
    ? async (input: Parameters<typeof eventHook>[0]) => {
        const isSessionDeleted = input.event.type === "session.deleted"
        const eventSessionId = extractSessionId(input.event)
        const parentSessionId = extractParentSessionId(input.event)
        const finalizationBeforeDelete = isSessionDeleted ? getLastFinalizationResult() : null

        if (eventSessionId && parentSessionId) {
          agentTracker.trackChildSession(parentSessionId, eventSessionId)
        }

        if (isSessionDeleted && eventSessionId) {
          deletedSessions.add(eventSessionId)
          trimSessionSets()
        }

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
            // WS-3 I8: only tear down shared/global audit state for a session that actually
            // activated. A never-activated session owns no state of its own; archiving would
            // fall back to the global manager and wipe a concurrent session's live audit.
            const shouldArchive =
              !isChildSession && deletedSessionId != null && activatedSessions.has(deletedSessionId)
            if (shouldArchive && deletedSessionId != null) {
              const deletedManager =
                sessionStateRegistry.getExistingManager(deletedSessionId) ?? auditStateManager
              await deletedManager.archive()
            }

            if (deletedSessionId) {
              agentTracker.clearSession(deletedSessionId)
              sinkRegistry.deleteSession(deletedSessionId)
              activatedSessions.delete(deletedSessionId)
              toolTrackingHook?.clearOrphanEvents(deletedSessionId)
              await sessionStateRegistry.deleteSession(deletedSessionId)
            }

            sinkRegistry.releaseUnreferencedRuns()

            runJournal.log({
              type: "session.deleted",
              timestamp: Date.now(),
              archived: shouldArchive,
              finalizationPassed: finalizationResult?.invariantsPassed ?? null,
            })
          }
        }
      }
    : undefined

  return {
    config: createConfigHandler(config),
    "chat.params": async (input, output) => {
      agentTracker.chatParamsHook(input)

      // Some model profiles reject sampling overrides; apply only explicit supported values.
      if (agentTracker.isArgusAgent(input.sessionID)) {
        const agentName = agentTracker.getAgentForSession(input.sessionID)
        const configAgentName =
          agentName && isRuntimeConfigAgentName(agentName)
            ? RUNTIME_TO_CONFIG_AGENT_NAMES[agentName]
            : undefined
        const agentConfig = configAgentName ? config.agents[configAgentName] : undefined
        if (
          input.model?.capabilities?.temperature !== false &&
          agentConfig?.temperature !== undefined
        ) {
          output.temperature = agentConfig.temperature
        }

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
    "experimental.text.complete": auditSpecialistWatchdog
      ? async (input, output) => {
          applyAuditSpecialistWatchdogRecovery(output, await auditSpecialistWatchdog(input, output))
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

          const rawOutput = typeof output.output === "string" ? output.output : ""
          const toolOutput = selectToolResultForParsing(
            rawOutput,
            input.sessionID,
            toolName,
            toolResultCache,
          )
          if (toolOutput !== rawOutput) {
            logger.info(
              `[tool-result] ${toolName}: recovered full result from cache (${toolOutput.length} chars) — output.output was ${rawOutput.length} chars (truncated upstream)`,
            )
          }

          const recoveryHint = toolErrorRecoveryHandler({
            tool: toolName,
            result: toolOutput,
          })

          let reportState: AuditState | null = null
          if (toolName === "argus_generate_report") {
            reportState = getAuditState(input.sessionID)
            if (!reportState || reportState.sessionId.length === 0) {
              throw new Error("argus_generate_report completed without active audit state")
            }
            if (!isSuccessfulReportToolOutput(toolOutput)) {
              throw new Error("argus_generate_report completed without success: true")
            }

            const reportedError = extractReportErrorFromToolOutput(toolOutput)
            if (reportedError) {
              throw new Error(`argus_generate_report failed: ${reportedError}`)
            }
            if (!extractReportFilePathFromToolOutput(toolOutput)) {
              throw new Error("argus_generate_report completed without report filePath")
            }

            const extractedRunId = extractRunIdFromReportToolOutput(toolOutput)
            if (!extractedRunId) {
              throw new Error("argus_generate_report completed without run_id")
            }
            if (extractedRunId !== reportState.sessionId) {
              throw new Error(
                `argus_generate_report run_id ${extractedRunId} does not match active run ${reportState.sessionId}`,
              )
            }
          }

          await toolTrackingHook({
            tool: toolName,
            args: input.args,
            result: toolOutput,
            sessionID: input.sessionID,
            callID: input.callID,
          })

          if (reportState) {
            await runMaterializeFindings(
              reportState.sessionId,
              reportState.projectDir,
              input.sessionID,
              "tool.execute.after",
              false,
            )

            try {
              await materializeReportInput(
                reportState.sessionId,
                reportState.projectDir,
                input.sessionID,
              )
            } catch (error) {
              logger.warn(
                `Failed to materialize report-input artifact for run ${reportState.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
              )
            }

            // The report is materialized here, but finalization waits until
            // Argus records a resolved Themis disposition.
          }

          if (toolName === "argus_themis_disposition") {
            const state = getAuditState(input.sessionID)
            if (state && state.sessionId.length > 0) {
              // Finalize from the run's event stream, not state.reportGenerated. The report
              // is generated in Scribe's session while the resolved disposition may be
              // recorded from another session, so the disposition session's reportGenerated
              // flag is unreliable. Prefer the sink that received this event, then the run sink.
              const runSink =
                (input.sessionID ? (sinkRegistry.getForSession(input.sessionID) ?? null) : null) ??
                sinkRegistry.getForRun(state.sessionId) ??
                null

              if (runSink && !runSink.isFinalized) {
                const events = await runSink.readAll()
                if (hasResolvedThemisDispositionAfterReport(events)) {
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
                        `Themis-disposition finalization for run ${state.sessionId} has invariant errors: ${reportFinalization.errors.join("; ")}`,
                      )
                    }
                  } catch (error) {
                    logger.warn(
                      `Themis-disposition finalization failed for run ${state.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
                    )
                  }
                }
              }
            }
          }

          if (toolName.startsWith("argus_")) {
            const outputWithHint = recoveryHint ? `${rawOutput}${recoveryHint}` : rawOutput
            output.output = outputTruncator(outputWithHint)
          }
        }
      : undefined,
    event: safeEventHook,
    dispose: fullDispose,
  }
}
