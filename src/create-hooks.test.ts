import { describe, expect, it } from "bun:test"
import { readdir } from "node:fs/promises"
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
const RUNS_DIR = join(FIXTURE_DIR, ".argus", "runs")

/**
 * After session.created, the event-hook creates a fresh state with a randomUUID
 * as sessionId. When recovered state is merged, the fresh sessionId is preserved
 * (multi-instance isolation). This helper discovers the fresh runId by scanning
 * for new run directories that appeared after the test started.
 */
async function discoverFreshRunId(knownRunsBefore: Set<string>): Promise<string> {
  const entries = await readdir(RUNS_DIR)
  const newEntries = entries.filter((e) => !knownRunsBefore.has(e))
  // Filter to UUID-shaped entries (the fresh state uses randomUUID)
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  const freshRuns = newEntries.filter((e) => uuidPattern.test(e))
  if (freshRuns.length !== 1) {
    throw new Error(
      `Expected exactly 1 new UUID run directory, found ${freshRuns.length}: ${freshRuns.join(", ")}`,
    )
  }
  const freshRun = freshRuns.at(0)
  if (!freshRun) {
    throw new Error("Expected one fresh run directory")
  }
  return freshRun
}

async function getExistingRuns(): Promise<Set<string>> {
  try {
    return new Set(await readdir(RUNS_DIR))
  } catch {
    return new Set()
  }
}

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
        bindSession: () => {},
        load: async () => activeState,
        save: async (state) => {
          savedStates.push(state)
        },
        get: () => activeState,
        update: async () => {},
        reset: async () => {},
        archive: async () => {},
        dispose: async () => {},
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
    const recoveredRunId = `run-fail-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })
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
        bindSession: () => {},
        load: async () => activeState,
        save: async () => {},
        get: () => activeState,
        update: async () => {},
        reset: async () => {},
        archive: async () => {
          archiveCount += 1
        },
        dispose: async () => {},
      },
    }

    const hooks = createHooks({
      config,
      managers,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    const runsBefore = await getExistingRuns()

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-parent" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    // The fresh state gets a new randomUUID sessionId (multi-instance isolation).
    // Recovered state's findings/tools are merged but the fresh sessionId is used.
    const freshRunId = await discoverFreshRunId(runsBefore)

    const eventsPath = join(FIXTURE_DIR, ".argus", "runs", freshRunId, "events.jsonl")
    const existing = await Bun.file(eventsPath).text()
    const orphanToolStarted = {
      type: "tool.started",
      run_id: freshRunId,
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
      event: { type: "session.deleted", properties: { info: { id: "oc-parent" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    expect(archiveCount).toBe(1)

    const lines = (await Bun.file(eventsPath).text())
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string; payload?: Record<string, unknown> })
    const finalizationEvent = [...lines].reverse().find((event) => event.type === "run.finalized")

    expect(finalizationEvent).toBeDefined()
    expect(finalizationEvent?.payload?.status).toBe("finalized")
    expect(finalizationEvent?.payload?.invariantsPassed).toBe(true)
    expect(Array.isArray(finalizationEvent?.payload?.warnings)).toBe(true)
    expect(
      (finalizationEvent?.payload?.warnings as string[]).some((w) =>
        w.includes("orphaned tool.started"),
      ),
    ).toBe(true)
    expect(finalizationEvent?.payload?.plugin_version).toBe(ARGUS_PLUGIN_VERSION)
  })

  it("materializes findings artifact after successful session finalization", async () => {
    const config = ArgusConfigSchema.parse({})
    const recoveredRunId = `run-materialize-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })

    const managers: Managers = {
      backgroundManager: {
        dispatch: () => "task-1",
        cancel: () => {},
        getResult: async () => null,
        onComplete: () => {},
        getActiveCount: () => 0,
      },
      auditStateManager: {
        bindSession: () => {},
        load: async () => activeState,
        save: async () => {},
        get: () => activeState,
        update: async () => {},
        reset: async () => {},
        archive: async () => {},
        dispose: async () => {},
      },
    }

    const hooks = createHooks({
      config,
      managers,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    const runsBefore = await getExistingRuns()

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-materialize" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    const freshRunId = await discoverFreshRunId(runsBefore)

    await hooks.event?.({
      event: { type: "session.deleted", properties: { info: { id: "oc-materialize" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    const findingsPath = createAuditArtifactResolver(freshRunId, FIXTURE_DIR).paths().findingsFile
    expect(await Bun.file(findingsPath).exists()).toBe(true)
    const findingsArtifact = JSON.parse(await Bun.file(findingsPath).text()) as {
      run_id: string
      event_count: number
    }
    expect(findingsArtifact.run_id).toBe(freshRunId)
    expect(findingsArtifact.event_count).toBe(3)
  })

  it("materializes findings artifact when report generation completes before session deletion", async () => {
    const config = ArgusConfigSchema.parse({})
    const recoveredRunId = `run-live-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })

    const managers: Managers = {
      backgroundManager: {
        dispatch: () => "task-1",
        cancel: () => {},
        getResult: async () => null,
        onComplete: () => {},
        getActiveCount: () => 0,
      },
      auditStateManager: {
        bindSession: () => {},
        load: async () => activeState,
        save: async () => {},
        get: () => activeState,
        update: async () => {},
        reset: async () => {},
        archive: async () => {},
        dispose: async () => {},
      },
    }

    const hooks = createHooks({
      config,
      managers,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    const runsBefore = await getExistingRuns()

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-live" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    const freshRunId = await discoverFreshRunId(runsBefore)

    await hooks["tool.execute.after"]?.(
      {
        tool: "argus_generate_report",
        args: { target: FIXTURE_DIR },
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[0],
      {
        title: "argus_generate_report",
        output: JSON.stringify({
          run_id: freshRunId,
          filePath: ".argus/reports/live.md",
          report: "ok",
        }),
        metadata: {},
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[1],
    )

    const findingsPath = createAuditArtifactResolver(freshRunId, FIXTURE_DIR).paths().findingsFile
    expect(await Bun.file(findingsPath).exists()).toBe(true)
    const findingsArtifact = JSON.parse(await Bun.file(findingsPath).text()) as {
      run_id: string
      event_count: number
    }
    expect(findingsArtifact.run_id).toBe(freshRunId)
    expect(findingsArtifact.event_count).toBeGreaterThan(0)

    const journalPath = createAuditArtifactResolver(freshRunId, FIXTURE_DIR).paths().journalFile
    const events = (await Bun.file(journalPath).text())
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string; payload?: Record<string, unknown> })
    const finalizationEvent = [...events].reverse().find((event) => event.type === "run.finalized")

    expect(finalizationEvent).toBeDefined()
    expect(finalizationEvent?.payload?.invariantsPassed).toBe(true)
  })

  it("finalizes run on session.idle after successful report generation", async () => {
    const config = ArgusConfigSchema.parse({})
    const recoveredRunId = `run-idle-finalize-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })

    const managers: Managers = {
      backgroundManager: {
        dispatch: () => "task-1",
        cancel: () => {},
        getResult: async () => null,
        onComplete: () => {},
        getActiveCount: () => 0,
      },
      auditStateManager: {
        bindSession: () => {},
        load: async () => activeState,
        save: async () => {},
        get: () => activeState,
        update: async () => {},
        reset: async () => {},
        archive: async () => {},
        dispose: async () => {},
      },
    }

    const hooks = createHooks({
      config,
      managers,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    const runsBefore = await getExistingRuns()

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-idle-finalize" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    const freshRunId = await discoverFreshRunId(runsBefore)

    await hooks["tool.execute.after"]?.(
      {
        tool: "argus_generate_report",
        args: { target: FIXTURE_DIR },
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[0],
      {
        title: "argus_generate_report",
        output: JSON.stringify({
          run_id: freshRunId,
          filePath: ".argus/reports/idle-finalize.md",
          report: "ok",
        }),
        metadata: {},
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[1],
    )

    await hooks.event?.({
      event: { type: "session.idle", properties: { sessionID: "oc-idle-finalize" } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    const journalPath = createAuditArtifactResolver(freshRunId, FIXTURE_DIR).paths().journalFile
    const events = (await Bun.file(journalPath).text())
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string; payload?: Record<string, unknown> })
    const finalizationEvent = [...events].reverse().find((event) => event.type === "run.finalized")

    expect(finalizationEvent).toBeDefined()
    expect(finalizationEvent?.payload?.status).toBe("finalized")
    expect(finalizationEvent?.payload?.invariantsPassed).toBe(true)
  })

  it("tool tracking emits events even when session was not directly registered", async () => {
    const config = ArgusConfigSchema.parse({})
    const recoveredRunId = `run-sink-fallback-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })

    const managers: Managers = {
      backgroundManager: {
        dispatch: () => "task-1",
        cancel: () => {},
        getResult: async () => null,
        onComplete: () => {},
        getActiveCount: () => 0,
      },
      auditStateManager: {
        bindSession: () => {},
        load: async () => activeState,
        save: async () => {},
        get: () => activeState,
        update: async () => {},
        reset: async () => {},
        archive: async () => {},
        dispose: async () => {},
      },
    }

    const hooks = createHooks({
      config,
      managers,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    const runsBefore = await getExistingRuns()

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-parent-sink" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    const freshRunId = await discoverFreshRunId(runsBefore)

    await hooks["tool.execute.after"]?.(
      {
        tool: "argus_forge_test",
        args: { target: FIXTURE_DIR },
        sessionID: "oc-child-sink",
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[0],
      {
        title: "argus_forge_test",
        output: JSON.stringify({
          success: true,
          summary: { passed: 1, failed: 0, skipped: 0, total: 1 },
          tests: [],
          executionTime: 1000,
        }),
        metadata: {},
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[1],
    )

    const eventsPath = join(FIXTURE_DIR, ".argus", "runs", freshRunId, "events.jsonl")
    const events = (await Bun.file(eventsPath).text())
      .split("\n")
      .filter((line) => line.length > 0)
      .map(
        (line) =>
          JSON.parse(line) as {
            type: string
            run_id?: string
            session_id?: string
            payload?: Record<string, unknown>
          },
      )

    const started = events.filter(
      (event) => event.type === "tool.started" && event.payload?.tool === "argus_forge_test",
    )
    const completed = events.filter(
      (event) => event.type === "tool.completed" && event.payload?.tool === "argus_forge_test",
    )

    expect(started).toHaveLength(1)
    expect(completed).toHaveLength(1)
    expect(started[0]?.run_id).toBe(freshRunId)
    expect(started[0]?.session_id).toBe("oc-child-sink")
    expect(completed[0]?.run_id).toBe(freshRunId)
    expect(completed[0]?.session_id).toBe("oc-child-sink")
  })

  it("tool tracking continues after session.idle without losing sink", async () => {
    const config = ArgusConfigSchema.parse({})
    const recoveredRunId = `run-persist-sink-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })

    const managers: Managers = {
      backgroundManager: {
        dispatch: () => "task-1",
        cancel: () => {},
        getResult: async () => null,
        onComplete: () => {},
        getActiveCount: () => 0,
      },
      auditStateManager: {
        bindSession: () => {},
        load: async () => activeState,
        save: async () => {},
        get: () => activeState,
        update: async () => {},
        reset: async () => {},
        archive: async () => {},
        dispose: async () => {},
      },
    }

    const hooks = createHooks({
      config,
      managers,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    const runsBefore = await getExistingRuns()

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-persist-sink" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    const freshRunId = await discoverFreshRunId(runsBefore)

    await hooks.event?.({
      event: { type: "session.idle", properties: { sessionID: "oc-persist-sink" } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    await hooks["tool.execute.after"]?.(
      {
        tool: "argus_slither_analyze",
        args: { target: FIXTURE_DIR },
        sessionID: "oc-child-after-idle",
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[0],
      {
        title: "argus_slither_analyze",
        output: JSON.stringify({
          success: true,
          findingsCount: 0,
          findings: [],
          executionTime: 1000,
          errors: [],
        }),
        metadata: {},
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[1],
    )

    const eventsPath = join(FIXTURE_DIR, ".argus", "runs", freshRunId, "events.jsonl")
    const events = (await Bun.file(eventsPath).text())
      .split("\n")
      .filter((line) => line.length > 0)
      .map(
        (line) =>
          JSON.parse(line) as {
            type: string
            run_id?: string
            session_id?: string
            payload?: Record<string, unknown>
          },
      )

    const started = events.filter(
      (event) => event.type === "tool.started" && event.payload?.tool === "argus_slither_analyze",
    )
    const completed = events.filter(
      (event) => event.type === "tool.completed" && event.payload?.tool === "argus_slither_analyze",
    )

    expect(started).toHaveLength(1)
    expect(completed).toHaveLength(1)
    expect(started[0]?.run_id).toBe(freshRunId)
    expect(started[0]?.session_id).toBe("oc-child-after-idle")
    expect(completed[0]?.run_id).toBe(freshRunId)
    expect(completed[0]?.session_id).toBe("oc-child-after-idle")
  })

  it("uses canonical state run_id for report materialization when tool output run_id mismatches", async () => {
    const config = ArgusConfigSchema.parse({})
    const recoveredRunId = `run-canonical-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })

    const managers: Managers = {
      backgroundManager: {
        dispatch: () => "task-1",
        cancel: () => {},
        getResult: async () => null,
        onComplete: () => {},
        getActiveCount: () => 0,
      },
      auditStateManager: {
        bindSession: () => {},
        load: async () => activeState,
        save: async () => {},
        get: () => activeState,
        update: async () => {},
        reset: async () => {},
        archive: async () => {},
        dispose: async () => {},
      },
    }

    const hooks = createHooks({
      config,
      managers,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    const runsBefore = await getExistingRuns()

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-canonical" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    const freshRunId = await discoverFreshRunId(runsBefore)

    await expect(
      hooks["tool.execute.after"]?.(
        {
          tool: "argus_generate_report",
          args: { target: FIXTURE_DIR },
        } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[0],
        {
          title: "argus_generate_report",
          output: JSON.stringify({
            run_id: "ses_should_not_be_used",
            filePath: ".argus/reports/mismatch.md",
            report: "ok",
          }),
          metadata: {},
        } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[1],
      ),
    ).rejects.toThrow("mismatched run_id")

    const findingsPath = createAuditArtifactResolver(freshRunId, FIXTURE_DIR).paths().findingsFile
    expect(await Bun.file(findingsPath).exists()).toBe(false)
  })
})
