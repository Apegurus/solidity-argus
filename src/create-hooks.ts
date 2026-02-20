import type { Hooks as PluginHooks } from "@opencode-ai/plugin"
import type { ArgusConfig } from "./config/types"
import type { Managers } from "./managers/types"
import type { HookName } from "./hooks/types"
import { createConfigHandler } from "./hooks/config-handler"
import { createCompactionHook } from "./hooks/compaction-hook"
import { createToolTrackingHook } from "./hooks/tool-tracking-hook"
import { createEventHook } from "./hooks/event-hook"
import { createAgentTracker } from "./hooks/agent-tracker"
import { createSystemPromptHook } from "./hooks/system-prompt-hook"
import { safeCreateHook } from "./hooks/safe-create-hook"
import { createContextMonitor, createToolOutputTruncator } from "./features/context-monitor"
import { createAuditEnforcer } from "./features/audit-enforcer/audit-enforcer"
import { getTokenBudgetForAgent } from "./hooks/context-budget"
import { createSessionRecoveryHandler } from "./features/error-recovery"
import { createToolErrorRecoveryHandler } from "./features/error-recovery"
import { detectProject } from "./utils/project-detector"
import type { ProjectConfig } from "./utils/project-detector"
import { detectAuditArtifacts } from "./utils/audit-artifact-detector"
import type { ReconContext } from "./hooks/recon-context-builder"
import { buildReconContextBlock } from "./hooks/recon-context-builder"
import type { AuditState } from "./state/types"

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

  const contextMonitor = createContextMonitor()
  const sessionRecoveryHandler = createSessionRecoveryHandler(auditStateManager)
  let auditStateGetter: (() => AuditState | null) | undefined
  const toolErrorRecoveryHandler = createToolErrorRecoveryHandler(
    () => auditStateGetter?.() ?? null,
    (patch) => auditStateManager.update(patch),
  )
  const outputTruncator = createToolOutputTruncator()

  // Sub-handlers run sequentially. The state persistence handler MUST be first:
  // it loads persisted state on session.created, overriding the fresh default.
  const { hook: eventHook, getAuditState, setAuditState } = createEventHook(projectDir, [
    async ({ type, sessionId, auditState, setAuditState: setState }) => {
      if (type === "session.created") {
        const recoveredState = await auditStateManager.load()
        if (recoveredState) {
          setState(recoveredState)
        }
        return
      }

      if (type === "session.idle" && auditState) {
        await auditStateManager.save(auditState)
        return
      }

      if (type === "session.deleted") {
        if (sessionId) {
          agentTracker.clearSession(sessionId)
        }
        await auditStateManager.reset()
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
    getReconBlock: () => buildReconContextBlock({
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
      // Silent fallback — audit artifacts remain available
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
    ? safeCreateHook(() => createToolTrackingHook(getAuditState), "tool-tracking")
    : undefined

  const safeEventHook = isHookEnabled("event")
    ? safeCreateHook(() => eventHook, "event")
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

          const outputWithHint = recoveryHint
            ? `${output.output}${recoveryHint}`
            : output.output
          output.output = outputTruncator(outputWithHint)
        }
      : undefined,
    event: safeEventHook,
  }
}
