import { describe, expect, it } from "bun:test"
import type { EventSink } from "../../src/features/persistent-state/event-sink"
import { createAgentTracker } from "../../src/hooks/agent-tracker"
import { createToolTrackingHook } from "../../src/hooks/tool-tracking-hook"
import { projectFindings, projectToolExecutions } from "../../src/state/projectors"
import type { AuditEvent } from "../../src/state/schemas"
import { SCHEMA_VERSION } from "../../src/state/schemas"
import type { AuditState } from "../../src/state/types"

function createMockEventSink(): { sink: EventSink; events: AuditEvent[] } {
  const events: AuditEvent[] = []
  let seq = 0

  const sink: EventSink = {
    async append(event: AuditEvent): Promise<void> {
      seq++
      events.push({ ...event, seq })
    },
    async readAll(): Promise<AuditEvent[]> {
      return [...events]
    },
  }

  return { sink, events }
}

function createMockAuditState(overrides: Partial<AuditState> = {}): AuditState {
  return {
    sessionId: "run-123",
    projectDir: "/tmp/test-project",
    contractsReviewed: [],
    findings: [],
    toolsExecuted: [],
    currentPhase: "scanning",
    scope: [],
    startTime: Date.now(),
    ...overrides,
  }
}

function getEvent(events: AuditEvent[], index: number): AuditEvent {
  const event = events[index]
  if (!event) throw new Error(`No event at index ${index}`)
  return event
}

function getPayload(events: AuditEvent[], index: number): Record<string, unknown> {
  return getEvent(events, index).payload as Record<string, unknown>
}

function getToolExec(state: AuditState, index: number) {
  const exec = state.toolsExecuted[index]
  if (!exec) throw new Error(`No tool execution at index ${index}`)
  return exec
}

function getFinding(findings: { check: string; file: string }[], index: number) {
  const f = findings[index]
  if (!f) throw new Error(`No finding at index ${index}`)
  return f
}

describe("Subagent telemetry capture", () => {
  describe("parent task tool handling", () => {
    it("emits tool.started and tool.completed events for task tool", async () => {
      const { sink, events } = createMockEventSink()
      const state = createMockAuditState()

      const hook = createToolTrackingHook(() => state, undefined, {
        getEventSink: () => sink,
        getSessionId: () => "parent-session-1",
      })

      await hook({
        tool: "task",
        args: { prompt: "Run slither analysis", agent: "sentinel" },
        result: JSON.stringify({ session_id: "child-session-42", output: "Analysis complete" }),
      })

      expect(events.length).toBe(2)
      expect(getEvent(events, 0).type).toBe("tool.started")
      expect(getEvent(events, 1).type).toBe("tool.completed")

      const startPayload = getPayload(events, 0)
      expect(startPayload.tool).toBe("task")
      expect(startPayload.child_session_id).toBe("child-session-42")
      expect(typeof startPayload.correlation_id).toBe("string")

      const endPayload = getPayload(events, 1)
      expect(endPayload.tool).toBe("task")
      expect(endPayload.child_session_id).toBe("child-session-42")
      expect(endPayload.correlation_id).toBe(startPayload.correlation_id)
    })

    it("handles task result without session_id gracefully", async () => {
      const { sink, events } = createMockEventSink()
      const state = createMockAuditState()

      const hook = createToolTrackingHook(() => state, undefined, {
        getEventSink: () => sink,
        getSessionId: () => "parent-session-1",
      })

      await hook({
        tool: "task",
        args: { prompt: "Run analysis" },
        result: "Some plain text output without JSON",
      })

      expect(events.length).toBe(2)
      expect(getPayload(events, 0).child_session_id).toBeNull()
    })

    it("records task tool execution in audit state", async () => {
      const state = createMockAuditState()
      const hook = createToolTrackingHook(() => state)

      await hook({
        tool: "task",
        args: { prompt: "Dispatch sentinel" },
        result: JSON.stringify({ session_id: "child-1" }),
      })

      expect(state.toolsExecuted.length).toBe(1)
      expect(getToolExec(state, 0).tool).toBe("task")
      expect(getToolExec(state, 0).success).toBe(true)
      expect(getToolExec(state, 0).findingsCount).toBe(0)
    })

    it("calls onChildSessionDetected when session_id is found", async () => {
      const detected: Array<{ parent: string; child: string }> = []
      const state = createMockAuditState()

      const hook = createToolTrackingHook(() => state, undefined, {
        getSessionId: () => "parent-session-1",
        onChildSessionDetected: (parent: string, child: string) => {
          detected.push({ parent, child })
        },
      })

      await hook({
        tool: "task",
        args: {},
        result: JSON.stringify({ session_id: "child-session-99" }),
      })

      expect(detected).toEqual([{ parent: "parent-session-1", child: "child-session-99" }])
    })

    it("does not call onChildSessionDetected when session_id is missing", async () => {
      const detected: Array<{ parent: string; child: string }> = []
      const state = createMockAuditState()

      const hook = createToolTrackingHook(() => state, undefined, {
        getSessionId: () => "parent-session-1",
        onChildSessionDetected: (parent: string, child: string) => {
          detected.push({ parent, child })
        },
      })

      await hook({
        tool: "task",
        args: {},
        result: "not json",
      })

      expect(detected).toEqual([])
    })

    it("fires onStateChanged callback for task tool", async () => {
      const stateChanges: Array<{ tool: string; findingsCount: number }> = []
      const state = createMockAuditState()

      const hook = createToolTrackingHook(
        () => state,
        (meta) => stateChanges.push(meta),
      )

      await hook({
        tool: "task",
        args: {},
        result: JSON.stringify({ session_id: "child-1" }),
      })

      expect(stateChanges).toEqual([{ tool: "task", findingsCount: 0 }])
    })
  })

  describe("child session argus tool handling", () => {
    it("emits events for argus_slither_analyze in child session", async () => {
      const { sink, events } = createMockEventSink()
      const state = createMockAuditState()

      const hook = createToolTrackingHook(() => state, undefined, {
        getEventSink: () => sink,
        getSessionId: () => "child-session-42",
      })

      await hook({
        tool: "argus_slither_analyze",
        args: { target: "src/Vault.sol" },
        result: JSON.stringify({
          findings: [
            {
              check: "reentrancy-eth",
              severity: "High",
              confidence: "Medium",
              description: "Reentrancy in Vault.withdraw()",
              file: "src/Vault.sol",
              lines: [42, 55],
            },
          ],
        }),
      })

      expect(events.length).toBe(3)
      expect(getEvent(events, 0).type).toBe("tool.started")
      expect(getEvent(events, 1).type).toBe("finding.added")
      expect(getEvent(events, 2).type).toBe("tool.completed")

      expect(getEvent(events, 0).session_id).toBe("child-session-42")
      expect(getEvent(events, 1).session_id).toBe("child-session-42")
      expect(getEvent(events, 2).session_id).toBe("child-session-42")
    })
  })

  describe("correlated parent and child events", () => {
    it("produces correlated canonical events from parent task and child tool execution", async () => {
      const { sink: parentSink, events: parentEvents } = createMockEventSink()
      const parentState = createMockAuditState({ sessionId: "run-parent" })

      const parentHook = createToolTrackingHook(() => parentState, undefined, {
        getEventSink: () => parentSink,
        getSessionId: () => "parent-session-1",
      })

      await parentHook({
        tool: "task",
        args: { prompt: "Run sentinel analysis", agent: "sentinel" },
        result: JSON.stringify({ session_id: "child-session-42", output: "Done" }),
      })

      const { sink: childSink, events: childEvents } = createMockEventSink()
      const childState = createMockAuditState({ sessionId: "run-parent" })

      const childHook = createToolTrackingHook(() => childState, undefined, {
        getEventSink: () => childSink,
        getSessionId: () => "child-session-42",
      })

      await childHook({
        tool: "argus_slither_analyze",
        args: { target: "src/Vault.sol" },
        result: JSON.stringify({
          findings: [
            {
              check: "reentrancy-eth",
              severity: "High",
              confidence: "Medium",
              description: "Reentrancy in Vault.withdraw()",
              file: "src/Vault.sol",
              lines: [42, 55],
            },
          ],
        }),
      })

      expect(parentEvents.length).toBe(2)
      expect(getEvent(parentEvents, 0).type).toBe("tool.started")
      expect(getEvent(parentEvents, 1).type).toBe("tool.completed")

      expect(childEvents.length).toBe(3)
      expect(getEvent(childEvents, 0).type).toBe("tool.started")
      expect(getEvent(childEvents, 1).type).toBe("finding.added")
      expect(getEvent(childEvents, 2).type).toBe("tool.completed")

      expect(getPayload(parentEvents, 1).child_session_id).toBe("child-session-42")
      expect(getPayload(parentEvents, 0).child_session_id).toBe("child-session-42")

      expect(getEvent(childEvents, 0).session_id).toBe("child-session-42")
      expect(getEvent(childEvents, 1).session_id).toBe("child-session-42")
      expect(getEvent(childEvents, 2).session_id).toBe("child-session-42")
    })

    it("child findings appear in projected findings when events are merged", () => {
      const allEvents: AuditEvent[] = [
        {
          type: "tool.started",
          run_id: "run-1",
          seq: 1,
          session_id: "parent-session",
          tool_call_id: "tc-parent-1",
          source: "tool-tracking-hook",
          schema_version: SCHEMA_VERSION,
          timestamp: 1000,
          payload: {
            tool: "task",
            args: { prompt: "Run sentinel" },
            correlation_id: "corr-1",
            child_session_id: "child-session-42",
          },
        },
        {
          type: "tool.completed",
          run_id: "run-1",
          seq: 2,
          session_id: "parent-session",
          tool_call_id: "tc-parent-1",
          source: "tool-tracking-hook",
          schema_version: SCHEMA_VERSION,
          timestamp: 1001,
          payload: {
            tool: "task",
            findingsCount: 0,
            success: true,
            correlation_id: "corr-1",
            child_session_id: "child-session-42",
          },
        },
        {
          type: "tool.started",
          run_id: "run-1",
          seq: 3,
          session_id: "child-session-42",
          tool_call_id: "tc-child-1",
          source: "tool-tracking-hook",
          schema_version: SCHEMA_VERSION,
          timestamp: 1002,
          payload: {
            tool: "argus_slither_analyze",
            args: { target: "src/Vault.sol" },
          },
        },
        {
          type: "finding.added",
          run_id: "run-1",
          seq: 4,
          session_id: "child-session-42",
          tool_call_id: "tc-child-1",
          source: "tool-tracking-hook",
          schema_version: SCHEMA_VERSION,
          timestamp: 1003,
          payload: {
            id: "reentrancy-eth:src/Vault.sol:42",
            check: "reentrancy-eth",
            severity: "High",
            confidence: "Medium",
            description: "Reentrancy in Vault.withdraw()",
            file: "src/Vault.sol",
            lines: [42, 55],
            source: "slither",
            run_id: "run-1",
            seq: 4,
            schema_version: SCHEMA_VERSION,
            observation_id: "obs-reentrancy-1",
            issue_fingerprint: "issue-reentrancy-1",
            observation_fingerprint: "observation-reentrancy-1",
            reported_by_agent: "sentinel",
          },
        },
        {
          type: "tool.completed",
          run_id: "run-1",
          seq: 5,
          session_id: "child-session-42",
          tool_call_id: "tc-child-1",
          source: "tool-tracking-hook",
          schema_version: SCHEMA_VERSION,
          timestamp: 1004,
          payload: {
            tool: "argus_slither_analyze",
            findingsCount: 1,
            success: true,
          },
        },
      ]

      const findings = projectFindings(allEvents)
      expect(findings.length).toBe(1)
      expect(getFinding(findings, 0).check).toBe("reentrancy-eth")
      expect(getFinding(findings, 0).file).toBe("src/Vault.sol")

      const tools = projectToolExecutions(allEvents)
      expect(tools.length).toBe(2)
      const toolNames = tools.map((t) => t.tool)
      expect(toolNames).toContain("task")
      expect(toolNames).toContain("argus_slither_analyze")
    })
  })

  describe("missing child completion scenario", () => {
    it("handles task that starts but child never completes", async () => {
      const { sink, events } = createMockEventSink()
      const state = createMockAuditState()

      const hook = createToolTrackingHook(() => state, undefined, {
        getEventSink: () => sink,
        getSessionId: () => "parent-session-1",
      })

      await hook({
        tool: "task",
        args: { prompt: "Run sentinel" },
        result: JSON.stringify({ error: "Session timed out" }),
      })

      expect(events.length).toBe(2)
      expect(getEvent(events, 0).type).toBe("tool.started")
      expect(getEvent(events, 1).type).toBe("tool.completed")
      expect(getPayload(events, 0).child_session_id).toBeNull()

      expect(state.toolsExecuted.length).toBe(1)
      expect(getToolExec(state, 0).tool).toBe("task")
    })

    it("projected tool executions show incomplete task without child events", () => {
      const events: AuditEvent[] = [
        {
          type: "tool.started",
          run_id: "run-1",
          seq: 1,
          session_id: "parent-session",
          tool_call_id: "tc-orphan-1",
          source: "tool-tracking-hook",
          schema_version: SCHEMA_VERSION,
          timestamp: 1000,
          payload: {
            tool: "task",
            args: { prompt: "Run sentinel" },
            correlation_id: "corr-orphan",
            child_session_id: null,
          },
        },
        {
          type: "tool.completed",
          run_id: "run-1",
          seq: 2,
          session_id: "parent-session",
          tool_call_id: "tc-orphan-1",
          source: "tool-tracking-hook",
          schema_version: SCHEMA_VERSION,
          timestamp: 1001,
          payload: {
            tool: "task",
            findingsCount: 0,
            success: true,
            correlation_id: "corr-orphan",
            child_session_id: null,
          },
        },
      ]

      const tools = projectToolExecutions(events)
      expect(tools.length).toBe(1)
      const orphanTool = tools[0]
      if (!orphanTool) throw new Error("Expected tool at index 0")
      expect(orphanTool.tool).toBe("task")
      expect(orphanTool.findingsCount).toBe(0)

      const findings = projectFindings(events)
      expect(findings.length).toBe(0)
    })
  })

  describe("agent tracker child session tracking", () => {
    it("tracks parent to child session relationships", () => {
      const tracker = createAgentTracker()

      tracker.trackChildSession("parent-session-1", "child-session-42")
      tracker.trackChildSession("parent-session-1", "child-session-43")

      const children = tracker.getChildSessions("parent-session-1")
      expect(children).toContain("child-session-42")
      expect(children).toContain("child-session-43")
      expect(children.length).toBe(2)
    })

    it("returns empty array for unknown parent", () => {
      const tracker = createAgentTracker()
      expect(tracker.getChildSessions("unknown")).toEqual([])
    })

    it("deduplicates child sessions", () => {
      const tracker = createAgentTracker()

      tracker.trackChildSession("parent-1", "child-1")
      tracker.trackChildSession("parent-1", "child-1")

      expect(tracker.getChildSessions("parent-1")).toEqual(["child-1"])
    })

    it("tracks multiple parents independently", () => {
      const tracker = createAgentTracker()

      tracker.trackChildSession("parent-1", "child-a")
      tracker.trackChildSession("parent-2", "child-b")

      expect(tracker.getChildSessions("parent-1")).toEqual(["child-a"])
      expect(tracker.getChildSessions("parent-2")).toEqual(["child-b"])
    })
  })

  describe("task result parsing edge cases", () => {
    it("extracts session_id from nested result object", async () => {
      const { sink, events } = createMockEventSink()
      const state = createMockAuditState()

      const hook = createToolTrackingHook(() => state, undefined, {
        getEventSink: () => sink,
        getSessionId: () => "parent-1",
      })

      await hook({
        tool: "task",
        args: {},
        result: JSON.stringify({
          result: { session_id: "nested-child-99", data: {} },
        }),
      })

      expect(getPayload(events, 0).child_session_id).toBe("nested-child-99")
    })

    it("handles empty string session_id", async () => {
      const { sink, events } = createMockEventSink()
      const state = createMockAuditState()

      const hook = createToolTrackingHook(() => state, undefined, {
        getEventSink: () => sink,
        getSessionId: () => "parent-1",
      })

      await hook({
        tool: "task",
        args: {},
        result: JSON.stringify({ session_id: "" }),
      })

      expect(getPayload(events, 0).child_session_id).toBeNull()
    })

    it("handles non-string session_id", async () => {
      const { sink, events } = createMockEventSink()
      const state = createMockAuditState()

      const hook = createToolTrackingHook(() => state, undefined, {
        getEventSink: () => sink,
        getSessionId: () => "parent-1",
      })

      await hook({
        tool: "task",
        args: {},
        result: JSON.stringify({ session_id: 12345 }),
      })

      expect(getPayload(events, 0).child_session_id).toBeNull()
    })

    it("extracts session_id via regex fallback from non-JSON text", async () => {
      const { sink, events } = createMockEventSink()
      const state = createMockAuditState()

      const hook = createToolTrackingHook(() => state, undefined, {
        getEventSink: () => sink,
        getSessionId: () => "parent-1",
      })

      await hook({
        tool: "task",
        args: {},
        result: 'Task completed. Result: {"session_id": "regex-found-42"} end',
      })

      expect(getPayload(events, 0).child_session_id).toBe("regex-found-42")
    })

    it("does not throw when audit state is null", async () => {
      const hook = createToolTrackingHook(() => null)

      await hook({
        tool: "task",
        args: {},
        result: JSON.stringify({ session_id: "child-1" }),
      })
    })

    it("does not emit events when audit state is null", async () => {
      const { sink, events } = createMockEventSink()

      const hook = createToolTrackingHook(() => null, undefined, {
        getEventSink: () => sink,
        getSessionId: () => "parent-1",
      })

      await hook({
        tool: "task",
        args: {},
        result: JSON.stringify({ session_id: "child-1" }),
      })

      expect(events.length).toBe(0)
    })
  })

  describe("existing argus_ tool behavior preserved", () => {
    it("non-argus non-task tools are still skipped", async () => {
      const { sink, events } = createMockEventSink()
      const state = createMockAuditState()

      const hook = createToolTrackingHook(() => state, undefined, {
        getEventSink: () => sink,
        getSessionId: () => "session-1",
      })

      await hook({
        tool: "read_file",
        args: { path: "foo.sol" },
        result: "file contents",
      })

      expect(events.length).toBe(0)
      expect(state.toolsExecuted.length).toBe(0)
    })

    it("argus_slither_analyze still works after task handling addition", async () => {
      const { sink, events } = createMockEventSink()
      const state = createMockAuditState()

      const hook = createToolTrackingHook(() => state, undefined, {
        getEventSink: () => sink,
        getSessionId: () => "session-1",
      })

      await hook({
        tool: "argus_slither_analyze",
        args: { target: "." },
        result: JSON.stringify({
          findings: [
            {
              check: "unchecked-return",
              severity: "Medium",
              confidence: "High",
              description: "Unchecked return value",
              file: "src/Token.sol",
              lines: [10, 10],
            },
          ],
        }),
      })

      expect(events.length).toBe(3)
      expect(state.findings.length).toBe(1)
      expect(state.toolsExecuted.length).toBe(1)
      expect(getToolExec(state, 0).tool).toBe("argus_slither_analyze")
    })
  })
})
