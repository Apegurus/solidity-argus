import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AuditEvent } from "../../state/schemas"
import { SCHEMA_VERSION } from "../../state/schemas"
import { finalizeRun } from "./run-finalizer"

const RUN_ID = "run-finalizer-test"

function makeEvent(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    type: "session.created",
    run_id: RUN_ID,
    seq: 1,
    session_id: "ses-parent",
    source: "test",
    schema_version: SCHEMA_VERSION,
    timestamp: Date.now(),
    payload: {},
    ...overrides,
  }
}

function makeInMemorySink(initialEvents: AuditEvent[]) {
  const events = [...initialEvents]
  const state = { finalized: false }

  return {
    runId: RUN_ID,
    get isFinalized() {
      return state.finalized
    },
    markFinalized() {
      state.finalized = true
    },
    append: async (event: AuditEvent): Promise<void> => {
      const nextSeq = events.length + 1
      events.push({ ...event, seq: nextSeq })
    },
    readAll: async (): Promise<AuditEvent[]> => [...events],
    getEvents: (): AuditEvent[] => [...events],
  }
}

describe("finalizeRun", () => {
  test("returns existing successful finalization without appending a new event", async () => {
    const sink = makeInMemorySink([
      makeEvent({ type: "session.created", seq: 1 }),
      makeEvent({
        type: "run.finalized",
        seq: 2,
        payload: { finalized: true, invariantsPassed: true },
      }),
    ])

    const result = await finalizeRun(RUN_ID, process.cwd(), sink)

    expect(result.invariantsPassed).toBe(true)
    expect(sink.getEvents().filter((event) => event.type === "run.finalized")).toHaveLength(1)
  })

  test("recomputes when successful finalization is stale and newer events exist", async () => {
    const sink = makeInMemorySink([
      makeEvent({ type: "session.created", seq: 1 }),
      makeEvent({
        type: "run.finalized",
        seq: 2,
        payload: { finalized: true, invariantsPassed: true },
      }),
      makeEvent({
        type: "tool.started",
        seq: 3,
        tool_call_id: "tool-1",
        payload: { tool: "argus_analyze_contract" },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 4,
        tool_call_id: "tool-1",
        payload: { tool: "argus_analyze_contract", success: true, findingsCount: 0 },
      }),
    ])

    const result = await finalizeRun(RUN_ID, process.cwd(), sink)

    expect(result.invariantsPassed).toBe(true)
    expect(sink.getEvents().filter((event) => event.type === "run.finalized")).toHaveLength(2)
  })

  test("treats parent session as valid writer when it dispatches child sessions", async () => {
    const sink = makeInMemorySink([
      makeEvent({ type: "session.created", seq: 1, session_id: "ses-child" }),
      makeEvent({
        type: "tool.started",
        seq: 2,
        session_id: "ses-parent",
        tool_call_id: "task-1",
        payload: {
          tool: "task",
          correlation_id: "corr-1",
          child_session_id: "ses-child",
        },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 3,
        session_id: "ses-parent",
        tool_call_id: "task-1",
        payload: {
          tool: "task",
          findingsCount: 0,
          success: true,
          correlation_id: "corr-1",
          child_session_id: "ses-child",
        },
      }),
      makeEvent({
        type: "tool.started",
        seq: 4,
        session_id: "ses-child",
        tool_call_id: "tool-1",
        payload: { tool: "argus_slither_analyze" },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 5,
        session_id: "ses-child",
        tool_call_id: "tool-1",
        payload: { tool: "argus_slither_analyze", findingsCount: 3, success: true },
      }),
    ])

    const result = await finalizeRun(RUN_ID, process.cwd(), sink)

    expect(result.invariantsPassed).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  test("recomputes when existing finalization failed and appends upgraded result", async () => {
    const sink = makeInMemorySink([
      makeEvent({ type: "session.created", seq: 1 }),
      makeEvent({
        type: "run.finalized",
        seq: 2,
        payload: {
          finalized: false,
          invariantsPassed: false,
          errors: ["missing required lifecycle event: session.deleted"],
        },
      }),
    ])

    const result = await finalizeRun(RUN_ID, process.cwd(), sink)

    expect(result.invariantsPassed).toBe(true)
    expect(sink.getEvents().filter((event) => event.type === "run.finalized")).toHaveLength(2)
    const latest = sink.getEvents().at(-1)
    expect(latest?.type).toBe("run.finalized")
    expect((latest?.payload as { status?: string } | undefined)?.status).toBe("finalized")
  })

  test("fails invariants when generated report contains a completeness warning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "argus-finalizer-warning-"))
    const reportPath = join(dir, "warn-report.md")
    writeFileSync(
      reportPath,
      [
        "# Security Audit Report — WarningFixture",
        "",
        "## ⚠ Completeness Warning",
        "",
        "- Finding parity mismatch: missing=1, extra=0",
      ].join("\n"),
    )

    try {
      const sink = makeInMemorySink([
        makeEvent({ type: "session.created", seq: 1 }),
        makeEvent({
          type: "tool.completed",
          seq: 2,
          tool_call_id: "report-tool-1",
          payload: {
            tool: "argus_generate_report",
            success: true,
            filePath: reportPath,
          },
        }),
      ])

      const result = await finalizeRun(RUN_ID, dir, sink)

      expect(result.invariantsPassed).toBe(false)
      expect(result.errors).toContain("generated report contains Completeness Warning")
      const latest = sink.getEvents().at(-1)
      expect((latest?.payload as { status?: string } | undefined)?.status).toBe(
        "failed-finalization",
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("fails invariants when generated report quality gates fail", async () => {
    const sink = makeInMemorySink([
      makeEvent({ type: "session.created", seq: 1 }),
      makeEvent({
        type: "tool.completed",
        seq: 2,
        tool_call_id: "report-tool-1",
        payload: {
          tool: "argus_generate_report",
          success: true,
          qualityGates: {
            passed: false,
            violations: ["Missing impact for High finding reentrancy-drain"],
          },
        },
      }),
    ])

    const result = await finalizeRun(RUN_ID, process.cwd(), sink)

    expect(result.invariantsPassed).toBe(false)
    expect(result.errors).toContain(
      "generated report failed quality gates: Missing impact for High finding reentrancy-drain",
    )
    const latest = sink.getEvents().at(-1)
    expect((latest?.payload as { status?: string } | undefined)?.status).toBe("failed-finalization")
  })
})
