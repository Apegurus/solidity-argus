import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import type { EventSink } from "../../src/features/persistent-state/event-sink"
import { createToolTrackingHook } from "../../src/hooks/tool-tracking-hook"
import { normalizeToCanonicalFinding } from "../../src/state/adapters"
import type { AuditEvent } from "../../src/state/schemas"
import type { AuditState } from "../../src/state/types"
import { executeRecordFinding } from "../../src/tools/record-finding-tool"

function createContext(): ToolContext {
  return {
    sessionID: "session-record-finding",
    messageID: "message-record-finding",
    agent: "sentinel",
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    metadata() {
      return
    },
    async ask() {
      return
    },
  }
}

function baseFinding(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    check: "reentrancy",
    description: "test",
    file: "Vault.sol",
    lines: [10, 20],
    severity: "High",
    confidence: "Medium",
    source: "manual",
    impact: "Attacker can reenter withdrawals",
    recommendation: "Use checks-effects-interactions and a reentrancy guard",
    proofOfConcept: "forge test --match-test testReentrancy",
    ...extra,
  }
}

function createAuditState(): AuditState {
  return {
    sessionId: "run-record-finding",
    projectDir: process.cwd(),
    contractsReviewed: [],
    findings: [],
    toolsExecuted: [],
    currentPhase: "manual-review",
    scope: [],
    startTime: Date.now(),
  }
}

function createMemorySink(runId: string): EventSink & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return {
    runId,
    isFinalized: false,
    events,
    async append(event: AuditEvent) {
      events.push(event)
    },
    async readAll() {
      return events
    },
    markFinalized() {
      return
    },
  }
}

async function recordFinding(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return JSON.parse(
    await executeRecordFinding(
      {
        finding: JSON.stringify(input),
      },
      createContext(),
    ),
  ) as Record<string, unknown>
}

describe("argus_record_finding input schema", () => {
  test("accepts optional confidence_score in valid range", async () => {
    const response = await recordFinding(baseFinding({ confidence_score: 85 }))

    expect(response.success).toBe(true)
  })

  test("drops out-of-range confidence_score but records the finding (never-drop)", async () => {
    const response = await recordFinding(baseFinding({ confidence_score: 101 }))

    expect(response.success).toBe(true)
    const findings = response.findings as Array<Record<string, unknown>>
    expect(findings.length).toBe(1)
    expect(findings[0]?.confidence_score).toBeUndefined()
  })

  test("drops floating-point confidence_score but records the finding", async () => {
    const response = await recordFinding(baseFinding({ confidence_score: 50.5 }))

    expect(response.success).toBe(true)
    const findings = response.findings as Array<Record<string, unknown>>
    expect(findings[0]?.confidence_score).toBeUndefined()
  })

  test("drops NaN confidence_score but records the finding", async () => {
    const response = await recordFinding(baseFinding({ confidence_score: Number.NaN }))

    expect(response.success).toBe(true)
    const findings = response.findings as Array<Record<string, unknown>>
    expect(findings[0]?.confidence_score).toBeUndefined()
  })

  test("drops invalid rubric_verdict but records the finding", async () => {
    const response = await recordFinding(
      baseFinding({ rubric_verdict: "BOGUS", confidence_score: 85 }),
    )

    expect(response.success).toBe(true)
    const findings = response.findings as Array<Record<string, unknown>>
    expect(findings[0]?.rubric_verdict).toBeUndefined()
    expect(findings[0]?.confidence_score).toBe(85)
  })

  test("accepts input without confidence_score (backward compat)", async () => {
    const response = await recordFinding(baseFinding())

    expect(response.success).toBe(true)
  })

  test("confidence_score round-trips through executeRecordFinding without field.dropped warning", async () => {
    const input = baseFinding({ confidence_score: 85 })
    const response = await recordFinding(input)

    expect(response.success).toBe(true)
    const findings = response.findings as Array<Record<string, unknown>>
    expect(findings[0]?.confidence_score).toBe(85)

    const normalized = normalizeToCanonicalFinding(input, "tool-local", 1, {
      reportedByAgent: "sentinel",
      reportedBySessionId: "session-record-finding",
      observationId: "session-record-finding:1",
    })
    expect(normalized.data.confidence_score).toBe(85)
    expect(
      normalized.diagnostics.some(
        (diag) =>
          diag.level === "warn" &&
          diag.code === "field.dropped" &&
          diag.field === "confidence_score",
      ),
    ).toBe(false)
  })

  test("tool tracking hook preserves confidence_score before durable sink emission", async () => {
    const state = createAuditState()
    const sink = createMemorySink(state.sessionId)
    const toolResponse = await recordFinding(baseFinding({ confidence_score: 85 }))
    const hook = createToolTrackingHook(() => state, undefined, {
      getEventSink: () => sink,
      getAgentName: () => "sentinel",
      projectDir: process.cwd(),
    })

    await hook({
      tool: "argus_record_finding",
      args: {},
      result: JSON.stringify(toolResponse),
      sessionID: "session-record-finding",
      callID: "call-record-finding",
    })

    expect(state.findings[0]?.confidence_score).toBe(85)
    const findingEvent = sink.events.find((event) => event.type === "finding.added")
    expect((findingEvent?.payload as Record<string, unknown> | undefined)?.confidence_score).toBe(
      85,
    )
  })

  test("tool tracking hook preserves rubric_verdict before durable sink emission", async () => {
    const state = createAuditState()
    const sink = createMemorySink(state.sessionId)
    const toolResponse = await recordFinding(
      baseFinding({ confidence_score: 25, rubric_verdict: "REJECTED_DEMOTED" }),
    )
    const hook = createToolTrackingHook(() => state, undefined, {
      getEventSink: () => sink,
      getAgentName: () => "sentinel",
      projectDir: process.cwd(),
    })

    await hook({
      tool: "argus_record_finding",
      args: {},
      result: JSON.stringify(toolResponse),
      sessionID: "session-record-finding",
      callID: "call-record-finding",
    })

    expect(state.findings[0]?.rubric_verdict).toBe("REJECTED_DEMOTED")
    const findingEvent = sink.events.find((event) => event.type === "finding.added")
    expect((findingEvent?.payload as Record<string, unknown> | undefined)?.rubric_verdict).toBe(
      "REJECTED_DEMOTED",
    )
  })

  test("tool tracking hook scrubs malformed confidence_score injected via raw payload", async () => {
    const state = createAuditState()
    const sink = createMemorySink(state.sessionId)
    const hook = createToolTrackingHook(() => state, undefined, {
      getEventSink: () => sink,
      getAgentName: () => "sentinel",
      projectDir: process.cwd(),
    })

    const malformedResponse = {
      success: true,
      count: 1,
      schema_version: "2.0.0",
      findings: [
        {
          check: "test-check",
          description: "test",
          file: "src/A.sol",
          lines: [1, 2],
          severity: "Low",
          confidence: "Medium",
          source: "manual",
          confidence_score: Number.POSITIVE_INFINITY,
          rubric_verdict: "NOT_A_REAL_VERDICT",
          reported_by_agent: "sentinel",
        },
      ],
    }

    await hook({
      tool: "argus_record_finding",
      args: {},
      result: JSON.stringify(malformedResponse),
      sessionID: "session-record-finding",
      callID: "call-record-finding",
    })

    expect(state.findings[0]?.confidence_score).toBeUndefined()
    expect(state.findings[0]?.rubric_verdict).toBeUndefined()
    const findingEvent = sink.events.find((event) => event.type === "finding.added")
    const payload = findingEvent?.payload as Record<string, unknown> | undefined
    expect(payload?.confidence_score).toBeUndefined()
    expect(payload?.rubric_verdict).toBeUndefined()
  })
})
