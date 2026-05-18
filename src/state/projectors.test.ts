import { describe, expect, test } from "bun:test"
import { projectReportInput, projectToolExecutions } from "./projectors"
import { type AuditEvent, SCHEMA_VERSION } from "./schemas"

function makeEvent(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    type: "tool.started",
    run_id: "run-1",
    seq: 1,
    session_id: "ses-1",
    tool_call_id: "tool-1",
    source: "tool-tracking-hook",
    schema_version: SCHEMA_VERSION,
    timestamp: 1000,
    payload: { tool: "argus_check_patterns" },
    ...overrides,
  }
}

describe("projectToolExecutions", () => {
  test("clamps negative findingsCount from tool.completed to zero", () => {
    const events: AuditEvent[] = [
      makeEvent({ type: "tool.started", seq: 1, timestamp: 1000 }),
      makeEvent({
        type: "tool.completed",
        seq: 2,
        timestamp: 1001,
        payload: { tool: "argus_check_patterns", success: true, findingsCount: -1 },
      }),
    ]

    const executions = projectToolExecutions(events)
    expect(executions).toHaveLength(1)
    expect(executions[0]?.findingsCount).toBe(0)
  })

  test("defaults non-finite findingsCount to zero", () => {
    const events: AuditEvent[] = [
      makeEvent({ type: "tool.started", seq: 1, timestamp: 1000 }),
      makeEvent({
        type: "tool.completed",
        seq: 2,
        timestamp: 1001,
        payload: { tool: "argus_check_patterns", success: true, findingsCount: Number.NaN },
      }),
    ]

    const executions = projectToolExecutions(events)
    expect(executions).toHaveLength(1)
    expect(executions[0]?.findingsCount).toBe(0)
  })

  test("projects additive finding counts from tool.completed payload", () => {
    const events: AuditEvent[] = [
      makeEvent({ type: "tool.started", seq: 1, timestamp: 1000 }),
      makeEvent({
        type: "tool.completed",
        seq: 2,
        timestamp: 1001,
        payload: {
          tool: "argus_check_patterns",
          success: true,
          findingsCount: 2,
          findingCounts: { rawObservations: 4, recordedFindings: 2 },
        },
      }),
    ]

    const executions = projectToolExecutions(events)
    expect(executions[0]?.findingCounts?.rawObservations).toBe(4)
    expect(executions[0]?.findingCounts?.recordedFindings).toBe(2)
  })
})

describe("projectReportInput", () => {
  test("projects latest coverageAttempt and findingCounts from tool payloads", () => {
    const events: AuditEvent[] = [
      makeEvent({ type: "session.created", seq: 1, timestamp: 1000, payload: { scope: [] } }),
      makeEvent({ type: "tool.started", seq: 2, timestamp: 1001, tool_call_id: "tool-coverage" }),
      makeEvent({
        type: "tool.completed",
        seq: 3,
        timestamp: 1002,
        tool_call_id: "tool-coverage",
        payload: {
          tool: "argus_forge_coverage",
          success: true,
          findingsCount: 0,
          coverageAttempt: { status: "run", attemptedAt: 1002 },
          findingCounts: { rawObservations: 0, recordedFindings: 0 },
        },
      }),
    ]

    const reportInput = projectReportInput(events, "run-1", "/tmp/project")

    expect(reportInput.coverageAttempt?.status).toBe("run")
    expect(reportInput.findingCounts?.rawObservations).toBe(0)
    expect(reportInput.findingCounts?.recordedFindings).toBe(0)
  })
})
