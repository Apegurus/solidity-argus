import { describe, expect, it } from "bun:test"
import { resolve } from "node:path"
import { createHooks } from "./create-hooks"
import { ArgusConfigSchema } from "./config/schema"
import type { Managers } from "./managers/types"
import type { HookName } from "./hooks/types"
import type { AuditState } from "./state/types"

const FIXTURE_DIR = resolve(import.meta.dir, "../tests/fixtures/vulnerable-vault")

function makeAuditState(overrides?: Partial<AuditState>): AuditState {
  return {
    sessionId: "test-session",
    projectDir: FIXTURE_DIR,
    contractsReviewed: [],
    findings: [],
    toolsExecuted: [],
    currentPhase: "reconnaissance",
    scope: [],
    startTime: Date.now(),
    ...overrides,
  }
}

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

describe("createHooks", () => {
  it("returns all current hooks when all feature hooks are enabled", () => {
     const config = ArgusConfigSchema.parse({})

     const hooks = createHooks({
       config,
       managers: makeManagers(),
       projectDir: process.cwd(),
       isHookEnabled: () => true,
     })

     expect(hooks.config).toBeDefined()
     expect(hooks.event).toBeDefined()
     expect(hooks["experimental.chat.system.transform"]).toBeDefined()
     expect(hooks["experimental.session.compacting"]).toBeDefined()
     expect(hooks["tool.execute.after"]).toBeDefined()
   })

  it("returns undefined for disabled feature hook slots", () => {
     const config = ArgusConfigSchema.parse({ disabled_hooks: ["compaction"] })

     const hooks = createHooks({
       config,
       managers: makeManagers(),
       projectDir: process.cwd(),
       isHookEnabled: (name: HookName) => name !== "compaction",
     })

      expect(hooks["experimental.chat.system.transform"]).toBeDefined()
     expect(hooks["experimental.session.compacting"]).toBeUndefined()
     expect(hooks["tool.execute.after"]).toBeDefined()
     expect(hooks.event).toBeDefined()
     expect(hooks.config).toBeDefined()
   })

  it("always keeps config hook enabled even when all feature hooks are disabled", () => {
    const config = ArgusConfigSchema.parse({ disabled_hooks: ["config"] })

    const hooks = createHooks({
      config,
      managers: makeManagers(),
      projectDir: process.cwd(),
      isHookEnabled: () => false,
    })

    expect(hooks.config).toBeDefined()
    expect(hooks["experimental.chat.system.transform"]).toBeDefined()
    expect(hooks["experimental.session.compacting"]).toBeUndefined()
    expect(hooks["tool.execute.after"]).toBeUndefined()
    expect(hooks.event).toBeUndefined()
  })

  it("includes chat.params hook", () => {
    const config = ArgusConfigSchema.parse({})

    const hooks = createHooks({
      config,
      managers: makeManagers(),
      projectDir: process.cwd(),
      isHookEnabled: () => true,
    })

    expect("chat.params" in hooks).toBe(true)
    expect(hooks["chat.params"]).toBeDefined()
  })

  it("includes chat.message hook", () => {
    const config = ArgusConfigSchema.parse({})

    const hooks = createHooks({
      config,
      managers: makeManagers(),
      projectDir: process.cwd(),
      isHookEnabled: () => true,
    })

    expect("chat.message" in hooks).toBe(true)
    expect(hooks["chat.message"]).toBeDefined()
  })

  it("checks isHookEnabled only for feature hooks", () => {
    const config = ArgusConfigSchema.parse({})
    const checkedHooks: HookName[] = []

    createHooks({
      config,
      managers: makeManagers(),
      projectDir: process.cwd(),
      isHookEnabled: (name: HookName) => {
        checkedHooks.push(name)
        return true
      },
    })

     expect(checkedHooks).toEqual([
       "compaction",
       "tool-tracking",
       "event",
     ])
  })

  it("persists current state on session.idle", async () => {
    const config = ArgusConfigSchema.parse({})
    const activeState = makeAuditState({ sessionId: "active" })
    const savedStates: AuditState[] = []

    const managers: Managers = {
      backgroundManager: {
        dispatch: () => "task-1",
        cancel: () => {},
        getResult: async () => null,
        onComplete: () => {},
        getActiveCount: () => 0,
      },
      auditStateManager: {
        load: async () => activeState,
        save: async (state) => {
          savedStates.push(state)
        },
        get: () => activeState,
        update: async () => {},
        reset: async () => {},
      },
    }

    const hooks = createHooks({
      config,
      managers,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    await hooks.event!(
      ({ event: { type: "session.idle", properties: {} } } as unknown) as Parameters<
        NonNullable<typeof hooks.event>
      >[0],
    )

    expect(savedStates).toHaveLength(1)
    expect(savedStates[0]?.sessionId).toBe("active")
  })
})
