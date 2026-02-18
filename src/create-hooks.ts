import type { Hooks as PluginHooks } from "@opencode-ai/plugin"
import type { ArgusConfig } from "./config/types"
import type { Managers } from "./managers/types"
import type { HookName } from "./hooks/types"
import { createAuditState } from "./state/audit-state"
import { createConfigHandler } from "./hooks/config-handler"
import { createSystemPromptHook } from "./hooks/system-prompt-hook"
import { createCompactionHook } from "./hooks/compaction-hook"
import { createToolTrackingHook } from "./hooks/tool-tracking-hook"
import { createEventHook } from "./hooks/event-hook"
import { safeCreateHook } from "./hooks/safe-create-hook"

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
  isHookEnabled: (name: HookName) => boolean
}): Hooks {
  const { config, isHookEnabled } = args

  const projectDir = process.cwd()
  const { state: auditState, store: findingStore } = createAuditState(projectDir)
  const { hook: eventHook, getAuditState, setAuditState } = createEventHook(projectDir)
  setAuditState(auditState)

  const systemPromptHook = isHookEnabled("system-prompt")
    ? safeCreateHook(
        () => createSystemPromptHook(getAuditState),
        "system-prompt"
      )
    : undefined

  const compactionHook = isHookEnabled("compaction")
    ? safeCreateHook(() => createCompactionHook(getAuditState), "compaction")
    : undefined

  const toolTrackingHook = isHookEnabled("tool-tracking")
    ? safeCreateHook(
        () => createToolTrackingHook(auditState, findingStore),
        "tool-tracking"
      )
    : undefined

  const safeEventHook = isHookEnabled("event")
    ? safeCreateHook(() => eventHook, "event")
    : undefined

  return {
    config: createConfigHandler(config),
    "experimental.chat.system.transform": systemPromptHook
      ? async (_input, output) => {
          const currentSystem = output.system.join("\n\n")
          const transformedSystem = await systemPromptHook({
            system: currentSystem,
            cwd: projectDir,
          })
          output.system.push(transformedSystem)
        }
      : undefined,
    "experimental.session.compacting": compactionHook
      ? async (_input, output) => {
          const currentSummary = output.context.join("\n")
          const compactedSummary = await compactionHook({ summary: currentSummary })
          output.context.push(compactedSummary)
        }
      : undefined,
    "tool.execute.after": toolTrackingHook
      ? async (input, output) => {
          await toolTrackingHook({
            tool: input.tool,
            args: input.args,
            result: output.output,
          })
        }
      : undefined,
    event: safeEventHook,
  }
}
