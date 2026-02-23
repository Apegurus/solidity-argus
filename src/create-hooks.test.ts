import { describe, expect, it } from "bun:test"
import { join, resolve } from "node:path"
import { ArgusConfigSchema } from "./config/schema"
import { createHooks } from "./create-hooks"
import type { HookName } from "./hooks/types"
import type { Managers } from "./managers/types"
import { createAuditArtifactResolver } from "./shared/audit-artifact-resolver"
import { ARGUS_PLUGIN_VERSION } from "./shared/plugin-metadata"
import { SCHEMA_VERSION } from "./state/schemas"
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
      archive: async () => {},
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

    expect(checkedHooks).toEqual(["compaction", "tool-tracking", "event"])
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
        archive: async () => {},
      },
    }

    const hooks = createHooks({
      config,
      managers,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    await hooks.event?.({
      event: { type: "session.idle", properties: {} },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    expect(savedStates).toHaveLength(1)
    expect(savedStates[0]?.sessionId).toBe("active")
  })

  it("archives even when finalization invariants fail", async () => {
    const config = ArgusConfigSchema.parse({})
    const runId = `run-fail-${Date.now()}`
    const activeState = makeAuditState({ sessionId: runId })
    let archiveCount = 0

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
        save: async () => {},
        get: () => activeState,
        update: async () => {},
        reset: async () => {},
        archive: async () => {
          archiveCount += 1
        },
      },
    }

    const hooks = createHooks({
      config,
      managers,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    await hooks.event?.({
      event: { type: "session.created", sessionId: "oc-parent" },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    const eventsPath = join(FIXTURE_DIR, ".argus", "runs", runId, "events.jsonl")
    const existing = await Bun.file(eventsPath).text()
    const orphanToolStarted = {
      type: "tool.started",
      run_id: runId,
      seq: 2,
      session_id: "oc-parent",
      tool_call_id: "tool-orphan",
      source: "test",
      schema_version: SCHEMA_VERSION,
      timestamp: Date.now(),
      payload: {
        tool: "task",
        correlation_id: "corr-1",
        child_session_id: "child-1",
      },
    }
    await Bun.write(eventsPath, `${existing}${JSON.stringify(orphanToolStarted)}\n`)

    await hooks.event?.({
      event: { type: "session.deleted", sessionId: "oc-parent" },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    expect(archiveCount).toBe(1)

    const lines = (await Bun.file(eventsPath).text())
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string; payload?: Record<string, unknown> })
    const finalizationEvent = [...lines].reverse().find((event) => event.type === "run.finalized")

    expect(finalizationEvent).toBeDefined()
    expect(finalizationEvent?.payload?.status).toBe("failed-finalization")
    expect(finalizationEvent?.payload?.invariantsPassed).toBe(false)
    expect(finalizationEvent?.payload?.plugin_version).toBe(ARGUS_PLUGIN_VERSION)
  })

  it("materializes findings artifact after successful session finalization", async () => {
    const config = ArgusConfigSchema.parse({})
    const runId = `run-materialize-${Date.now()}`
    const activeState = makeAuditState({ sessionId: runId })

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
        save: async () => {},
        get: () => activeState,
        update: async () => {},
        reset: async () => {},
        archive: async () => {},
      },
    }

    const hooks = createHooks({
      config,
      managers,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    await hooks.event?.({
      event: { type: "session.created", sessionId: "oc-materialize" },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    await hooks.event?.({
      event: { type: "session.deleted", sessionId: "oc-materialize" },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    const findingsPath = createAuditArtifactResolver(runId, FIXTURE_DIR).paths().findingsFile
    expect(await Bun.file(findingsPath).exists()).toBe(true)
    const findingsArtifact = JSON.parse(await Bun.file(findingsPath).text()) as {
      run_id: string
      event_count: number
    }
    expect(findingsArtifact.run_id).toBe(runId)
    expect(findingsArtifact.event_count).toBe(3)
  })

  it("materializes findings artifact when report generation completes before session deletion", async () => {
    const config = ArgusConfigSchema.parse({})
    const runId = `run-live-${Date.now()}`
    const activeState = makeAuditState({ sessionId: runId })

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
        save: async () => {},
        get: () => activeState,
        update: async () => {},
        reset: async () => {},
        archive: async () => {},
      },
    }

    const hooks = createHooks({
      config,
      managers,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    await hooks.event?.({
      event: { type: "session.created", sessionId: "oc-live" },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    await hooks["tool.execute.after"]?.(
      {
        tool: "argus_generate_report",
        args: { target: FIXTURE_DIR },
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[0],
      {
        title: "argus_generate_report",
        output: JSON.stringify({
          success: true,
          report: "ok",
        }),
        metadata: {},
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[1],
    )

    const findingsPath = createAuditArtifactResolver(runId, FIXTURE_DIR).paths().findingsFile
    expect(await Bun.file(findingsPath).exists()).toBe(true)
    const findingsArtifact = JSON.parse(await Bun.file(findingsPath).text()) as {
      run_id: string
      event_count: number
    }
    expect(findingsArtifact.run_id).toBe(runId)
    expect(findingsArtifact.event_count).toBeGreaterThan(0)
  })
})
