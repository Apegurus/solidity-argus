import { describe, expect, test } from "bun:test"
import type { AuditEvent, AuditEventType } from "../state/schemas"
import { SCHEMA_VERSION } from "../state/schemas"
import { checkReportPreflight } from "./report-preflight"

function buildEvent(
  type: AuditEventType,
  seq: number,
  overrides: Partial<AuditEvent> = {},
): AuditEvent {
  return {
    type,
    run_id: "run-1",
    seq,
    session_id: "session-1",
    source: "test",
    schema_version: SCHEMA_VERSION,
    timestamp: Date.now(),
    payload: {},
    ...overrides,
  }
}

describe("checkReportPreflight", () => {
  test("passes with complete tool lifecycle", () => {
    const events: AuditEvent[] = [
      buildEvent("session.created", 1),
      buildEvent("tool.started", 2, { tool_call_id: "t1" }),
      buildEvent("tool.completed", 3, { tool_call_id: "t1" }),
      buildEvent("session.deleted", 4),
    ]

    const result = checkReportPreflight(events)

    expect(result.passed).toBe(true)
    expect(result.orphanedTools.length).toBe(0)
  })

  test("fails with orphaned tool.started", () => {
    const events: AuditEvent[] = [
      buildEvent("session.created", 1),
      buildEvent("tool.started", 2, { tool_call_id: "t2" }),
      buildEvent("session.deleted", 3),
    ]

    const result = checkReportPreflight(events)

    expect(result.passed).toBe(false)
    expect(result.orphanedTools.includes("t2")).toBe(true)
  })

  test("fails when session.created is missing", () => {
    const events: AuditEvent[] = [
      buildEvent("tool.started", 1, { tool_call_id: "t3" }),
      buildEvent("tool.completed", 2, { tool_call_id: "t3" }),
      buildEvent("session.deleted", 3),
    ]

    const result = checkReportPreflight(events)

    expect(result.passed).toBe(false)
    expect(result.missingLifecycle.includes("session.created")).toBe(true)
  })

  test("fails when required tool was not executed", () => {
    const events: AuditEvent[] = [
      buildEvent("session.created", 1),
      buildEvent("tool.started", 2, { tool_call_id: "t4" }),
      buildEvent("tool.completed", 3, {
        tool_call_id: "t4",
        payload: { tool: "argus_forge_test" },
      }),
      buildEvent("session.deleted", 4),
    ]

    const result = checkReportPreflight(events, {
      requiredTools: ["argus_slither_analyze"],
    })

    expect(result.passed).toBe(false)
    expect(result.missingRequiredTools.includes("argus_slither_analyze")).toBe(true)
  })

  test("passes when required tool was executed", () => {
    const events: AuditEvent[] = [
      buildEvent("session.created", 1),
      buildEvent("tool.started", 2, { tool_call_id: "t5" }),
      buildEvent("tool.completed", 3, {
        tool_call_id: "t5",
        payload: { name: "argus_slither_analyze" },
      }),
      buildEvent("session.deleted", 4),
    ]

    const result = checkReportPreflight(events, {
      requiredTools: ["argus_slither_analyze"],
    })

    expect(result.passed).toBe(true)
    expect(result.missingRequiredTools.length).toBe(0)
  })
})
