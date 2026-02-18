import type { Hooks as PluginHooks } from "@opencode-ai/plugin"
import type { ArgusConfig } from "./config/types"
import type { Managers } from "./managers/types"
import type { HookName } from "./hooks/types"
import { createConfigHandler } from "./hooks/config-handler"
import { createCompactionHook } from "./hooks/compaction-hook"
import { createToolTrackingHook } from "./hooks/tool-tracking-hook"
import { createEventHookV2 } from "./hooks/event-hook-v2"
import { safeCreateHook } from "./hooks/safe-create-hook"
import { createToolOutputTruncator } from "./features/context-monitor"
import { createSessionRecoveryHandler } from "./features/error-recovery"
import { createToolErrorRecoveryHandler } from "./features/error-recovery"

export type Hooks = Pick<
  PluginHooks,
  | "config"
  | "experimental.chat.system.transform"
  | "experimental.session.compacting"
  | "tool.execute.after"
  | "event"
>

export function createHooks(args: {
  config: ArgusConfig
  managers: Managers
  projectDir: string
  isHookEnabled: (name: HookName) => boolean
}): Hooks {
  const { config, managers, projectDir, isHookEnabled } = args
  const { auditStateManager, backgroundManager } = managers

   const sessionRecoveryHandler = createSessionRecoveryHandler(auditStateManager)
   const toolErrorRecoveryHandler = createToolErrorRecoveryHandler()
   const outputTruncator = createToolOutputTruncator()

  const { hook: eventHook, getAuditState, setAuditState } = createEventHookV2(projectDir, [
    async ({ type, auditState, setAuditState: setState }) => {
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

   const initialState = auditStateManager.get()
   if (initialState) {
     setAuditState(initialState)
   }

   const compactionHook = isHookEnabled("compaction")
    ? safeCreateHook(() => createCompactionHook(getAuditState), "compaction")
    : undefined

  const toolTrackingHook = isHookEnabled("tool-tracking")
    ? safeCreateHook(() => createToolTrackingHook(getAuditState), "tool-tracking")
    : undefined

  const safeEventHook = isHookEnabled("event")
    ? safeCreateHook(() => eventHook, "event")
    : undefined

   return {
     config: createConfigHandler(config, projectDir),
     "experimental.chat.system.transform": undefined,
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
