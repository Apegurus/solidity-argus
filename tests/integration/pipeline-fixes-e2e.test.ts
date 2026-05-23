import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { ArgusConfigSchema } from "../../src/config/schema"
import { createHooks } from "../../src/create-hooks"
import {
  createEventSink,
  readEvents,
  resetSinkRegistry,
} from "../../src/features/persistent-state/event-sink"
import { materializeReportInput } from "../../src/features/persistent-state/findings-materializer"
import { resolveRunIdFromOpencodeSession } from "../../src/features/persistent-state/global-run-index"
import { finalizeRun } from "../../src/features/persistent-state/run-finalizer"
import type { Managers } from "../../src/managers/types"
import type { AuditEvent } from "../../src/state/schemas"
import { SCHEMA_VERSION } from "../../src/state/schemas"
import type { AuditState } from "../../src/state/types"
import { executeReadFindings } from "../../src/tools/read-findings-tool"
import { reportGeneratorTool } from "../../src/tools/report-generator-tool"

const FIXTURE_DIR = resolve(import.meta.dir, "../fixtures/vulnerable-vault")
const RUNS_DIR = join(FIXTURE_DIR, ".argus", "runs")

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

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "argus-pipeline-e2e-"))
}

function makeEvent(runId: string, overrides: Partial<AuditEvent>): AuditEvent {
  return {
    type: "session.created",
    run_id: runId,
    seq: 0,
    session_id: "ses-e2e",
    source: "e2e-test",
    schema_version: SCHEMA_VERSION,
    timestamp: Date.now(),
    payload: {},
    ...overrides,
  }
}

function makeToolContext(dir: string): ToolContext {
  return {
    sessionID: "ses-e2e",
    messageID: "msg-e2e",
    agent: "scribe",
    directory: dir,
    worktree: dir,
    abort: new AbortController().signal,
    metadata() {
      return
    },
    async ask() {
      return
    },
  }
}

function makeCanonicalFinding(
  runId: string,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: "f-default",
    check: "generic-check",
    severity: "Medium",
    confidence: "Medium",
    description: "Generic finding",
    file: "src/Vault.sol",
    lines: [1, 10],
    source: "slither",
    run_id: runId,
    seq: 1,
    schema_version: SCHEMA_VERSION,
    observation_id: `obs-${Date.now()}`,
    issue_fingerprint: `ifp-${Date.now()}`,
    observation_fingerprint: `ofp-${Date.now()}`,
    reported_by_agent: "sentinel",
    ...overrides,
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

function makeManagers(overrides?: Partial<Managers>): Managers {
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
    ...overrides,
  }
}

async function writeSessionState(sessionId: string, state: AuditState): Promise<void> {
  const sessionsDir = join(FIXTURE_DIR, ".argus", "sessions")
  await mkdir(sessionsDir, { recursive: true })
  const filePath = join(sessionsDir, `state-${sessionId}.json`)

  await Bun.write(
    filePath,
    `${JSON.stringify({ ...state, savedAt: Date.now(), version: "2", filePath }, null, 2)}\n`,
  )
}

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

describe("Pipeline fixes E2E", () => {
  const tempDirs: string[] = []

  beforeEach(() => {
    const lock = Symbol.for("solidity-argus:instance-lock")
    delete (globalThis as unknown as Record<symbol, unknown>)[lock]
  })

  afterEach(() => {
    resetSinkRegistry()
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  function trackTempDir(dir: string): string {
    tempDirs.push(dir)
    return dir
  }

  describe("Fix #1: report tool returns slim JSON without full markdown", () => {
    test("report result has reportSummary but no report field", async () => {
      const reportArgs = {
        project_name: "TestVault",
        scope: ["Vault.sol"],
        include_executive_summary: true,
        severity_threshold: "low",
        preflight_policy: "warn",
        tool_coverage_policy: "warn",
        report_input: JSON.stringify({
          run_id: "test-run-pipeline-1",
          seq: 1,
          session_id: "ses-e2e",
          tool_call_id: "tc-report",
          source: "test",
          schema_version: SCHEMA_VERSION,
          projectDir: FIXTURE_DIR,
          findings: [
            {
              id: "f-1",
              check: "reentrancy",
              severity: "Critical",
              confidence: "High",
              description: "Reentrancy in withdraw()",
              file: "src/Vault.sol",
              lines: [10, 20],
              source: "slither",
              run_id: "test-run-pipeline-1",
              seq: 1,
              session_id: "ses-e2e",
              tool_call_id: "tc-1",
              schema_version: SCHEMA_VERSION,
              observation_id: "obs-1",
              issue_fingerprint: "ifp-1",
              observation_fingerprint: "ofp-1",
              reported_by_agent: "sentinel",
            },
          ],
          toolsExecuted: [],
          scope: ["Vault.sol"],
        }),
      }

      const payload = await reportGeneratorTool.execute(
        reportArgs as Parameters<typeof reportGeneratorTool.execute>[0],
        makeToolContext(FIXTURE_DIR),
      )

      const result = JSON.parse(payload) as Record<string, unknown>

      expect(result.report).toBeUndefined()
      expect(typeof result.reportSummary).toBe("string")
      expect(result.reportSummary as string).toContain("Report written to disk")
      expect(typeof result.run_id).toBe("string")
      expect(typeof result.filename).toBe("string")
      expect((result.findingsCount as Record<string, number>).critical).toBe(1)
    })
  })

  describe.skip("Fix #3: read-findings materializes from events on-demand", () => {
    test("executeReadFindings reads from events.jsonl, not static file", async () => {
      const dir = trackTempDir(makeTempDir())
      const runId = "run-e2e-read-findings"

      const journalDir = join(dir, ".argus", "runs", runId)
      await mkdir(journalDir, { recursive: true })

      const events = [
        makeEvent(runId, {
          type: "session.created",
          payload: { scope: ["src/Vault.sol"] },
        }),
        makeEvent(runId, {
          type: "finding.added",
          seq: 2,
          timestamp: Date.now() + 1,
          payload: makeCanonicalFinding(runId, {
            id: "f-1",
            check: "reentrancy",
            severity: "High",
          }),
        }),
      ]
      const lines = `${events.map((e) => JSON.stringify(e)).join("\n")}\n`
      await writeFile(join(journalDir, "events.jsonl"), lines)

      const payload = await executeReadFindings({ run_id: runId }, makeToolContext(dir))
      const parsed = JSON.parse(payload) as {
        success: boolean
        source: string
        reportInput: { run_id: string; findings: unknown[]; scope: string[] }
      }

      expect(parsed.success).toBe(true)
      expect(parsed.source).toBe("report-input.json")
      expect(parsed.reportInput.run_id).toBe(runId)
      expect(parsed.reportInput.findings.length).toBe(1)
      expect(parsed.reportInput.scope).toEqual(["src/Vault.sol"])
    })

    test("executeReadFindings throws when no events exist", async () => {
      const dir = trackTempDir(makeTempDir())

      expect(executeReadFindings({ run_id: "no-such-run" }, makeToolContext(dir))).rejects.toThrow(
        "No events found for run",
      )
    })
  })

  describe("Fix #4: stale/completed state is discarded on session.created", () => {
    test("recovered state with reportGenerated=true is discarded", async () => {
      const sessionId = "oc-new-session"
      const staleState = makeAuditState({
        sessionId: "old-completed-run",
        findings: [
          {
            id: "stale-f",
            check: "old-finding",
            severity: "High" as const,
            confidence: "High" as const,
            description: "Leftover from prior run",
            file: "old.sol",
            lines: [1, 2],
            source: "slither",
          },
        ],
        toolsExecuted: [
          { tool: "argus_slither_analyze", startTime: Date.now(), success: true, findingsCount: 1 },
        ],
        reportGenerated: true,
        startTime: Date.now(),
      })

      await writeSessionState(sessionId, staleState)
      const managers = makeManagers()

      const hooks = createHooks({
        config: ArgusConfigSchema.parse({}),
        managers,
        projectDir: FIXTURE_DIR,
        isHookEnabled: () => true,
      })

      await hooks.event?.({
        event: { type: "session.created", properties: { info: { id: sessionId } } },
      } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
      await activateArgusSession(hooks, sessionId)

      const freshRunId = await waitForRunId(sessionId)
      const eventsPath = join(RUNS_DIR, freshRunId, "events.jsonl")
      expect(existsSync(eventsPath)).toBe(true)

      await hooks.event?.({
        event: { type: "session.idle", properties: { info: { id: sessionId } } },
      } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

      const journalEvents = await readEvents(freshRunId, FIXTURE_DIR)
      const idleEvent = journalEvents.find((e) => e.type === "session.idle")
      const idlePayload = idleEvent?.payload as Record<string, unknown> | undefined
      expect(idlePayload?.findingsCount).toBe(0)
      expect(idlePayload?.toolsExecutedCount).toBe(0)
    })

    test("recovered state older than 24h is discarded", async () => {
      const sessionId = "oc-fresh-session"
      const TWENTY_FIVE_HOURS_AGO = Date.now() - 25 * 60 * 60 * 1000

      const staleState = makeAuditState({
        sessionId: "old-stale-run",
        findings: [
          {
            id: "stale-f",
            check: "old-finding",
            severity: "Medium" as const,
            confidence: "Medium" as const,
            description: "From yesterday",
            file: "old.sol",
            lines: [1, 2],
            source: "pattern",
          },
        ],
        startTime: TWENTY_FIVE_HOURS_AGO,
      })

      await writeSessionState(sessionId, staleState)
      const managers = makeManagers()

      const hooks = createHooks({
        config: ArgusConfigSchema.parse({}),
        managers,
        projectDir: FIXTURE_DIR,
        isHookEnabled: () => true,
      })

      await hooks.event?.({
        event: { type: "session.created", properties: { info: { id: sessionId } } },
      } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
      await activateArgusSession(hooks, sessionId)

      const freshRunId = await waitForRunId(sessionId)

      await hooks.event?.({
        event: { type: "session.idle", properties: { info: { id: sessionId } } },
      } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

      const journalEvents = await readEvents(freshRunId, FIXTURE_DIR)
      const idleEvent = journalEvents.find((e) => e.type === "session.idle")
      const idlePayload = idleEvent?.payload as Record<string, unknown> | undefined
      expect(idlePayload?.findingsCount).toBe(0)
    })

    test("fresh recovered state is preserved (not discarded)", async () => {
      const sessionId = "oc-continue-session"
      const freshState = makeAuditState({
        sessionId: "recent-active-run",
        findings: [
          {
            id: "active-f",
            check: "active-finding",
            severity: "High" as const,
            confidence: "High" as const,
            description: "Current audit finding",
            file: "active.sol",
            lines: [5, 10],
            source: "slither",
          },
        ],
        startTime: Date.now() - 60_000,
      })

      await writeSessionState(sessionId, freshState)
      const managers = makeManagers()

      const hooks = createHooks({
        config: ArgusConfigSchema.parse({}),
        managers,
        projectDir: FIXTURE_DIR,
        isHookEnabled: () => true,
      })

      await hooks.event?.({
        event: { type: "session.created", properties: { info: { id: sessionId } } },
      } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])
      await activateArgusSession(hooks, sessionId)

      const freshRunId = await waitForRunId(sessionId)

      await hooks.event?.({
        event: { type: "session.idle", properties: { info: { id: sessionId } } },
      } as unknown as Parameters<NonNullable<typeof hooks.event>>[0])

      const journalEvents = await readEvents(freshRunId, FIXTURE_DIR)
      const idleEvent = journalEvents.find((e) => e.type === "session.idle")
      const idlePayload = idleEvent?.payload as Record<string, unknown> | undefined
      expect(idlePayload?.findingsCount).toBe(1)
    })
  })

  describe("Fix #5: orphaned tools are warnings, not errors", () => {
    test("finalization succeeds with orphaned tools reported as warnings", async () => {
      const dir = trackTempDir(makeTempDir())
      const runId = "run-e2e-orphaned"
      const sink = createEventSink(runId, dir)

      await sink.append(
        makeEvent(runId, { type: "session.created", payload: { scope: ["Vault.sol"] } }),
      )
      await sink.append(
        makeEvent(runId, {
          type: "tool.started",
          tool_call_id: "tc-orphan-1",
          timestamp: Date.now() + 1,
          payload: { tool: "argus_slither_analyze" },
        }),
      )
      await sink.append(
        makeEvent(runId, {
          type: "tool.started",
          tool_call_id: "tc-complete-1",
          timestamp: Date.now() + 2,
          payload: { tool: "argus_check_patterns" },
        }),
      )
      await sink.append(
        makeEvent(runId, {
          type: "tool.completed",
          tool_call_id: "tc-complete-1",
          timestamp: Date.now() + 3,
          payload: { tool: "argus_check_patterns", success: true, findingsCount: 0 },
        }),
      )

      const result = await finalizeRun(runId, dir, sink)

      expect(result.invariantsPassed).toBe(true)
      expect(result.errors).toEqual([])
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings.some((w) => w.includes("tc-orphan-1"))).toBe(true)
      expect(sink.isFinalized).toBe(true)

      const events = await sink.readAll()
      const finalEvent = events.find((e) => e.type === "run.finalized")
      const payload = finalEvent?.payload as Record<string, unknown>
      expect(payload.invariantsPassed).toBe(true)
      expect(payload.status).toBe("finalized")
      expect(Array.isArray(payload.warnings)).toBe(true)
    })
  })

  describe.skip("Full lifecycle: create → populate → finalize → verify", () => {
    test("complete audit pipeline with findings, orphaned tool, and finalization", async () => {
      const dir = trackTempDir(makeTempDir())
      const runId = "run-e2e-full-lifecycle"
      const sink = createEventSink(runId, dir)

      await sink.append(
        makeEvent(runId, {
          type: "session.created",
          payload: { scope: ["src/Vault.sol", "src/Token.sol"] },
        }),
      )

      await sink.append(
        makeEvent(runId, {
          type: "tool.started",
          tool_call_id: "tc-slither",
          timestamp: Date.now() + 1,
          payload: { tool: "argus_slither_analyze" },
        }),
      )
      await sink.append(
        makeEvent(runId, {
          type: "finding.added",
          tool_call_id: "tc-slither",
          timestamp: Date.now() + 2,
          payload: makeCanonicalFinding(runId, {
            id: "f-reentrancy",
            check: "reentrancy-eth",
            severity: "Critical",
            confidence: "High",
            description: "Reentrancy in withdraw()",
            file: "src/Vault.sol",
            lines: [18, 22],
            source: "slither",
          }),
        }),
      )
      await sink.append(
        makeEvent(runId, {
          type: "tool.completed",
          tool_call_id: "tc-slither",
          timestamp: Date.now() + 3,
          payload: { tool: "argus_slither_analyze", success: true, findingsCount: 1 },
        }),
      )

      await sink.append(
        makeEvent(runId, {
          type: "tool.started",
          tool_call_id: "tc-patterns",
          timestamp: Date.now() + 4,
          payload: { tool: "argus_check_patterns" },
        }),
      )
      await sink.append(
        makeEvent(runId, {
          type: "finding.added",
          tool_call_id: "tc-patterns",
          timestamp: Date.now() + 5,
          payload: makeCanonicalFinding(runId, {
            id: "f-access",
            check: "missing-access-control",
            severity: "High",
            confidence: "Medium",
            description: "No auth on withdraw",
            file: "src/Vault.sol",
            lines: [16, 23],
            source: "pattern",
            observation_id: "obs-access",
            issue_fingerprint: "ifp-access",
            observation_fingerprint: "ofp-access",
          }),
        }),
      )
      await sink.append(
        makeEvent(runId, {
          type: "tool.completed",
          tool_call_id: "tc-patterns",
          timestamp: Date.now() + 6,
          payload: { tool: "argus_check_patterns", success: true, findingsCount: 1 },
        }),
      )

      await sink.append(
        makeEvent(runId, {
          type: "phase.changed",
          timestamp: Date.now() + 7,
          payload: { phase: "reporting" },
        }),
      )

      await sink.append(
        makeEvent(runId, {
          type: "tool.started",
          tool_call_id: "tc-killed",
          timestamp: Date.now() + 8,
          payload: { tool: "argus_solodit_search" },
        }),
      )

      const result = await finalizeRun(runId, dir, sink)

      expect(result.success).toBe(true)
      expect(result.invariantsPassed).toBe(true)
      expect(result.errors).toEqual([])
      expect(result.warnings.length).toBe(1)
      expect(result.warnings[0]).toContain("tc-killed")
      expect(result.runId).toBe(runId)
      expect(sink.isFinalized).toBe(true)

      const reportInput = await materializeReportInput(runId, dir)

      expect(reportInput.run_id).toBe(runId)
      expect(reportInput.schema_version).toBe(SCHEMA_VERSION)
      expect(reportInput.scope).toEqual(["src/Vault.sol", "src/Token.sol"])
      expect(reportInput.findings.length).toBe(2)
      expect(reportInput.toolsExecuted.length).toBeGreaterThanOrEqual(2)
      expect(reportInput.findings.some((f) => f.check === "reentrancy-eth")).toBe(true)
      expect(reportInput.findings.some((f) => f.check === "missing-access-control")).toBe(true)

      const findingsPayload = await executeReadFindings({ run_id: runId }, makeToolContext(dir))
      const parsed = JSON.parse(findingsPayload) as {
        success: boolean
        reportInput: { findings: unknown[]; toolsExecuted: unknown[] }
      }
      expect(parsed.success).toBe(true)
      expect(parsed.reportInput.findings.length).toBe(2)
      expect(parsed.reportInput.toolsExecuted.length).toBeGreaterThanOrEqual(2)

      await sink.append(makeEvent(runId, { type: "tool.started", timestamp: Date.now() + 100 }))
      await sink.append(makeEvent(runId, { type: "session.idle", timestamp: Date.now() + 101 }))

      const finalEvents = await sink.readAll()
      const postFinalizationNoise = finalEvents.filter(
        (e) =>
          e.type !== "session.created" &&
          e.type !== "tool.started" &&
          e.type !== "tool.completed" &&
          e.type !== "finding.added" &&
          e.type !== "phase.changed" &&
          e.type !== "run.finalized",
      )
      expect(postFinalizationNoise).toHaveLength(0)
    })
  })
})
