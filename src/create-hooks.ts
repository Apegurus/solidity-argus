import type { Hooks as PluginHooks } from "@opencode-ai/plugin"
import type { ArgusConfig } from "./config/types"
import type { Managers } from "./managers/types"
import type { HookName } from "./hooks/types"
import { createAuditState } from "./state/audit-state"
import { createConfigHandler } from "./hooks/config-handler"
import { createSystemPromptHook } from "./hooks/system-prompt-hook"
import { createCompactionHook } from "./hooks/compaction-hook"
import { createToolTrackingHook } from "./hooks/tool-tracking-hook"
import { createEventHookV2 } from "./hooks/event-hook-v2"
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
  projectDir: string
  isHookEnabled: (name: HookName) => boolean
}): Hooks {
  const { config, projectDir, isHookEnabled } = args

  const { state: auditState, store: findingStore } = createAuditState(projectDir)
  const { hook: eventHook, getAuditState, setAuditState } = createEventHookV2(projectDir)
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
          const block = await systemPromptHook({
            system: output.system.join("\n\n"),
            cwd: projectDir,
          })
          if (block) output.system.push(block)
        }
      : undefined,
    "experimental.session.compacting": compactionHook
      ? async (_input, output) => {
          const block = await compactionHook({ summary: output.context.join("\n") })
          if (block) output.context.push(block)
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
