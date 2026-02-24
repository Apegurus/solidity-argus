import { describe, expect, it } from "bun:test"
import type { EventSink } from "../features/persistent-state/event-sink"
import { ARGUS_PLUGIN_VERSION } from "../shared/plugin-metadata"
import type { AuditEvent } from "../state/schemas"
import { SCHEMA_VERSION } from "../state/schemas"
import type { EventSubHandler } from "./event-hook"
import { createEventHook } from "./event-hook"

function createMockSink(): EventSink & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  let seq = 0
  return {
    events,
    async append(event: AuditEvent): Promise<void> {
      seq++
      events.push({ ...event, seq })
    },
    async readAll(): Promise<AuditEvent[]> {
      return [...events]
    },
  }
}

function createFailingSink(): EventSink {
  return {
    async append(): Promise<void> {
      throw new Error("Sink write failure")
    },
    async readAll(): Promise<AuditEvent[]> {
      return []
    },
  }
}

describe("createEventHook", () => {
  it("handles session.created", async () => {
    const { hook, getAuditState } = createEventHook("/tmp/test")

    await hook({ event: { type: "session.created" } })

    expect(getAuditState()).not.toBeNull()
    expect(getAuditState()?.currentPhase).toBe("reconnaissance")
  })

  it("handles session.deleted", async () => {
    const { hook, getAuditState, setAuditState } = createEventHook()
    setAuditState({
      sessionId: "s1",
      projectDir: "/tmp",
      contractsReviewed: [],
      findings: [],
      toolsExecuted: [],
      currentPhase: "scanning",
      scope: [],
      startTime: Date.now(),
    })

    await hook({ event: { type: "session.deleted" } })

    expect(getAuditState()).toBeNull()
  })

  it("handles session.idle without error", async () => {
    const { hook, setAuditState } = createEventHook()
    setAuditState({
      sessionId: "s1",
      projectDir: "/tmp",
      contractsReviewed: [],
      findings: [],
      toolsExecuted: [],
      currentPhase: "scanning",
      scope: [],
      startTime: Date.now(),
    })

    await expect(hook({ event: { type: "session.idle" } })).resolves.toBeUndefined()
  })

  it("handles session.error without throwing", async () => {
    const { hook, setAuditState } = createEventHook()
    setAuditState({
      sessionId: "s1",
      projectDir: "/tmp",
      contractsReviewed: ["Vault.sol"],
      findings: [],
      toolsExecuted: [],
      currentPhase: "scanning",
      scope: [],
      startTime: Date.now(),
    })

    await expect(hook({ event: { type: "session.error" } })).resolves.toBeUndefined()
  })

  it("handles unknown events without error", async () => {
    const { hook } = createEventHook()
    await expect(hook({ event: { type: "unknown.event" } })).resolves.toBeUndefined()
  })

  it("calls sub-handlers with event and audit state", async () => {
    const calls: string[] = []
    const subHandler: EventSubHandler = async (event) => {
      calls.push(event.type)
    }

    const { hook } = createEventHook("/tmp", [subHandler])
    await hook({ event: { type: "session.created" } })

    expect(calls).toEqual(["session.created"])
  })

  it("passes pre-delete state to sub-handlers during session.deleted", async () => {
    let observedFindings = -1
    const subHandler: EventSubHandler = async ({ type, auditState }) => {
      if (type === "session.deleted") {
        observedFindings = auditState?.findings.length ?? -1
      }
    }

    const { hook, setAuditState } = createEventHook("/tmp", [subHandler])
    setAuditState({
      sessionId: "run-pre-delete",
      projectDir: "/tmp",
      contractsReviewed: [],
      findings: [
        {
          id: "f-pre-delete",
          check: "reentrancy",
          severity: "High",
          confidence: "High",
          description: "test",
          file: "Vault.sol",
          lines: [1, 2],
          source: "manual",
        },
      ],
      toolsExecuted: [],
      currentPhase: "reporting",
      scope: [],
      startTime: Date.now(),
    })

    await hook({ event: { type: "session.deleted", sessionId: "oc-pre-delete" } })

    expect(observedFindings).toBe(1)
  })

  it("sub-handler errors do not crash the hook", async () => {
    const failHandler: EventSubHandler = async () => {
      throw new Error("handler failed")
    }

    const { hook } = createEventHook("/tmp", [failHandler])
    await expect(hook({ event: { type: "session.created" } })).resolves.toBeUndefined()
  })

  describe("event sink emission", () => {
    it("emits session.created to sink after sub-handlers", async () => {
      const sink = createMockSink()
      const subHandler: EventSubHandler = async ({ setAuditState: setState }) => {
        setState({
          sessionId: "recovered-id",
          projectDir: "/tmp/recovered",
          contractsReviewed: [],
          findings: [],
          toolsExecuted: [],
          currentPhase: "scanning",
          scope: [],
          startTime: Date.now(),
        })
      }

      const { hook, setEventSink } = createEventHook("/tmp", [
        async (ev) => {
          setEventSink(sink)
          await subHandler(ev)
        },
      ])

      await hook({ event: { type: "session.created", sessionId: "oc-session-1" } })

      expect(sink.events).toHaveLength(1)
      expect(sink.events[0]?.type).toBe("session.created")
      expect(sink.events[0]?.session_id).toBe("oc-session-1")
      expect(sink.events[0]?.source).toBe("event-hook")
      const payload = sink.events[0]?.payload as Record<string, unknown>
      expect(payload.projectDir).toBe("/tmp/recovered")
      expect(payload.sessionId).toBe("recovered-id")
      expect(payload.plugin_version).toBe(ARGUS_PLUGIN_VERSION)
    })

    it("emits session.idle to sink with state summary", async () => {
      const sink = createMockSink()
      const { hook, setAuditState, setEventSink } = createEventHook()
      setAuditState({
        sessionId: "run-1",
        projectDir: "/tmp",
        contractsReviewed: [],
        findings: [
          {
            id: "f1",
            check: "reentrancy",
            severity: "High",
            confidence: "High",
            description: "test",
            file: "Vault.sol",
            lines: [1, 10] as [number, number],
            source: "slither",
          },
        ],
        toolsExecuted: [
          { tool: "argus_slither_analyze", startTime: 0, success: true, findingsCount: 1 },
        ],
        currentPhase: "scanning",
        scope: [],
        startTime: Date.now(),
      })
      setEventSink(sink)

      await hook({ event: { type: "session.idle", sessionId: "oc-2" } })

      expect(sink.events).toHaveLength(1)
      expect(sink.events[0]?.type).toBe("session.idle")
      expect(sink.events[0]?.run_id).toBe("run-1")
      const payload = sink.events[0]?.payload as Record<string, unknown>
      expect(payload.findingsCount).toBe(1)
      expect(payload.toolsExecutedCount).toBe(1)
      expect(payload.phase).toBe("scanning")
    })

    it("emits session.deleted to sink using pre-delete state", async () => {
      const sink = createMockSink()
      await sink.append({
        type: "session.created",
        run_id: "run-del",
        seq: 0,
        session_id: "oc-del",
        source: "test",
        schema_version: SCHEMA_VERSION,
        timestamp: Date.now(),
        payload: {},
      })
      const { hook, setAuditState, setEventSink } = createEventHook()
      setAuditState({
        sessionId: "run-del",
        projectDir: "/tmp",
        contractsReviewed: [],
        findings: [],
        toolsExecuted: [],
        currentPhase: "reporting",
        scope: [],
        startTime: Date.now(),
      })
      setEventSink(sink)

      await hook({ event: { type: "session.deleted", sessionId: "oc-del" } })

      expect(sink.events).toHaveLength(3)
      expect(sink.events[1]?.type).toBe("session.deleted")
      expect(sink.events[1]?.run_id).toBe("run-del")
      expect(sink.events[1]?.session_id).toBe("oc-del")
      const payload = sink.events[1]?.payload as Record<string, unknown>
      expect(payload.archived).toBe(true)
      expect(payload.plugin_version).toBe(ARGUS_PLUGIN_VERSION)

      expect(sink.events[2]?.type).toBe("run.finalized")
      const finalizationPayload = sink.events[2]?.payload as Record<string, unknown>
      expect(finalizationPayload.invariantsPassed).toBe(true)
      expect(finalizationPayload.status).toBe("finalized")
      expect(finalizationPayload.plugin_version).toBe(ARGUS_PLUGIN_VERSION)
    })

    it("records finalization failure when a tool.start has no completion", async () => {
      const sink = createMockSink()
      await sink.append({
        type: "session.created",
        run_id: "run-bad",
        seq: 0,
        session_id: "oc-bad",
        source: "test",
        schema_version: SCHEMA_VERSION,
        timestamp: Date.now(),
        payload: {},
      })
      await sink.append({
        type: "tool.started",
        run_id: "run-bad",
        seq: 0,
        session_id: "oc-bad",
        tool_call_id: "tool-1",
        source: "test",
        schema_version: SCHEMA_VERSION,
        timestamp: Date.now(),
        payload: { tool: "task", correlation_id: "corr-1", child_session_id: "child-1" },
      })

      const { hook, setAuditState, setEventSink } = createEventHook()
      setAuditState({
        sessionId: "run-bad",
        projectDir: "/tmp",
        contractsReviewed: [],
        findings: [],
        toolsExecuted: [],
        currentPhase: "reporting",
        scope: [],
        startTime: Date.now(),
      })
      setEventSink(sink)

      await hook({ event: { type: "session.deleted", sessionId: "oc-bad" } })

      const finalEvent = sink.events.at(-1)
      expect(finalEvent?.type).toBe("run.finalized")
      const payload = finalEvent?.payload as Record<string, unknown>
      expect(payload.invariantsPassed).toBe(false)
      expect(payload.status).toBe("failed-finalization")
      expect(payload.plugin_version).toBe(ARGUS_PLUGIN_VERSION)
      expect(Array.isArray(payload.errors)).toBe(true)
      expect(
        (payload.errors as string[]).some((entry) => entry.includes("orphaned tool.started")),
      ).toBe(true)
    })

    it("clears sink reference after session.deleted", async () => {
      const sink = createMockSink()
      const { hook, setAuditState, setEventSink } = createEventHook()
      setAuditState({
        sessionId: "run-x",
        projectDir: "/tmp",
        contractsReviewed: [],
        findings: [],
        toolsExecuted: [],
        currentPhase: "scanning",
        scope: [],
        startTime: Date.now(),
      })
      setEventSink(sink)

      await hook({ event: { type: "session.deleted" } })
      sink.events.length = 0

      setAuditState({
        sessionId: "run-y",
        projectDir: "/tmp",
        contractsReviewed: [],
        findings: [],
        toolsExecuted: [],
        currentPhase: "scanning",
        scope: [],
        startTime: Date.now(),
      })
      await hook({ event: { type: "session.idle" } })

      expect(sink.events).toHaveLength(0)
    })

    it("does not emit when no sink is set", async () => {
      const { hook } = createEventHook("/tmp")
      await hook({ event: { type: "session.created", sessionId: "oc-1" } })
    })

    it("gracefully handles sink failure without crashing", async () => {
      const failingSink = createFailingSink()
      const { hook, setEventSink } = createEventHook("/tmp")
      setEventSink(failingSink)

      await expect(
        hook({ event: { type: "session.created", sessionId: "oc-1" } }),
      ).resolves.toBeUndefined()
    })

    it("does not emit session.idle when no audit state exists", async () => {
      const sink = createMockSink()
      const { hook, setEventSink } = createEventHook()
      setEventSink(sink)

      await hook({ event: { type: "session.idle" } })

      expect(sink.events).toHaveLength(0)
    })

    it("does not emit session.deleted when no pre-delete state exists", async () => {
      const sink = createMockSink()
      const { hook, setEventSink } = createEventHook()
      setEventSink(sink)

      await hook({ event: { type: "session.deleted" } })

      expect(sink.events).toHaveLength(0)
    })
  })
})
