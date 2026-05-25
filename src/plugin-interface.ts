import type { Hooks as PluginHooks, ToolDefinition } from "@opencode-ai/plugin"
import type { Hooks } from "./create-hooks"

export type PluginReturn = {
  tool: Record<string, ToolDefinition>
} & Partial<Omit<PluginHooks, "tool">>

export function createPluginInterface(args: {
  tools: Record<string, ToolDefinition>
  hooks: Hooks
}): PluginReturn {
  const { tools, hooks } = args

  const result: PluginReturn = {
    tool: tools,
    config: hooks.config,
  }

  if (hooks["chat.params"]) {
    result["chat.params"] = hooks["chat.params"]
  }

  if (hooks["chat.message"]) {
    result["chat.message"] = hooks["chat.message"]
  }

  if (hooks["experimental.chat.system.transform"]) {
    result["experimental.chat.system.transform"] = hooks["experimental.chat.system.transform"]
  }

  if (hooks["experimental.session.compacting"]) {
    result["experimental.session.compacting"] = hooks["experimental.session.compacting"]
  }

  if (hooks["experimental.text.complete"]) {
    result["experimental.text.complete"] = hooks["experimental.text.complete"]
  }

  if (hooks["tool.execute.after"]) {
    result["tool.execute.after"] = hooks["tool.execute.after"]
  }

  if (hooks.event) {
    result.event = hooks.event
  }

  return result
}
