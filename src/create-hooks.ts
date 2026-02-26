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
import { createEventSink, type EventSink, releaseEventSink } from "./features/persistent-state/event-sink"
import { materializeFindings, materializeReportInput } from "./features/persistent-state/findings-materializer"
import { recordRun } from "./features/persistent-state/global-run-index"
import { createRunJournal } from "./features/persistent-state/run-journal"
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
  const runJournal = createRunJournal(projectDir)
  let auditStateGetter: (() => AuditState | null) | undefined
  const toolErrorRecoveryHandler = createToolErrorRecoveryHandler(
    () => auditStateGetter?.() ?? null,
    (patch) => auditStateManager.update(patch),
  )
  const outputTruncator = createToolOutputTruncator()

  const eventSinksByOpencodeSession = new Map<string, EventSink>()

  // Sub-handlers run sequentially. The state persistence handler MUST be first:
  // it loads persisted state on session.created, overriding the fresh default.
  const {
    hook: eventHook,
    getAuditState,
    setAuditState,
    setEventSink,
    getEventSink,
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

        // If an EventSink already exists (from a prior session.created in this instance),
        // this is a sub-agent session. Reuse the existing sink and state — all
        // Argus-family agents share one run_id within a single audit.
        const existingSink = getEventSink()
        if (existingSink) {
          if (sessionId) {
            setEventSink(existingSink, sessionId)
            eventSinksByOpencodeSession.set(sessionId, existingSink)
          }
          // Inherit the primary session's audit state so sub-agents see findings/tools.
          const primaryState = getAuditState()
          if (primaryState) {
            setState(primaryState)
          }
          runJournal.log({
            type: "state.loaded",
            timestamp,
            success: true,
            findingsCount: primaryState?.findings.length ?? 0,
          })
          return
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
          const resolver = createAuditArtifactResolver(effectiveState.sessionId, projectDir)
          try {
            const sink = createEventSink(effectiveState.sessionId, projectDir)
            setEventSink(sink, sessionId)
            // Also set as fallback so tools without a sessionID can still find it.
            setEventSink(sink)
            if (sessionId) {
              eventSinksByOpencodeSession.set(sessionId, sink)
            }
          } catch (error) {
            logger.warn(`EventSink creation failed: ${error instanceof Error ? error.message : String(error)}`)
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
          })
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
          await materializeReportInput(
            auditState.sessionId,
            auditState.projectDir,
            sessionId,
          )
        } catch (error) {
          logger.warn(
            `Failed to materialize report-input artifact on session.idle for run ${auditState.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
          )
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
            () => getAuditState(),
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
              getEventSink: () => getEventSink(),
              getEventSinkForSession: (sessionId: string) =>
                eventSinksByOpencodeSession.get(sessionId) ?? getEventSink(sessionId),
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
                    input.event.sessionId,
                    "session.deleted",
                    true,
                  )
                } catch (error) {
                  logger.warn(
                    `Failed to materialize findings artifact for run ${finalizationResult.runId}: ${error instanceof Error ? error.message : String(error)}`,
                  )
                }
                try {
                  await materializeReportInput(
                    finalizationResult.runId,
                    projectDir,
                    input.event.sessionId,
                  )
                } catch (error) {
                  logger.warn(
                    `Failed to materialize report-input artifact for run ${finalizationResult.runId}: ${error instanceof Error ? error.message : String(error)}`,
                  )
                }
              }

              await auditStateManager.archive()

              const deletedSessionId = input.event.sessionId
              if (deletedSessionId) {
                agentTracker.clearSession(deletedSessionId)
                eventSinksByOpencodeSession.delete(deletedSessionId)
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

            const extractedRunId = extractRunIdFromReportToolOutput(output.output)
            if (extractedRunId && extractedRunId !== state.sessionId) {
              logger.warn(
                `argus_generate_report returned mismatched run_id ${extractedRunId}; canonical run is ${state.sessionId}`,
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
              await materializeReportInput(
                state.sessionId,
                state.projectDir,
                input.sessionID,
              )
            } catch (error) {
              logger.warn(
                `Failed to materialize report-input artifact for run ${state.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }

          const outputWithHint = recoveryHint ? `${output.output}${recoveryHint}` : output.output
          output.output = outputTruncator(outputWithHint)
        }
      : undefined,
    event: safeEventHook,
  }
}
