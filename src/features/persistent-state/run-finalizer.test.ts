import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AuditEvent } from "../../state/schemas"
import { SCHEMA_VERSION } from "../../state/schemas"
import { finalizeRun, hasResolvedThemisDispositionAfterReport } from "./run-finalizer"

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
  const owners = new Set<string>()

  return {
    runId: RUN_ID,
    get state() {
      return state.finalized ? ("SEALED" as const) : ("ACTIVE" as const)
    },
    get isFinalized() {
      return state.finalized
    },
    get ownerSet(): ReadonlySet<string> {
      return owners
    },
    addOwner(sessionId: string): void {
      owners.add(sessionId)
    },
    removeOwner(sessionId: string): void {
      owners.delete(sessionId)
    },
    markFinalized() {
      state.finalized = true
    },
    markDraining(): void {},
    markFailedRecoverable(): void {},
    append: async (event: AuditEvent): Promise<void> => {
      const nextSeq = events.length + 1
      events.push({ ...event, seq: nextSeq })
    },
    readAll: async (): Promise<AuditEvent[]> => [...events],
    getEvents: (): AuditEvent[] => [...events],
  }
}

describe("finalizeRun", () => {
  test("ignores failed report completions", () => {
    const events = [
      makeEvent({
        type: "tool.completed",
        seq: 1,
        payload: { tool: "argus_generate_report", success: false, findingsCount: 0 },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 2,
        payload: {
          tool: "argus_themis_disposition",
          success: true,
          themisDisposition: { status: "approved" },
        },
      }),
    ]

    expect(hasResolvedThemisDispositionAfterReport(events)).toBe(false)
  })

  test("requires disposition after latest report generation", () => {
    const events = [
      makeEvent({ type: "session.created", seq: 1 }),
      makeEvent({
        type: "tool.completed",
        seq: 2,
        tool_call_id: "report-tool-1",
        payload: { tool: "argus_generate_report", success: true, findingsCount: 0 },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 3,
        tool_call_id: "themis-disposition-1",
        payload: {
          tool: "argus_themis_disposition",
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
        },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 4,
        tool_call_id: "report-tool-2",
        payload: { tool: "argus_generate_report", success: true, findingsCount: 0 },
      }),
    ]

    expect(hasResolvedThemisDispositionAfterReport(events)).toBe(false)
  })

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

  test("allows a child session re-dispatched with multiple correlation_ids (session continuation)", async () => {
    const sink = makeInMemorySink([
      makeEvent({ type: "session.created", seq: 1, session_id: "ses-child" }),
      makeEvent({
        type: "tool.started",
        seq: 2,
        session_id: "ses-parent",
        tool_call_id: "task-1",
        payload: { tool: "task", correlation_id: "corr-1", child_session_id: "ses-child" },
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
        session_id: "ses-parent",
        tool_call_id: "task-2",
        payload: { tool: "task", correlation_id: "corr-2", child_session_id: "ses-child" },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 5,
        session_id: "ses-parent",
        tool_call_id: "task-2",
        payload: {
          tool: "task",
          findingsCount: 0,
          success: true,
          correlation_id: "corr-2",
          child_session_id: "ses-child",
        },
      }),
    ])

    const result = await finalizeRun(RUN_ID, process.cwd(), sink)

    expect(result.invariantsPassed).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  test("still fails when a child session is mapped to multiple parents", async () => {
    const sink = makeInMemorySink([
      makeEvent({ type: "session.created", seq: 1, session_id: "ses-child" }),
      makeEvent({
        type: "tool.started",
        seq: 2,
        session_id: "ses-parent-a",
        tool_call_id: "task-1",
        payload: { tool: "task", correlation_id: "corr-1", child_session_id: "ses-child" },
      }),
      makeEvent({
        type: "tool.started",
        seq: 3,
        session_id: "ses-parent-b",
        tool_call_id: "task-2",
        payload: { tool: "task", correlation_id: "corr-2", child_session_id: "ses-child" },
      }),
    ])

    const result = await finalizeRun(RUN_ID, process.cwd(), sink)

    expect(result.invariantsPassed).toBe(false)
    expect(result.errors.some((e) => e.includes("multiple parents"))).toBe(true)
  })

  test("warns instead of failing when a child writer lacks a recorded task edge", async () => {
    const sink = makeInMemorySink([
      makeEvent({ type: "session.created", seq: 1, session_id: "ses-parent" }),
      makeEvent({
        type: "tool.started",
        seq: 2,
        session_id: "ses-child",
        tool_call_id: "tool-1",
        payload: { tool: "argus_generate_report" },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 3,
        session_id: "ses-child",
        tool_call_id: "tool-1",
        payload: {
          tool: "argus_generate_report",
          findingsCount: 0,
          success: true,
        },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 4,
        session_id: "ses-child",
        tool_call_id: "themis-disposition-1",
        payload: {
          tool: "argus_themis_disposition",
          findingsCount: 0,
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
        },
      }),
    ])

    const result = await finalizeRun(RUN_ID, process.cwd(), sink)

    expect(result.invariantsPassed).toBe(true)
    expect(result.errors).toEqual([])
    expect(
      result.warnings.some((warning) =>
        warning.includes(
          "unexpected session writers detected (not in parent-child graph): ses-child",
        ),
      ),
    ).toBe(true)
    const latest = sink.getEvents().at(-1)
    expect((latest?.payload as { status?: string } | undefined)?.status).toBe("finalized")
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

  test("strict-fail completenessPolicy fails invariants on a report completeness warning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "argus-finalizer-warning-strict-"))
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

      const result = await finalizeRun(RUN_ID, dir, sink, { completenessPolicy: "strict-fail" })

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

  test("warn completenessPolicy (default) keeps a report completeness warning informational", async () => {
    const dir = mkdtempSync(join(tmpdir(), "argus-finalizer-warning-warn-"))
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

      expect(result.errors).not.toContain("generated report contains Completeness Warning")
      expect(result.warnings).toContain("generated report contains Completeness Warning")
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

  test("uses only the latest successful report quality gates", async () => {
    const sink = makeInMemorySink([
      makeEvent({ type: "session.created", seq: 1 }),
      makeEvent({
        type: "tool.completed",
        seq: 2,
        payload: {
          tool: "argus_generate_report",
          success: true,
          qualityGates: { passed: false, violations: ["old failure"] },
        },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 3,
        payload: {
          tool: "argus_generate_report",
          success: true,
          qualityGates: { passed: true, violations: [] },
        },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 4,
        payload: {
          tool: "argus_themis_disposition",
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
        },
      }),
    ])

    const result = await finalizeRun(RUN_ID, process.cwd(), sink)

    expect(result.errors).not.toContain("generated report failed quality gates: old failure")
    expect(result.invariantsPassed).toBe(true)
  })

  test("surfaces object-shaped quality-gate violation details (adj_6)", async () => {
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
            violations: [
              {
                findingId: "reentrancy-drain",
                code: "MISSING_IMPACT",
                message: "High finding lacks impact",
              },
            ],
          },
        },
      }),
    ])

    const result = await finalizeRun(RUN_ID, process.cwd(), sink)

    expect(result.invariantsPassed).toBe(false)
    expect(
      result.errors.some(
        (e) => e.includes("MISSING_IMPACT") && e.includes("High finding lacks impact"),
      ),
    ).toBe(true)
  })

  test("reports an unresolved Themis rejection via the disposition verdict (adj_7)", async () => {
    const sink = makeInMemorySink([
      makeEvent({ type: "session.created", seq: 1 }),
      makeEvent({
        type: "tool.completed",
        seq: 2,
        tool_call_id: "report-tool-1",
        payload: { tool: "argus_generate_report", success: true, findingsCount: 0 },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 3,
        tool_call_id: "themis-disposition-1",
        payload: {
          tool: "argus_themis_disposition",
          success: true,
          themisDisposition: {
            status: "rejected",
            verdict: {
              approved: false,
              pipeline_issues: ["missing PoC"],
              false_positives: [],
              missed_findings: [],
              severity_adjustments: [],
            },
          },
        },
      }),
    ])

    const result = await finalizeRun(RUN_ID, process.cwd(), sink)

    expect(result.invariantsPassed).toBe(false)
    expect(result.errors).toContain("generated report has unresolved Themis issues")
  })

  test("fails invariants when report generation is not followed by resolved themis disposition", async () => {
    const sink = makeInMemorySink([
      makeEvent({ type: "session.created", seq: 1 }),
      makeEvent({
        type: "tool.completed",
        seq: 2,
        tool_call_id: "report-tool-1",
        payload: { tool: "argus_generate_report", success: true, findingsCount: 0 },
      }),
    ])

    const result = await finalizeRun(RUN_ID, process.cwd(), sink)

    expect(result.invariantsPassed).toBe(false)
    expect(result.errors).toContain("generated report has no resolved Themis disposition")
  })

  test("passes invariants when report generation is followed by approved themis disposition", async () => {
    const sink = makeInMemorySink([
      makeEvent({ type: "session.created", seq: 1 }),
      makeEvent({
        type: "tool.completed",
        seq: 2,
        tool_call_id: "report-tool-1",
        payload: { tool: "argus_generate_report", success: true, findingsCount: 0 },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 3,
        tool_call_id: "themis-task-1",
        payload: {
          tool: "task",
          success: true,
          subagent_type: "themis",
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
        },
      }),
    ])

    const result = await finalizeRun(RUN_ID, process.cwd(), sink)

    expect(result.invariantsPassed).toBe(true)
  })

  test("fails invariants when Argus records only a remediated Themis disposition", async () => {
    const sink = makeInMemorySink([
      makeEvent({ type: "session.created", seq: 1 }),
      makeEvent({
        type: "tool.completed",
        seq: 2,
        tool_call_id: "report-tool-1",
        payload: { tool: "argus_generate_report", success: true, findingsCount: 0 },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 3,
        tool_call_id: "themis-disposition-1",
        payload: {
          tool: "argus_themis_disposition",
          success: true,
          themisDisposition: {
            status: "remediated",
            verdict: {
              approved: false,
              pipeline_issues: ["report mismatch"],
              false_positives: [],
              missed_findings: [],
              severity_adjustments: [],
            },
            notes: "Scribe regenerated the report after correcting the cited mismatch.",
          },
        },
      }),
    ])

    const result = await finalizeRun(RUN_ID, process.cwd(), sink)

    expect(result.invariantsPassed).toBe(false)
    expect(result.errors).toContain(
      "remediated Themis disposition requires fresh approved Themis validation",
    )
  })

  test("fails invariants when remediation is not followed by a fresh approved Themis disposition", async () => {
    const sink = makeInMemorySink([
      makeEvent({ type: "session.created", seq: 1 }),
      makeEvent({
        type: "tool.completed",
        seq: 2,
        tool_call_id: "report-tool-1",
        payload: { tool: "argus_generate_report", success: true, findingsCount: 0 },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 3,
        tool_call_id: "themis-disposition-1",
        payload: {
          tool: "argus_themis_disposition",
          success: true,
          themisDisposition: {
            status: "remediated",
            verdict: {
              approved: false,
              pipeline_issues: ["report mismatch"],
              false_positives: [],
              missed_findings: [],
              severity_adjustments: [],
            },
            notes: "Scribe regenerated the report after correcting the cited mismatch.",
          },
        },
      }),
    ])

    const result = await finalizeRun(RUN_ID, process.cwd(), sink)

    expect(result.invariantsPassed).toBe(false)
    expect(result.errors).toContain(
      "remediated Themis disposition requires fresh approved Themis validation",
    )
  })

  test("passes invariants when remediation is followed by a fresh approved Themis disposition", async () => {
    const sink = makeInMemorySink([
      makeEvent({ type: "session.created", seq: 1 }),
      makeEvent({
        type: "tool.completed",
        seq: 2,
        tool_call_id: "report-tool-1",
        payload: { tool: "argus_generate_report", success: true, findingsCount: 0 },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 3,
        tool_call_id: "themis-disposition-1",
        payload: {
          tool: "argus_themis_disposition",
          success: true,
          themisDisposition: {
            status: "remediated",
            verdict: { approved: false },
            notes: "Scribe regenerated the report after correcting the cited mismatch.",
          },
        },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 4,
        tool_call_id: "themis-disposition-2",
        payload: {
          tool: "argus_themis_disposition",
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
        },
      }),
    ])

    const result = await finalizeRun(RUN_ID, process.cwd(), sink)

    expect(result.invariantsPassed).toBe(true)
  })

  test("passes invariants when Argus records an explicit Themis override", async () => {
    const sink = makeInMemorySink([
      makeEvent({ type: "session.created", seq: 1 }),
      makeEvent({
        type: "tool.completed",
        seq: 2,
        tool_call_id: "report-tool-1",
        payload: { tool: "argus_generate_report", success: true, findingsCount: 0 },
      }),
      makeEvent({
        type: "tool.completed",
        seq: 3,
        tool_call_id: "themis-disposition-1",
        payload: {
          tool: "argus_themis_disposition",
          success: true,
          themisDisposition: {
            status: "overridden",
            verdict: {
              approved: false,
              pipeline_issues: ["severity disagreement"],
              false_positives: [],
              missed_findings: [],
              severity_adjustments: [],
            },
            justification:
              "Argus reviewed the cited evidence and determined the reported issue is an accepted documented trade-off.",
          },
        },
      }),
    ])

    const result = await finalizeRun(RUN_ID, process.cwd(), sink)

    expect(result.invariantsPassed).toBe(true)
  })

  test("failed finalization emits run.finalization_failed and does not seal the sink (WS-3 I3/#18)", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "argus-finalizer-fail-"))
    try {
      const sink = makeInMemorySink([makeEvent({ type: "finding.added", seq: 1 })])
      const result = await finalizeRun(RUN_ID, projectDir, sink)

      expect(result.success).toBe(false)
      expect(sink.isFinalized).toBe(false)
      const events = sink.getEvents()
      expect(events.at(-1)?.type).toBe("run.finalization_failed")
      expect(events.filter((event) => event.type === "run.finalized")).toHaveLength(0)
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })
})
