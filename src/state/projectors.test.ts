import { describe, expect, test } from "bun:test"
import { projectToolExecutions } from "./projectors"
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
})
