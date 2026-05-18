import { describe, expect, it } from "bun:test"
import { ArgusConfigSchema } from "./config/schema"
import type { Hooks } from "./create-hooks"
import { createHooks } from "./create-hooks"
import { createTools } from "./create-tools"
import type { Managers } from "./managers/types"
import { createPluginInterface } from "./plugin-interface"

function makeManagers(): Managers {
  return {
    backgroundManager: {
      dispatch: () => "task-1",
      cancel: () => {},
      getResult: async () => null,
      onComplete: () => {},
      getActiveCount: () => 0,
    },
    auditStateManager: {
      bindSession: () => {},
      load: async () => null,
      save: async () => {},
      get: () => null,
      update: async () => {},
      reset: async () => {},
      archive: async () => {},
      dispose: async () => {},
    },
  }
}

describe("createPluginInterface", () => {
  it("returns object with all 6 required keys when all hooks enabled", () => {
    const config = ArgusConfigSchema.parse({})
    const tools = createTools(config)
    const hooks = createHooks({
      config,
      managers: makeManagers(),
      projectDir: "/tmp/test-project",
      isHookEnabled: () => true,
    })

    const result = createPluginInterface({ tools, hooks })

    expect(result.tool).toBeDefined()
    expect(result.config).toBeDefined()
    expect(result["experimental.chat.system.transform"]).toBeDefined()
    expect(result["experimental.session.compacting"]).toBeDefined()
    expect(result["tool.execute.after"]).toBeDefined()
    expect(result.event).toBeDefined()
  })

  it("tool map has 16 entries", () => {
    const config = ArgusConfigSchema.parse({})
    const tools = createTools(config)
    const hooks = createHooks({
      config,
      managers: makeManagers(),
      projectDir: "/tmp/test-project",
      isHookEnabled: () => true,
    })

    const result = createPluginInterface({ tools, hooks })
    expect(Object.keys(result.tool)).toHaveLength(16)
  })

  it("omits disabled hooks from interface", () => {
    const config = ArgusConfigSchema.parse({})
    const tools = createTools(config)
    const hooks = createHooks({
      config,
      managers: makeManagers(),
      projectDir: "/tmp/test-project",
      isHookEnabled: (name) => name !== "compaction" && name !== "event",
    })

    const result = createPluginInterface({ tools, hooks })

    expect(result.config).toBeDefined()
    expect(result["tool.execute.after"]).toBeDefined()
    expect(result["experimental.chat.system.transform"]).toBeDefined()
    expect(result["experimental.session.compacting"]).toBeUndefined()
    expect(result.event).toBeUndefined()
  })

  it("config hook is always present even with all feature hooks disabled", () => {
    const config = ArgusConfigSchema.parse({})
    const tools = createTools(config)
    const hooks = createHooks({
      config,
      managers: makeManagers(),
      projectDir: "/tmp/test-project",
      isHookEnabled: () => false,
    })

    const result = createPluginInterface({ tools, hooks })
    expect(result.config).toBeDefined()
  })

  it("includes chat.params in result when defined", () => {
    const config = ArgusConfigSchema.parse({})
    const tools = createTools(config)
    const chatParamsHook = async () => {}
    const hooks: Hooks = {
      config: createHooks({
        config,
        managers: makeManagers(),
        projectDir: "/tmp/test-project",
        isHookEnabled: () => true,
      }).config,
      "chat.params": chatParamsHook as unknown as Hooks["chat.params"],
      "chat.message": undefined,
      "experimental.chat.system.transform": undefined,
      "experimental.session.compacting": undefined,
      "tool.execute.after": undefined,
      event: undefined,
    }

    const result = createPluginInterface({ tools, hooks })
    expect(result["chat.params"]).toBe(chatParamsHook)
  })

  it("omits chat.params from result when undefined", () => {
    const config = ArgusConfigSchema.parse({})
    const tools = createTools(config)
    const hooks: Hooks = {
      config: createHooks({
        config,
        managers: makeManagers(),
        projectDir: "/tmp/test-project",
        isHookEnabled: () => true,
      }).config,
      "chat.params": undefined,
      "chat.message": undefined,
      "experimental.chat.system.transform": undefined,
      "experimental.session.compacting": undefined,
      "tool.execute.after": undefined,
      event: undefined,
    }

    const result = createPluginInterface({ tools, hooks })
    expect(result["chat.params"]).toBeUndefined()
    expect("chat.params" in result).toBe(false)
  })

  it("includes chat.message in result when defined", () => {
    const config = ArgusConfigSchema.parse({})
    const tools = createTools(config)
    const chatMessageHook = async () => {}
    const hooks: Hooks = {
      config: createHooks({
        config,
        managers: makeManagers(),
        projectDir: "/tmp/test-project",
        isHookEnabled: () => true,
      }).config,
      "chat.params": undefined,
      "chat.message": chatMessageHook as unknown as Hooks["chat.message"],
      "experimental.chat.system.transform": undefined,
      "experimental.session.compacting": undefined,
      "tool.execute.after": undefined,
      event: undefined,
    }

    const result = createPluginInterface({ tools, hooks })
    expect(result["chat.message"]).toBe(chatMessageHook)
  })

  it("omits chat.message from result when undefined", () => {
    const config = ArgusConfigSchema.parse({})
    const tools = createTools(config)
    const hooks: Hooks = {
      config: createHooks({
        config,
        managers: makeManagers(),
        projectDir: "/tmp/test-project",
        isHookEnabled: () => true,
      }).config,
      "chat.params": undefined,
      "chat.message": undefined,
      "experimental.chat.system.transform": undefined,
      "experimental.session.compacting": undefined,
      "tool.execute.after": undefined,
      event: undefined,
    }

    const result = createPluginInterface({ tools, hooks })
    expect(result["chat.message"]).toBeUndefined()
    expect("chat.message" in result).toBe(false)
  })

  it("passes tools through unchanged", () => {
    const config = ArgusConfigSchema.parse({})
    const tools = createTools(config)
    const hooks = createHooks({
      config,
      managers: makeManagers(),
      projectDir: "/tmp/test-project",
      isHookEnabled: () => true,
    })

    const result = createPluginInterface({ tools, hooks })
    expect(result.tool).toBe(tools)
  })
})
