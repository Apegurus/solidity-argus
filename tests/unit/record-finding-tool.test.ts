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

  test("rejects confidence_score out of range", async () => {
    const response = await recordFinding(baseFinding({ confidence_score: 101 }))

    expect(response.success).toBe(false)
    expect(String(response.error)).toContain("confidence_score")
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
})
