import { beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { ArgusConfigSchema } from "./config/schema"
import {
  createHooks,
  selectToolResultForParsing,
  trimDeletedSessionTombstones,
} from "./create-hooks"
import { createAuditStateManager } from "./features/persistent-state/audit-state-manager"
import { resolveRunIdFromOpencodeSession } from "./features/persistent-state/global-run-index"
import type { HookName } from "./hooks/types"
import type { AuditStateManager } from "./managers/types"
import { createAuditArtifactResolver } from "./shared/audit-artifact-resolver"
import { ARGUS_PLUGIN_BUILD } from "./shared/plugin-metadata"
import { createToolResultCache } from "./shared/tool-result-cache"
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

function makeAuditStateManager(): AuditStateManager {
  return {
    bindSession: () => {},
    load: async () => null,
    save: async () => {},
    get: () => null,
    update: async () => {},
    reset: async () => {},
    archive: async () => {},
    dispose: async () => {},
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
      auditStateManager: makeAuditStateManager(),
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

  it("recovers repeated audit-specialist text after completion", async () => {
    const config = ArgusConfigSchema.parse({})
    const hooks = createHooks({
      config,
      auditStateManager: makeAuditStateManager(),
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

    const output = { text: [paragraph, paragraph, paragraph].join("\n\n") }

    await textComplete(
      { sessionID: "specialist-session", messageID: "msg-1", partID: "part-1" },
      output,
    )

    expect(output.text.match(/Repeated stagnant analysis/g)?.length).toBe(1)
    expect(output.text).toContain("HANDOFF_JSON")
  })

  it("applies the audit-specialist configuration override", async () => {
    const hooks = createHooks({
      config: ArgusConfigSchema.parse({
        agents: { auditSpecialist: { temperature: 1.25 } },
      }),
      auditStateManager: makeAuditStateManager(),
      projectDir: process.cwd(),
      isHookEnabled: () => true,
    })
    const output = { temperature: 0, topP: 1, topK: 0, options: {} }

    await hooks["chat.params"]?.(
      { sessionID: "specialist-temperature", agent: "audit-specialist" } as Parameters<
        NonNullable<ReturnType<typeof createHooks>["chat.params"]>
      >[0],
      output as Parameters<NonNullable<ReturnType<typeof createHooks>["chat.params"]>>[1],
    )

    expect(output.temperature).toBe(1.25)
  })

  it("attributes audit-specialist tool findings to the specialist", async () => {
    const parentSessionId = `specialist-parent-${Date.now()}`
    const sessionId = `specialist-provenance-${Date.now()}`
    const hooks = createHooks({
      config: ArgusConfigSchema.parse({}),
      auditStateManager: makeAuditStateManager(),
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: parentSessionId } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, parentSessionId)
    const runId = await waitForRunId(parentSessionId)
    await hooks["tool.execute.after"]?.(
      {
        tool: "task",
        sessionID: parentSessionId,
        args: {},
      } as Parameters<NonNullable<ReturnType<typeof createHooks>["tool.execute.after"]>>[0],
      {
        title: "task",
        output: JSON.stringify({ session_id: sessionId }),
        metadata: {},
      } as Parameters<NonNullable<ReturnType<typeof createHooks>["tool.execute.after"]>>[1],
    )
    await hooks["chat.params"]?.(
      { sessionID: sessionId, agent: "audit-specialist" } as Parameters<
        NonNullable<ReturnType<typeof createHooks>["chat.params"]>
      >[0],
      { temperature: 0, topP: 1, topK: 0, options: {} } as Parameters<
        NonNullable<ReturnType<typeof createHooks>["chat.params"]>
      >[1],
    )

    await hooks["tool.execute.after"]?.(
      {
        tool: "argus_check_patterns",
        sessionID: sessionId,
        args: {},
      } as Parameters<NonNullable<ReturnType<typeof createHooks>["tool.execute.after"]>>[0],
      {
        title: "argus_check_patterns",
        output: JSON.stringify({
          success: true,
          patternVersion: "1.0.0",
          sources: [
            {
              source: "pattern-db",
              matches: [
                {
                  pattern: "reentrancy",
                  description: "External call before state update",
                  file: "src/VulnerableVault.sol",
                  lines: [10, 20],
                  severity: "High",
                },
              ],
            },
          ],
        }),
        metadata: {},
      } as Parameters<NonNullable<ReturnType<typeof createHooks>["tool.execute.after"]>>[1],
    )

    const journalPath = createAuditArtifactResolver(runId, FIXTURE_DIR).paths().journalFile
    const findingEvent = (await Bun.file(journalPath).text())
      .split("\n")
      .filter((line) => line.length > 0)
      .map(
        (line) =>
          JSON.parse(line) as {
            type: string
            payload?: { reported_by_agent?: string }
          },
      )
      .find((event) => event.type === "finding.added")

    expect(findingEvent?.payload?.reported_by_agent).toBe("audit-specialist")
  })

  it("does not apply the text watchdog to non-specialist Argus agents", async () => {
    const config = ArgusConfigSchema.parse({})
    const hooks = createHooks({
      config,
      auditStateManager: makeAuditStateManager(),
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
      auditStateManager: makeAuditStateManager(),
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
      auditStateManager: makeAuditStateManager(),
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
      auditStateManager: makeAuditStateManager(),
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
      auditStateManager: makeAuditStateManager(),
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
      auditStateManager: makeAuditStateManager(),
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

    const auditStateManager = {
      bindSession: () => {},
      load: async () => activeState,
      save: async (state: AuditState) => {
        savedStates.push(state)
      },
      get: () => activeState,
      update: async () => {},
      reset: async () => {},
      archive: async () => {},
      dispose: async () => {},
    }

    const hooks = createHooks({
      config,
      auditStateManager,
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

    const auditStateManager = createAuditStateManager(projectDir)

    const hooks = createHooks({
      config,
      auditStateManager,
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

    const auditStateManager = {
      bindSession: () => {},
      load: async () => activeState,
      save: async () => {},
      get: () => activeState,
      update: async () => {},
      reset: async () => {},
      archive: async () => {},
      dispose: async () => {},
    }

    const hooks = createHooks({
      config,
      auditStateManager,
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
    expect(finalizationEvent?.payload?.plugin_version).toBe(ARGUS_PLUGIN_BUILD)
  })

  it("does not archive shared audit state when a never-activated session is deleted (WS-3 I8)", async () => {
    const config = ArgusConfigSchema.parse({})
    let archiveCalls = 0
    const auditStateManager = makeAuditStateManager()
    auditStateManager.archive = async () => {
      archiveCalls++
    }

    const hooks = createHooks({
      config,
      auditStateManager,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-never-activated" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await hooks.event?.({
      event: { type: "session.deleted", properties: { info: { id: "oc-never-activated" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    expect(archiveCalls).toBe(0)
  })

  it("materializes findings artifact after successful session finalization", async () => {
    const config = ArgusConfigSchema.parse({})
    const recoveredRunId = `run-materialize-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })

    const auditStateManager = {
      bindSession: () => {},
      load: async () => activeState,
      save: async () => {},
      get: () => activeState,
      update: async () => {},
      reset: async () => {},
      archive: async () => {},
      dispose: async () => {},
    }

    const hooks = createHooks({
      config,
      auditStateManager,
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

  it("captures findings from a large cached pattern result when output.output is replaced by a truncation stub", async () => {
    const config = ArgusConfigSchema.parse({})
    const activeState = makeAuditState({ sessionId: `run-trunc-${Date.now()}` })
    const toolResultCache = createToolResultCache()

    const auditStateManager = {
      bindSession: () => {},
      load: async () => activeState,
      save: async () => {},
      get: () => activeState,
      update: async () => {},
      reset: async () => {},
      archive: async () => {},
      dispose: async () => {},
    }

    const hooks = createHooks({
      config,
      auditStateManager,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
      toolResultCache,
    })

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-trunc" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, "oc-trunc")
    const freshRunId = await waitForRunId("oc-trunc")

    const fullResult = JSON.stringify({
      success: true,
      patternVersion: "1.0.0",
      sources: [
        {
          source: "pattern-db",
          matches: [
            {
              pattern: "reentrancy",
              description: `Reentrancy in withdraw ${"x".repeat(3 * 1024 * 1024)}`,
              file: "src/VulnerableVault.sol",
              lines: [10, 20],
              severity: "High",
            },
          ],
        },
      ],
    })
    expect(fullResult.length).toBeGreaterThanOrEqual(3 * 1024 * 1024)
    toolResultCache.set("oc-trunc", "argus_check_patterns", fullResult)

    const truncatedStub =
      "... output was truncated ... 3145728 bytes truncated ... tool call succeeded"
    type AfterHook = NonNullable<ReturnType<typeof createHooks>["tool.execute.after"]>
    await (hooks["tool.execute.after"] as AfterHook)(
      {
        tool: "argus_check_patterns",
        sessionID: "oc-trunc",
        callID: "call-trunc",
        args: {},
      } as Parameters<AfterHook>[0],
      { title: "", output: truncatedStub, metadata: {} } as Parameters<AfterHook>[1],
    )

    expect(toolResultCache.size()).toBe(0)

    await hooks.event?.({
      event: { type: "session.deleted", properties: { info: { id: "oc-trunc" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    const findingsPath = createAuditArtifactResolver(freshRunId, FIXTURE_DIR).paths().findingsFile
    const findingsArtifact = JSON.parse(await Bun.file(findingsPath).text()) as {
      event_count: number
      findings: unknown[]
      toolsExecuted: Array<{ tool: string; success: boolean; error?: string }>
    }
    expect(findingsArtifact.event_count).toBeGreaterThanOrEqual(3)
    expect(findingsArtifact.findings).toHaveLength(1)

    const completed = findingsArtifact.toolsExecuted.find(
      (tool) => tool.tool === "argus_check_patterns",
    )
    expect(completed?.success).toBe(true)
    expect(completed?.error).toBeUndefined()

    const eventsPath = createAuditArtifactResolver(freshRunId, FIXTURE_DIR).paths().journalFile
    const eventLog = await Bun.file(eventsPath).text()
    expect(eventLog).not.toContain("TRUNCATED_OUTPUT")
  })

  it("materializes findings artifact when report generation completes before session deletion", async () => {
    const config = ArgusConfigSchema.parse({})
    const recoveredRunId = `run-live-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })

    const auditStateManager = {
      bindSession: () => {},
      load: async () => activeState,
      save: async () => {},
      get: () => activeState,
      update: async () => {},
      reset: async () => {},
      archive: async () => {},
      dispose: async () => {},
    }

    const hooks = createHooks({
      config,
      auditStateManager,
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
          success: true,
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

  // P0-2 regression: the report runs in Scribe's session and the resolved Themis
  // disposition is recorded from a different session, so reportGenerated lives only on
  // Scribe's state copy. Finalization must key on the run event stream, not the
  // disposition session's siloed reportGenerated flag.
  it("finalizes run when report and resolved disposition arrive on different sessions", async () => {
    const config = ArgusConfigSchema.parse({})
    const recoveredRunId = `run-cross-session-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })
    const auditStateManager = makeAuditStateManager()
    auditStateManager.load = async () => activeState
    auditStateManager.get = () => activeState

    const hooks = createHooks({
      config,
      auditStateManager,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-orchestrator" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, "oc-orchestrator")

    const freshRunId = await waitForRunId("oc-orchestrator")

    await hooks["tool.execute.after"]?.(
      {
        tool: "argus_generate_report",
        args: { target: FIXTURE_DIR },
        sessionID: "oc-scribe",
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[0],
      {
        title: "argus_generate_report",
        output: JSON.stringify({
          success: true,
          run_id: freshRunId,
          filePath: ".argus/reports/cross.md",
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
        sessionID: "oc-orchestrator",
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

    const journalPath = createAuditArtifactResolver(freshRunId, FIXTURE_DIR).paths().journalFile
    const events = (await Bun.file(journalPath).text())
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string; payload?: Record<string, unknown> })
    const finalizationEvent = [...events].reverse().find((event) => event.type === "run.finalized")

    expect(finalizationEvent).toBeDefined()
    expect(finalizationEvent?.payload?.status).toBe("finalized")
  })

  // P1-2 regression: a finalized run must not bleed into a new audit started in the same
  // OpenCode session. Re-activating the session after finalization must start a fresh run
  // rather than reuse the closed run's state.
  it("starts a fresh run when a finalized session is reused for a new audit", async () => {
    const config = ArgusConfigSchema.parse({})
    const recoveredRunId = `run-reuse-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })
    const auditStateManager = makeAuditStateManager()
    auditStateManager.load = async () => activeState
    auditStateManager.get = () => activeState

    const hooks = createHooks({
      config,
      auditStateManager,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-reuse" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, "oc-reuse")
    const firstRunId = await waitForRunId("oc-reuse")

    await hooks["tool.execute.after"]?.(
      {
        tool: "argus_generate_report",
        args: { target: FIXTURE_DIR },
        sessionID: "oc-reuse",
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[0],
      {
        title: "argus_generate_report",
        output: JSON.stringify({
          success: true,
          run_id: firstRunId,
          filePath: ".argus/reports/reuse.md",
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
        sessionID: "oc-reuse",
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

    await activateArgusSession(hooks, "oc-reuse")
    const secondRunId = await waitForRunId("oc-reuse")

    expect(secondRunId).not.toBe(firstRunId)
  })

  it("finalizes run on session.idle after successful report generation", async () => {
    const config = ArgusConfigSchema.parse({})
    const recoveredRunId = `run-idle-finalize-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })

    const auditStateManager = {
      bindSession: () => {},
      load: async () => activeState,
      save: async () => {},
      get: () => activeState,
      update: async () => {},
      reset: async () => {},
      archive: async () => {},
      dispose: async () => {},
    }

    const hooks = createHooks({
      config,
      auditStateManager,
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
          success: true,
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
    const sessionId = `oc-idle-waits-themis-${Date.now()}`
    const recoveredRunId = `run-idle-waits-themis-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })

    const auditStateManager = {
      bindSession: () => {},
      load: async () => activeState,
      save: async () => {},
      get: () => activeState,
      update: async () => {},
      reset: async () => {},
      archive: async () => {},
      dispose: async () => {},
    }

    const hooks = createHooks({
      config,
      auditStateManager,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: sessionId } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, sessionId)

    const freshRunId = await waitForRunId(sessionId)

    await hooks["tool.execute.after"]?.(
      {
        tool: "argus_generate_report",
        args: { target: FIXTURE_DIR },
      } as unknown as Parameters<NonNullable<(typeof hooks)["tool.execute.after"]>>[0],
      {
        title: "argus_generate_report",
        output: JSON.stringify({
          success: true,
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
    const sessionId = `oc-parent-sink-${Date.now()}`
    const childSessionId = `oc-child-sink-${Date.now()}`

    const auditStateManager = {
      bindSession: () => {},
      load: async () => activeState,
      save: async () => {},
      get: () => activeState,
      update: async () => {},
      reset: async () => {},
      archive: async () => {},
      dispose: async () => {},
    }

    const hooks = createHooks({
      config,
      auditStateManager,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: sessionId } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, sessionId)

    const freshRunId = await waitForRunId(sessionId)

    await hooks["tool.execute.after"]?.(
      {
        tool: "argus_forge_test",
        args: { target: FIXTURE_DIR },
        sessionID: childSessionId,
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
    expect(started[0]?.session_id).toBe(childSessionId)
    expect(completed[0]?.run_id).toBe(freshRunId)
    expect(completed[0]?.session_id).toBe(childSessionId)
  })

  it("does not bind an unrelated session to the newest active run", async () => {
    const config = ArgusConfigSchema.parse({})
    const hooks = createHooks({
      config,
      auditStateManager: makeAuditStateManager(),
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })
    const suffix = Date.now()
    const primarySession = `oc-primary-${suffix}`
    const unrelatedSession = `oc-unrelated-${suffix}`

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: primarySession } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, primarySession)
    const primaryRunId = await waitForRunId(primarySession)

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: unrelatedSession } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, unrelatedSession)
    const unrelatedRunId = await waitForRunId(unrelatedSession)

    expect(unrelatedRunId).not.toBe(primaryRunId)
  })

  it("binds a child created with parent lineage before activation to the canonical run", async () => {
    const hooks = createHooks({
      config: ArgusConfigSchema.parse({}),
      auditStateManager: makeAuditStateManager(),
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })
    const suffix = Date.now()
    const parentSession = `oc-lineage-parent-${suffix}`
    const childSession = `oc-lineage-child-${suffix}`

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: parentSession } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, parentSession)
    const parentRunId = await waitForRunId(parentSession)

    await hooks.event?.({
      event: {
        type: "session.created",
        properties: { info: { id: childSession, parentID: parentSession } },
      },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await hooks["chat.params"]?.(
      { sessionID: childSession, agent: "sentinel" } as Parameters<
        NonNullable<ReturnType<typeof createHooks>["chat.params"]>
      >[0],
      { temperature: 0, topP: 1, topK: 0, options: {} } as Parameters<
        NonNullable<ReturnType<typeof createHooks>["chat.params"]>
      >[1],
    )

    expect(await waitForRunId(childSession)).toBe(parentRunId)
  })

  it("tool tracking continues after session.idle without losing sink", async () => {
    const config = ArgusConfigSchema.parse({})
    const recoveredRunId = `run-persist-sink-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })
    const sessionId = `oc-persist-sink-${Date.now()}`
    const childSessionId = `oc-child-after-idle-${Date.now()}`

    const auditStateManager = {
      bindSession: () => {},
      load: async () => activeState,
      save: async () => {},
      get: () => activeState,
      update: async () => {},
      reset: async () => {},
      archive: async () => {},
      dispose: async () => {},
    }

    const hooks = createHooks({
      config,
      auditStateManager,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: sessionId } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, sessionId)

    const freshRunId = await waitForRunId(sessionId)

    await hooks.event?.({
      event: { type: "session.idle", properties: { sessionID: "oc-persist-sink" } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

    await hooks["tool.execute.after"]?.(
      {
        tool: "argus_slither_analyze",
        args: { target: FIXTURE_DIR },
        sessionID: childSessionId,
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
    expect(started[0]?.session_id).toBe(childSessionId)
    expect(completed[0]?.run_id).toBe(freshRunId)
    expect(completed[0]?.session_id).toBe(childSessionId)
  })

  it("rejects report output whose run_id mismatches the active run", async () => {
    const config = ArgusConfigSchema.parse({})
    const recoveredRunId = `run-canonical-${Date.now()}`
    const activeState = makeAuditState({ sessionId: recoveredRunId })

    const auditStateManager = {
      bindSession: () => {},
      load: async () => activeState,
      save: async () => {},
      get: () => activeState,
      update: async () => {},
      reset: async () => {},
      archive: async () => {},
      dispose: async () => {},
    }

    const hooks = createHooks({
      config,
      auditStateManager,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "oc-canonical" } } },
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
    await activateArgusSession(hooks, "oc-canonical")

    const freshRunId = await waitForRunId("oc-canonical")

    const toolExecuteAfter = hooks["tool.execute.after"]
    if (!toolExecuteAfter) throw new Error("tool.execute.after hook unavailable")
    await expect(
      toolExecuteAfter(
        {
          tool: "argus_generate_report",
          args: { target: FIXTURE_DIR },
          sessionID: "oc-canonical",
        } as unknown as Parameters<typeof toolExecuteAfter>[0],
        {
          title: "argus_generate_report",
          output: JSON.stringify({
            success: true,
            run_id: "ses_should_not_be_used",
            filePath: ".argus/reports/mismatch.md",
            report: "ok",
          }),
          metadata: {},
        } as unknown as Parameters<typeof toolExecuteAfter>[1],
      ),
    ).rejects.toThrow("does not match active run")

    const findingsPath = createAuditArtifactResolver(freshRunId, FIXTURE_DIR).paths().findingsFile
    expect(await Bun.file(findingsPath).exists()).toBe(false)
  })

  it("dispose removes process exit handler", () => {
    const config = ArgusConfigSchema.parse({})
    const listenersBefore = process.listenerCount("exit")

    const hooks = createHooks({
      config,
      auditStateManager: makeAuditStateManager(),
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

describe("selectToolResultForParsing", () => {
  it("selects a full tracking payload without exposing it in output.output", () => {
    const cache = createToolResultCache()
    const compact = '{"success":true,"matches":["first"]}'
    const full = '{"success":true,"sources":[{"matches":["first","second"]}]}'
    cache.setTracking("ses_1", "argus_check_patterns", compact, full)

    expect(selectToolResultForParsing(compact, "ses_1", "argus_check_patterns", cache)).toBe(full)
    expect(cache.size()).toBe(0)
  })

  it("prefers the captured full result over a truncated output.output", () => {
    const cache = createToolResultCache()
    const full = '{"success":true,"sources":[{"matches":[{"pattern":"reentrancy"}]}]}'
    cache.set("ses_1", "argus_check_patterns", full)

    const truncated = full.slice(0, 56)
    const selected = selectToolResultForParsing(truncated, "ses_1", "argus_check_patterns", cache)

    expect(selected).toBe(full)
    expect(cache.size()).toBe(0)
  })

  it("falls back to output.output and preserves a shorter mis-paired entry for its owner", () => {
    const cache = createToolResultCache()
    cache.set("ses_1", "argus_solodit_search", "tiny")

    const rawOutput = "a much longer, complete output.output from a different call"
    const selected = selectToolResultForParsing(rawOutput, "ses_1", "argus_solodit_search", cache)

    expect(selected).toBe(rawOutput)
    expect(cache.size()).toBe(1)
  })

  it("falls back to output.output and preserves a cached entry that is not a prefix of it", () => {
    const cache = createToolResultCache()
    cache.set("ses_1", "argus_skill_load", "ZZZ a longer but unrelated cached result here")

    const rawOutput = '{"partial'
    const selected = selectToolResultForParsing(rawOutput, "ses_1", "argus_skill_load", cache)

    expect(selected).toBe(rawOutput)
    expect(cache.size()).toBe(1)
  })

  it("recovers the correct result among parallel same-tool calls, regardless of order", () => {
    const cache = createToolResultCache()
    const a = '{"call":"a","sources":[{"matches":["reentrancy"]}]}'
    const b = '{"call":"b","sources":[{"matches":["access-control","oracle"]}]}'
    cache.set("ses_1", "argus_check_patterns", a)
    cache.set("ses_1", "argus_check_patterns", b)

    const truncatedB = b.slice(0, 12)
    const truncatedA = a.slice(0, 12)

    expect(selectToolResultForParsing(truncatedB, "ses_1", "argus_check_patterns", cache)).toBe(b)
    expect(cache.size()).toBe(1)
    expect(selectToolResultForParsing(truncatedA, "ses_1", "argus_check_patterns", cache)).toBe(a)
    expect(cache.size()).toBe(0)
  })

  it("recovers replacement truncation stubs in same-tool completion order", () => {
    const cache = createToolResultCache()
    const first = JSON.stringify({ call: "first", success: true, payload: "x".repeat(100) })
    const second = JSON.stringify({ call: "second", success: true, payload: "y".repeat(100) })
    cache.set("ses_1", "argus_check_patterns", first)
    cache.set("ses_1", "argus_check_patterns", second)

    expect(
      selectToolResultForParsing(
        "... output was truncated ... 1024 bytes truncated ...",
        "ses_1",
        "argus_check_patterns",
        cache,
      ),
    ).toBe(first)
    expect(
      selectToolResultForParsing(
        "... output was truncated ... 2048 bytes truncated ...",
        "ses_1",
        "argus_check_patterns",
        cache,
      ),
    ).toBe(second)
    expect(cache.size()).toBe(0)
  })

  it("falls back to output.output when the cache has no entry", () => {
    const cache = createToolResultCache()
    const raw = '{"success":true}'

    expect(selectToolResultForParsing(raw, "ses_1", "argus_forge_test", cache)).toBe(raw)
  })

  it("falls back to output.output when sessionID is undefined and does not consume the cache", () => {
    const cache = createToolResultCache()
    cache.set("ses_1", "argus_check_patterns", "full")

    expect(selectToolResultForParsing("raw", undefined, "argus_check_patterns", cache)).toBe("raw")
    expect(cache.size()).toBe(1)
  })
})

describe("trimDeletedSessionTombstones", () => {
  it("retains tombstones while activation work is in flight", () => {
    const deletedSessions = new Set(Array.from({ length: 501 }, (_, index) => `session-${index}`))
    const pendingActivations = new Set(["session-0"])

    trimDeletedSessionTombstones(deletedSessions, pendingActivations, 500)
    expect(deletedSessions.has("session-0")).toBe(true)
    expect(deletedSessions.has("session-1")).toBe(false)
    expect(deletedSessions.size).toBe(500)

    pendingActivations.clear()
    trimDeletedSessionTombstones(deletedSessions, pendingActivations, 500)
    expect(deletedSessions.size).toBe(500)
  })
})
