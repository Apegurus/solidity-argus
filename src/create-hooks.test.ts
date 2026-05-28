import { beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { ArgusConfigSchema } from "./config/schema"
import { createHooks } from "./create-hooks"
import { createAuditStateManager } from "./features/persistent-state/audit-state-manager"
import { resolveRunIdFromOpencodeSession } from "./features/persistent-state/global-run-index"
import type { HookName } from "./hooks/types"
import type { Managers } from "./managers/types"
import { createAuditArtifactResolver } from "./shared/audit-artifact-resolver"
import { ARGUS_PLUGIN_VERSION } from "./shared/plugin-metadata"
import { SCHEMA_VERSION } from "./state/schemas"
import type { AuditState } from "./state/types"

const FIXTURE_DIR = resolve(import.meta.dir, "../tests/fixtures/vulnerable-vault")
const RUNS_DIR = join(FIXTURE_DIR, ".argus", "runs")

async function waitForRunId(sessionID: string): Promise<string> {
  const timeoutMs = 1_500
  const pollMs = 10
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const runId = resolveRunIdFromOpencodeSession(sessionID, FIXTURE_DIR)
    if (runId) return runId
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }

  throw new Error(`Expected run_id to be indexed for session ${sessionID}`)
}

async function activateArgusSession(
  hooks: ReturnType<typeof createHooks>,
  sessionID: string,
): Promise<void> {
  const input = { sessionID, agent: "argus" }
  const output = { temperature: 0, topP: 1, topK: 0, options: {} }
  await hooks["chat.params"]?.(
    input as Parameters<NonNullable<ReturnType<typeof createHooks>["chat.params"]>>[0],
    output as Parameters<NonNullable<ReturnType<typeof createHooks>["chat.params"]>>[1],
  )
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
      getTaskStatus: async () => undefined,
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
  beforeEach(() => {
    const lock = Symbol.for("solidity-argus:instance-lock")
    delete (globalThis as unknown as Record<symbol, unknown>)[lock]
  })

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
    expect((hooks as Record<string, unknown>)["experimental.text.complete"]).toBeDefined()
    expect(hooks["tool.execute.after"]).toBeDefined()
  })

  it("blocks repeated audit-specialist text after completion", async () => {
    const config = ArgusConfigSchema.parse({})
    const hooks = createHooks({
      config,
      managers: makeManagers(),
      projectDir: process.cwd(),
      isHookEnabled: () => true,
    })

    await hooks["chat.params"]?.(
      { sessionID: "specialist-session", agent: "audit-specialist" } as Parameters<
        NonNullable<ReturnType<typeof createHooks>["chat.params"]>
      >[0],
      { temperature: 0, topP: 1, topK: 0, options: {} } as Parameters<
        NonNullable<ReturnType<typeof createHooks>["chat.params"]>
      >[1],
    )

    const textComplete = (hooks as Record<string, unknown>)["experimental.text.complete"] as (
      input: { sessionID: string; messageID: string; partID: string },
      output: { text: string },
    ) => Promise<void>
    const paragraph = "Repeated stagnant analysis paragraph with no new evidence."

    let error: unknown
    try {
      await textComplete(
        { sessionID: "specialist-session", messageID: "msg-1", partID: "part-1" },
        { text: [paragraph, paragraph, paragraph].join("\n\n") },
      )
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("audit-specialist output repetition watchdog")
  })

  it("does not apply the text watchdog to non-specialist Argus agents", async () => {
    const config = ArgusConfigSchema.parse({})
    const hooks = createHooks({
      config,
      managers: makeManagers(),
      projectDir: process.cwd(),
      isHookEnabled: () => true,
    })

    await hooks["chat.params"]?.(
      { sessionID: "argus-session", agent: "argus" } as Parameters<
        NonNullable<ReturnType<typeof createHooks>["chat.params"]>
      >[0],
      { temperature: 0, topP: 1, topK: 0, options: {} } as Parameters<
        NonNullable<ReturnType<typeof createHooks>["chat.params"]>
      >[1],
    )

    const textComplete = (hooks as Record<string, unknown>)["experimental.text.complete"] as (
      input: { sessionID: string; messageID: string; partID: string },
      output: { text: string },
    ) => Promise<void>
    const paragraph = "Repeated stagnant analysis paragraph with no new evidence."

    await textComplete(
      { sessionID: "argus-session", messageID: "msg-1", partID: "part-1" },
      { text: [paragraph, paragraph, paragraph].join("\n\n") },
    )
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
    expect(hooks["experimental.chat.system.transform"]).toBeUndefined()
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
      "audit-specialist-watchdog",
      "tool-tracking",
      "event",
      "system-prompt",
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
        getTaskStatus: async () => undefined,
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

  it("isolates persistent state files across sessions", async () => {
    const config = ArgusConfigSchema.parse({})
    const projectDir = await mkdtemp(join(tmpdir(), "argus-hooks-state-"))
    const sessionOne = "oc-isolation-1"
    const sessionTwo = "oc-isolation-2"

    const managers = makeManagers()
    managers.auditStateManager = createAuditStateManager(projectDir)

    const hooks = createHooks({
      config,
      managers,
      projectDir,
      isHookEnabled: () => true,
    })

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: sessionOne } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, sessionOne)

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: sessionTwo } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, sessionTwo)

    await hooks.event?.({
      event: { type: "session.idle", properties: { info: { id: sessionOne } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await hooks.event?.({
      event: { type: "session.idle", properties: { info: { id: sessionTwo } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    const sessionsDir = join(projectDir, ".argus", "sessions")
    const stateFileOne = join(sessionsDir, `state-${sessionOne}.json`)
    const stateFileTwo = join(sessionsDir, `state-${sessionTwo}.json`)

    expect(await Bun.file(stateFileOne).exists()).toBe(true)
    expect(await Bun.file(stateFileTwo).exists()).toBe(true)
  })

  it("archives even when finalization invariants fail", async () => {
    const config = ArgusConfigSchema.parse({})
    const recoveredRunId = `run-fail-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })

    const managers: Managers = {
      backgroundManager: {
        dispatch: () => "task-1",
        cancel: () => {},
        getResult: async () => null,
        getTaskStatus: async () => undefined,
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

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-parent" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, "oc-parent")

    const freshRunId = await waitForRunId("oc-parent")

    await mkdir(join(RUNS_DIR, freshRunId), { recursive: true })

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
        getTaskStatus: async () => undefined,
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

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-materialize" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, "oc-materialize")

    const freshRunId = await waitForRunId("oc-materialize")

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
        getTaskStatus: async () => undefined,
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

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-live" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, "oc-live")

    const freshRunId = await waitForRunId("oc-live")

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

    await hooks["tool.execute.after"]?.(
      {
        tool: "argus_themis_disposition",
        args: {
          status: "approved",
          verdict_json:
            '{"approved":true,"pipeline_issues":[],"false_positives":[],"missed_findings":[],"severity_adjustments":[]}',
        },
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[0],
      {
        title: "argus_themis_disposition",
        output: JSON.stringify({
          success: true,
          themisDisposition: {
            status: "approved",
            verdict: {
              approved: true,
              pipeline_issues: [],
              false_positives: [],
              missed_findings: [],
              severity_adjustments: [],
            },
          },
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
        getTaskStatus: async () => undefined,
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

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-idle-finalize" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, "oc-idle-finalize")

    const freshRunId = await waitForRunId("oc-idle-finalize")

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

    await hooks["tool.execute.after"]?.(
      {
        tool: "argus_themis_disposition",
        args: {
          status: "approved",
          verdict_json:
            '{"approved":true,"pipeline_issues":[],"false_positives":[],"missed_findings":[],"severity_adjustments":[]}',
        },
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[0],
      {
        title: "argus_themis_disposition",
        output: JSON.stringify({
          success: true,
          themisDisposition: {
            status: "approved",
            verdict: {
              approved: true,
              pipeline_issues: [],
              false_positives: [],
              missed_findings: [],
              severity_adjustments: [],
            },
          },
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

  it("does not finalize on session.idle until Themis disposition is recorded", async () => {
    const config = ArgusConfigSchema.parse({})
    const recoveredRunId = `run-idle-waits-themis-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })

    const managers: Managers = {
      backgroundManager: {
        dispatch: () => "task-1",
        cancel: () => {},
        getResult: async () => null,
        getTaskStatus: async () => undefined,
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

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-idle-waits-themis" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, "oc-idle-waits-themis")

    const freshRunId = await waitForRunId("oc-idle-waits-themis")

    await hooks["tool.execute.after"]?.(
      {
        tool: "argus_generate_report",
        args: { target: FIXTURE_DIR },
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[0],
      {
        title: "argus_generate_report",
        output: JSON.stringify({
          run_id: freshRunId,
          filePath: ".argus/reports/idle-waits-themis.md",
          report: "ok",
        }),
        metadata: {},
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[1],
    )

    await hooks.event?.({
      event: { type: "session.idle", properties: { sessionID: "oc-idle-waits-themis" } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    const journalPath = createAuditArtifactResolver(freshRunId, FIXTURE_DIR).paths().journalFile
    let events = (await Bun.file(journalPath).text())
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string; payload?: Record<string, unknown> })

    expect(events.some((event) => event.type === "run.finalized")).toBe(false)

    await hooks["tool.execute.after"]?.(
      {
        tool: "argus_themis_disposition",
        args: {
          status: "approved",
          verdict_json:
            '{"approved":true,"pipeline_issues":[],"false_positives":[],"missed_findings":[],"severity_adjustments":[]}',
        },
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[0],
      {
        title: "argus_themis_disposition",
        output: JSON.stringify({
          success: true,
          themisDisposition: {
            status: "approved",
            verdict: {
              approved: true,
              pipeline_issues: [],
              false_positives: [],
              missed_findings: [],
              severity_adjustments: [],
            },
          },
        }),
        metadata: {},
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[1],
    )

    events = (await Bun.file(journalPath).text())
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
        getTaskStatus: async () => undefined,
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

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-parent-sink" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, "oc-parent-sink")

    const freshRunId = await waitForRunId("oc-parent-sink")

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
        getTaskStatus: async () => undefined,
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

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-persist-sink" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, "oc-persist-sink")

    const freshRunId = await waitForRunId("oc-persist-sink")

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

  it("warns but proceeds when tool output run_id mismatches state run_id", async () => {
    const config = ArgusConfigSchema.parse({})
    const recoveredRunId = `run-canonical-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })

    const managers: Managers = {
      backgroundManager: {
        dispatch: () => "task-1",
        cancel: () => {},
        getResult: async () => null,
        getTaskStatus: async () => undefined,
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

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-canonical" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, "oc-canonical")

    const freshRunId = await waitForRunId("oc-canonical")

    await hooks["tool.execute.after"]?.(
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
    )

    const findingsPath = createAuditArtifactResolver(freshRunId, FIXTURE_DIR).paths().findingsFile
    expect(await Bun.file(findingsPath).exists()).toBe(true)
  })

  it("returns success when report.md is written even if materialization has no events (Task 2 / Bug #2)", async () => {
    const config = ArgusConfigSchema.parse({})
    const initialRunId = `run-orphan-init-${Date.now()}`
    const activeState = makeAuditState({ sessionId: initialRunId, reportGenerated: false })

    const managers: Managers = {
      backgroundManager: {
        dispatch: () => "task-1",
        cancel: () => {},
        getResult: async () => null,
        getTaskStatus: async () => undefined,
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

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-orphan" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, "oc-orphan")

    const orphanRunId = `run-no-events-DOES-NOT-EXIST-${Date.now()}`
    activeState.sessionId = orphanRunId

    const toolExecuteAfter = hooks["tool.execute.after"]
    expect(toolExecuteAfter).toBeDefined()
    if (!toolExecuteAfter) return

    await toolExecuteAfter(
      {
        tool: "argus_generate_report",
        args: { target: FIXTURE_DIR },
        sessionID: "oc-orphan",
      } as unknown as Parameters<typeof toolExecuteAfter>[0],
      {
        title: "argus_generate_report",
        output: JSON.stringify({
          run_id: orphanRunId,
          filePath: ".argus/reports/orphan.md",
          report: "ok",
        }),
        metadata: {},
      } as unknown as Parameters<typeof toolExecuteAfter>[1],
    )
  })

  it("dispose removes process exit handler", () => {
    const config = ArgusConfigSchema.parse({})
    const listenersBefore = process.listenerCount("exit")

    const hooks = createHooks({
      config,
      managers: makeManagers(),
      projectDir: process.cwd(),
      isHookEnabled: () => true,
    })

    const listenersAfter = process.listenerCount("exit")
    expect(listenersAfter).toBe(listenersBefore + 1)

    hooks.dispose?.()
    const listenersAfterDispose = process.listenerCount("exit")
    expect(listenersAfterDispose).toBe(listenersBefore)
  })
})
