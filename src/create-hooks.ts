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
import { createEventSink, type EventSink } from "./features/persistent-state/event-sink"
import { materializeFindings } from "./features/persistent-state/findings-materializer"
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

  let currentEventSink: EventSink | null = null
  let currentOpencodeSessionId = ""

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
        currentOpencodeSessionId = sessionId ?? ""
        const timestamp = Date.now()
        let recoveredState: AuditState | null = null

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

        if (recoveredState) {
          setState(recoveredState)
        }

        runJournal.log({
          type: "session.created",
          sessionId,
          timestamp: Date.now(),
        })

        const effectiveState = recoveredState ?? auditStateManager.get()
        if (effectiveState) {
          const resolver = createAuditArtifactResolver(effectiveState.sessionId, projectDir)
          try {
            const journalFile = resolver.paths().journalFile
            // createEventSink builds the same path internally; the resolver makes it explicit.
            currentEventSink = createEventSink(effectiveState.sessionId, projectDir)
            setEventSink(currentEventSink)
            logger.debug(`Event sink journal path: ${journalFile}`)
          } catch (error) {
            logger.error(
              `Failed to create event sink: ${error instanceof Error ? error.message : String(error)}`,
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

  auditStateGetter = getAuditState

  const initialState = auditStateManager.get()
  if (initialState) {
    setAuditState(initialState)
  }

  const auditEnforcer = createAuditEnforcer()

  const systemPromptHook = createSystemPromptHook({
    getAuditState,
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
    ? safeCreateHook(() => createCompactionHook(getAuditState, getReconContext), "compaction")
    : undefined

  const toolTrackingHook = isHookEnabled("tool-tracking")
    ? safeCreateHook(
        () =>
          createToolTrackingHook(
            getAuditState,
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
              getEventSink: () => currentEventSink,
              getSessionId: () => currentOpencodeSessionId,
              getAgentName: () => {
                if (!currentOpencodeSessionId) {
                  return undefined
                }

                const agent = agentTracker.getAgentForSession(currentOpencodeSessionId)
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
            },
          ),
        "tool-tracking",
      )
    : undefined

  const materializeCurrentFindings = async (
    trigger: "session.idle" | "tool.execute.after",
    failFast = false,
  ): Promise<void> => {
    const state = getAuditState()
    if (!state || state.sessionId.length === 0) {
      return
    }

    try {
      await materializeFindings(
        state.sessionId,
        state.projectDir,
        currentOpencodeSessionId.length > 0 ? currentOpencodeSessionId : undefined,
      )
    } catch (error) {
      if (failFast) {
        throw new Error(
          `Failed to materialize findings artifact on ${trigger} for run ${state.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      logger.warn(
        `Failed to materialize findings artifact on ${trigger} for run ${state.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
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
                  await materializeFindings(finalizationResult.runId, projectDir)
                } catch (error) {
                  logger.warn(
                    `Failed to materialize findings artifact for run ${finalizationResult.runId}: ${error instanceof Error ? error.message : String(error)}`,
                  )
                }
              }

              await auditStateManager.archive()

              const deletedSessionId = input.event.sessionId
              if (deletedSessionId) {
                agentTracker.clearSession(deletedSessionId)
              }

              runJournal.log({
                type: "session.deleted",
                timestamp: Date.now(),
                archived: true,
                finalizationPassed: finalizationResult?.invariantsPassed ?? null,
              })

              currentEventSink = null
              currentOpencodeSessionId = ""
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
          })

          if (input.tool === "argus_generate_report") {
            await materializeCurrentFindings("tool.execute.after", true)
          }

          const outputWithHint = recoveryHint ? `${output.output}${recoveryHint}` : output.output
          output.output = outputTruncator(outputWithHint)
        }
      : undefined,
    event: safeEventHook,
  }
}
