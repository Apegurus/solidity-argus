import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Event } from "@opencode-ai/sdk"
import { ArgusConfigSchema } from "../../src/config/schema"
import { createHooks } from "../../src/create-hooks"
import { createManagers } from "../../src/create-managers"
import { createEventSink, resetSinkRegistry } from "../../src/features/persistent-state/event-sink"
import { finalizeRun } from "../../src/features/persistent-state/run-finalizer"
import { pruneStaleRuns } from "../../src/features/persistent-state/run-pruner"
import type { AuditEvent } from "../../src/state/schemas"
import { SCHEMA_VERSION } from "../../src/state/schemas"

describe("Full Audit Pipeline Integration", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    resetSinkRegistry()
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "argus-pipeline-"))
    tempDirs.push(dir)
    return dir
  }

  function makeEvent(runId: string, overrides: Partial<AuditEvent>): AuditEvent {
    return {
      type: "session.created",
      run_id: runId,
      seq: 0,
      session_id: "ses-test",
      source: "test",
      schema_version: SCHEMA_VERSION,
      timestamp: Date.now(),
      payload: {},
      ...overrides,
    }
  }

  function setMtime(path: string, ageMs: number): void {
    const past = new Date(Date.now() - ageMs)
    const { utimesSync } = require("node:fs") as typeof import("node:fs")
    utimesSync(path, past, past)
  }

  describe("EventSink finalization lifecycle", () => {
    test("sink starts not finalized, becomes finalized after finalizeRun", async () => {
      const projectDir = makeTempDir()
      const runId = "run-finalize-lifecycle"
      const sink = createEventSink(runId, projectDir)

      await sink.append(makeEvent(runId, { type: "session.created" }))
      expect(sink.isFinalized).toBe(false)

      const result = await finalizeRun(runId, projectDir, sink)

      expect(result.invariantsPassed).toBe(true)
      expect(sink.isFinalized).toBe(true)
    })

    test("finalized sink drops tool events silently", async () => {
      const projectDir = makeTempDir()
      const runId = "run-drop-events"
      const sink = createEventSink(runId, projectDir)

      await sink.append(makeEvent(runId, { type: "session.created" }))
      await finalizeRun(runId, projectDir, sink)
      expect(sink.isFinalized).toBe(true)

      await sink.append(makeEvent(runId, { type: "tool.started" }))
      await sink.append(makeEvent(runId, { type: "tool.completed" }))
      await sink.append(makeEvent(runId, { type: "session.idle" }))

      const events = await sink.readAll()
      const postFinalizationEvents = events.filter(
        (e) => e.type !== "session.created" && e.type !== "run.finalized",
      )
      expect(postFinalizationEvents).toHaveLength(0)
    })

    test("finalized sink still accepts run.finalized event (recompute)", async () => {
      const projectDir = makeTempDir()
      const runId = "run-allow-refinalize"
      const sink = createEventSink(runId, projectDir)

      await sink.append(makeEvent(runId, { type: "session.created" }))
      await finalizeRun(runId, projectDir, sink)
      expect(sink.isFinalized).toBe(true)

      await sink.append(makeEvent(runId, { type: "run.finalized", payload: { recompute: true } }))

      const events = await sink.readAll()
      const finalizations = events.filter((e) => e.type === "run.finalized")
      expect(finalizations.length).toBeGreaterThanOrEqual(2)
    })

    test("run.finalized event has correct payload structure", async () => {
      const projectDir = makeTempDir()
      const runId = "run-payload-check"
      const sink = createEventSink(runId, projectDir)

      await sink.append(makeEvent(runId, { type: "session.created" }))
      const result = await finalizeRun(runId, projectDir, sink)

      const events = await sink.readAll()
      const finalized = events.find((e) => e.type === "run.finalized")

      expect(finalized).toBeDefined()
      expect(finalized?.run_id).toBe(runId)
      expect(finalized?.source).toBe("run-finalizer")

      const payload = finalized?.payload as Record<string, unknown>
      expect(payload.invariantsPassed).toBe(true)
      expect(payload.status).toBe("finalized")
      expect(payload.errors).toEqual([])
      expect(typeof payload.plugin_version).toBe("string")

      expect(result.success).toBe(true)
      expect(result.runId).toBe(runId)
    })
  })

  describe("Stale run pruning", () => {
    test("prunes non-finalized runs older than stale TTL", async () => {
      const projectDir = makeTempDir()
      const runsDir = join(projectDir, ".argus", "runs")

      const staleRunDir = join(runsDir, "stale-run-1")
      mkdirSync(staleRunDir, { recursive: true })
      writeFileSync(
        join(staleRunDir, "events.jsonl"),
        `${JSON.stringify(makeEvent("stale-run-1", { type: "session.created" }))}\n`,
      )
      setMtime(join(staleRunDir, "events.jsonl"), 25 * 60 * 60 * 1000)

      const freshRunDir = join(runsDir, "fresh-run-1")
      mkdirSync(freshRunDir, { recursive: true })
      writeFileSync(
        join(freshRunDir, "events.jsonl"),
        `${JSON.stringify(makeEvent("fresh-run-1", { type: "session.created" }))}\n`,
      )

      const result = await pruneStaleRuns(projectDir, {
        staleTtlMs: 24 * 60 * 60 * 1000,
      })

      expect(result.pruned).toContain("stale-run-1")
      expect(result.kept).toContain("fresh-run-1")
      expect(existsSync(staleRunDir)).toBe(false)
      expect(existsSync(freshRunDir)).toBe(true)
    })

    test("prunes finalized runs older than retention period", async () => {
      const projectDir = makeTempDir()
      const runsDir = join(projectDir, ".argus", "runs")

      const oldFinalizedDir = join(runsDir, "old-finalized-1")
      mkdirSync(oldFinalizedDir, { recursive: true })
      const events = [
        makeEvent("old-finalized-1", { type: "session.created" }),
        makeEvent("old-finalized-1", { type: "run.finalized" }),
      ]
      writeFileSync(
        join(oldFinalizedDir, "events.jsonl"),
        `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
      )
      setMtime(join(oldFinalizedDir, "events.jsonl"), 8 * 24 * 60 * 60 * 1000)

      const result = await pruneStaleRuns(projectDir, {
        finalizedRetentionMs: 7 * 24 * 60 * 60 * 1000,
      })

      expect(result.pruned).toContain("old-finalized-1")
      expect(existsSync(oldFinalizedDir)).toBe(false)
    })

    test("keeps recently finalized runs", async () => {
      const projectDir = makeTempDir()
      const runsDir = join(projectDir, ".argus", "runs")

      const recentDir = join(runsDir, "recent-finalized-1")
      mkdirSync(recentDir, { recursive: true })
      const events = [
        makeEvent("recent-finalized-1", { type: "session.created" }),
        makeEvent("recent-finalized-1", { type: "run.finalized" }),
      ]
      writeFileSync(
        join(recentDir, "events.jsonl"),
        `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
      )

      const result = await pruneStaleRuns(projectDir)

      expect(result.kept).toContain("recent-finalized-1")
      expect(existsSync(recentDir)).toBe(true)
    })

    test("dry run lists candidates without deleting", async () => {
      const projectDir = makeTempDir()
      const runsDir = join(projectDir, ".argus", "runs")

      const staleDir = join(runsDir, "dry-run-candidate")
      mkdirSync(staleDir, { recursive: true })
      writeFileSync(
        join(staleDir, "events.jsonl"),
        `${JSON.stringify(makeEvent("dry-run-candidate", { type: "session.created" }))}\n`,
      )
      setMtime(join(staleDir, "events.jsonl"), 25 * 60 * 60 * 1000)

      const result = await pruneStaleRuns(projectDir, {
        staleTtlMs: 24 * 60 * 60 * 1000,
        dryRun: true,
      })

      expect(result.pruned).toContain("dry-run-candidate")
      expect(existsSync(staleDir)).toBe(true)
    })
  })

  describe("Hook lifecycle without errors", () => {
    test("event hook handles full session lifecycle without throwing", async () => {
      const projectDir = makeTempDir()
      const config = ArgusConfigSchema.parse({})
      const managers = createManagers({ projectDir, config })
      const hooks = createHooks({
        config,
        managers,
        projectDir,
        isHookEnabled: () => true,
      })

      await hooks.event?.({
        event: {
          type: "session.created",
          properties: { sessionID: "ses-lifecycle" },
        } as unknown as Event,
      })
      await hooks.event?.({
        event: {
          type: "session.idle",
          properties: { sessionID: "ses-lifecycle" },
        } as unknown as Event,
      })
      await hooks.event?.({
        event: {
          type: "session.deleted",
          properties: { sessionID: "ses-lifecycle" },
        } as unknown as Event,
      })
    })
  })

  describe("End-to-end: create → populate → finalize → verify", () => {
    test("full run lifecycle produces correct event journal", async () => {
      const projectDir = makeTempDir()
      const runId = "e2e-full-run"
      const sink = createEventSink(runId, projectDir)

      await sink.append(
        makeEvent(runId, { type: "session.created", payload: { scope: ["Vault.sol"] } }),
      )

      await sink.append(
        makeEvent(runId, {
          type: "tool.started",
          payload: { tool: "argus_slither_analyze" },
          tool_call_id: "tc-1",
        }),
      )
      await sink.append(
        makeEvent(runId, {
          type: "finding.added",
          payload: {
            id: "f-1",
            check: "reentrancy-eth",
            severity: "High",
            description: "Reentrancy in withdraw",
            file: "Vault.sol",
          },
          tool_call_id: "tc-1",
        }),
      )
      await sink.append(
        makeEvent(runId, {
          type: "tool.completed",
          payload: { tool: "argus_slither_analyze", success: true, findingsCount: 1 },
          tool_call_id: "tc-1",
        }),
      )

      await sink.append(makeEvent(runId, { type: "phase.changed", payload: { phase: "scanning" } }))

      expect(sink.isFinalized).toBe(false)

      const result = await finalizeRun(runId, projectDir, sink)
      expect(result.invariantsPassed).toBe(true)
      expect(result.errors).toEqual([])
      expect(sink.isFinalized).toBe(true)

      await sink.append(makeEvent(runId, { type: "session.idle" }))
      await sink.append(makeEvent(runId, { type: "tool.started" }))

      const allEvents = await sink.readAll()
      expect(allEvents.filter((e) => e.type === "session.idle")).toHaveLength(0)
      expect(allEvents.filter((e) => e.type === "run.finalized")).toHaveLength(1)

      const finalizationEvent = allEvents.find((e) => e.type === "run.finalized")
      const payload = finalizationEvent?.payload as Record<string, unknown>
      expect(payload.status).toBe("finalized")

      const seqs = allEvents.map((e) => e.seq)
      for (let i = 0; i < seqs.length; i++) {
        expect(seqs[i]).toBe(i + 1)
      }
    })
  })
})
