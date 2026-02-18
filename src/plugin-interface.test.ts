import { describe, expect, it } from "bun:test"
import { createPluginInterface } from "./plugin-interface"
import { createTools } from "./create-tools"
import { createHooks } from "./create-hooks"
import { ArgusConfigSchema } from "./config/schema"
import type { Managers } from "./managers/types"
import type { Hooks } from "./create-hooks"

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
      load: async () => null,
      save: async () => {},
      get: () => null,
      update: async () => {},
      reset: async () => {},
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
     expect(result["experimental.chat.system.transform"]).toBeUndefined()
     expect(result["experimental.session.compacting"]).toBeDefined()
     expect(result["tool.execute.after"]).toBeDefined()
     expect(result.event).toBeDefined()
  })

  it("tool map has 8 entries", () => {
    const config = ArgusConfigSchema.parse({})
    const tools = createTools(config)
    const hooks = createHooks({
      config,
      managers: makeManagers(),
      projectDir: "/tmp/test-project",
      isHookEnabled: () => true,
    })

    const result = createPluginInterface({ tools, hooks })
    expect(Object.keys(result.tool)).toHaveLength(8)
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
    expect(result["experimental.chat.system.transform"]).toBeUndefined()
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
