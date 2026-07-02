import { beforeEach, describe, expect, test } from "bun:test"
import type { EventSink } from "../features/persistent-state/event-sink"
import { DropDiagnosticsError } from "../shared/drop-diagnostics"
import { createAuditState } from "../state/audit-state"
import type { AuditEvent } from "../state/schemas"
import type { AuditState } from "../state/types"
import { createToolTrackingHook } from "./tool-tracking-hook"

function createMockSink(runId = "test-run"): EventSink & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  let seq = 0
  const state = { finalized: false }
  const owners = new Set<string>()
  return {
    runId,
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

function createFailingSink(runId = "test-run"): EventSink {
  const state = { finalized: false }
  const owners = new Set<string>()
  return {
    runId,
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
    async append(): Promise<void> {
      throw new Error("Sink write failure")
    },
    async readAll(): Promise<AuditEvent[]> {
      return []
    },
  }
}

describe("createToolTrackingHook", () => {
  let auditState: AuditState
  let hook: (input: { tool: string; args: unknown; result: string }) => Promise<void>

  beforeEach(() => {
    const created = createAuditState("/test/project")
    auditState = created.state
    auditState.sessionId = "test-run"
    hook = createToolTrackingHook(() => auditState)
  })

  test("no-op for non-argus tools", async () => {
    await hook({
      tool: "bash",
      args: {},
      result: JSON.stringify({ output: "hello" }),
    })

    expect(auditState.findings).toHaveLength(0)
    expect(auditState.toolsExecuted).toHaveLength(0)
    expect(auditState.contractsReviewed).toHaveLength(0)
  })

  test("slither findings extracted", async () => {
    const slitherResult = {
      success: true,
      findingsCount: 2,
      findings: [
        {
          id: "abc123",
          check: "reentrancy-eth",
          severity: "High",
          confidence: "High",
          description: "Reentrancy vulnerability in withdraw()",
          file: "src/Vault.sol",
          lines: [10, 20],
          source: "slither",
        },
        {
          id: "def456",
          check: "unchecked-transfer",
          severity: "Medium",
          confidence: "Medium",
          description: "Unchecked return value from transfer()",
          file: "src/Token.sol",
          lines: [30, 35],
          source: "slither",
        },
      ],
      executionTime: 5000,
      errors: [],
    }

    await hook({
      tool: "argus_slither_analyze",
      args: { target: "." },
      result: JSON.stringify(slitherResult),
    })

    expect(auditState.findings).toHaveLength(2)
    expect(auditState.findings.at(0)?.check).toBe("reentrancy-eth")
    expect(auditState.findings.at(0)?.severity).toBe("High")
    expect(auditState.findings.at(0)?.confidence).toBe("High")
    expect(auditState.findings.at(0)?.source).toBe("slither")
    expect(auditState.findings.at(0)?.file).toBe("src/Vault.sol")
    expect(auditState.findings.at(0)?.lines).toEqual([10, 20])
    expect(auditState.findings.at(1)?.check).toBe("unchecked-transfer")
    expect(auditState.findings.at(1)?.severity).toBe("Medium")
  })

  test("pattern checker findings extracted", async () => {
    const patternResult = {
      sources: [
        {
          source: "pattern-db",
          matches: [
            {
              pattern: "reentrancy",
              severity: "High",
              file: "src/Vault.sol",
              lines: [15, 25],
              description: "Potential reentrancy: ETH transfer via low-level call",
            },
          ],
        },
      ],
      patternsChecked: 5,
      executionTime: 100,
    }

    await hook({
      tool: "argus_check_patterns",
      args: { target: "." },
      result: JSON.stringify(patternResult),
    })

    expect(auditState.findings).toHaveLength(1)
    expect(auditState.findings.at(0)?.check).toBe("reentrancy")
    expect(auditState.findings.at(0)?.severity).toBe("High")
    expect(auditState.findings.at(0)?.source).toBe("pattern")
    expect(auditState.findings.at(0)?.confidence).toBe("Medium")
    expect(auditState.findings.at(0)?.file).toBe("src/Vault.sol")
    expect(auditState.findings.at(0)?.lines).toEqual([15, 25])
  })

  test("argus_record_finding records manual findings", async () => {
    const sink = createMockSink()
    const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
      getEventSink: () => sink,
      getSessionId: () => "oc-session-1",
      getAgentName: () => "argus",
    })

    await hookWithSink({
      tool: "argus_record_finding",
      args: {
        findings: JSON.stringify([
          {
            check: "manual-auth-bypass",
            severity: "High",
            confidence: "High",
            description: "Manual finding",
            file: "src/Auth.sol",
            lines: [12, 14],
            source: "manual",
          },
        ]),
      },
      result: JSON.stringify({
        success: true,
        count: 1,
        findings: [
          {
            check: "manual-auth-bypass",
            severity: "High",
            confidence: "High",
            description: "Manual finding",
            file: "src/Auth.sol",
            lines: [12, 14],
            source: "manual",
            reported_by_agent: "argus",
          },
        ],
      }),
    })

    expect(auditState.findings).toHaveLength(1)
    expect(auditState.findings.at(0)?.check).toBe("manual-auth-bypass")
    expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_record_finding")
    expect(sink.events.some((event) => event.type === "finding.added")).toBe(true)
  })

  test("argus_record_finding rejects before mutating when no durable sink exists (WS-3 I6)", async () => {
    const before = auditState.findings.length
    const findingItem = {
      check: "manual-no-sink",
      severity: "High",
      confidence: "High",
      description: "should not be recorded without a durable sink",
      file: "src/Auth.sol",
      lines: [1, 2],
      source: "manual",
      reported_by_agent: "argus",
    }

    await expect(
      hook({
        tool: "argus_record_finding",
        args: { findings: JSON.stringify([findingItem]) },
        result: JSON.stringify({ success: true, count: 1, findings: [findingItem] }),
      }),
    ).rejects.toThrow(/no durable event sink|findings would be lost/i)

    expect(auditState.findings).toHaveLength(before)
  })

  test("argus_generate_report completed event carries report quality-gate + file metadata (WS-3 I9)", async () => {
    const sink = createMockSink()
    const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
      getEventSink: () => sink,
      getSessionId: () => "oc-session-1",
      getAgentName: () => "argus",
    })

    await hookWithSink({
      tool: "argus_generate_report",
      args: {},
      result: JSON.stringify({
        filePath: "/tmp/report.md",
        filename: "report.md",
        qualityGates: { passed: false, violations: ["conservation gate failed"] },
      }),
    })

    const completed = sink.events.find((event) => event.type === "tool.completed")
    const payload = completed?.payload as Record<string, unknown>
    expect(payload?.qualityGates).toEqual({
      passed: false,
      violations: ["conservation gate failed"],
    })
    expect(payload?.filePath).toBe("/tmp/report.md")
  })

  test("argus_record_finding preserves impact/recommendation/proofOfConcept through to event payload (Task 1 / Bug #3)", async () => {
    const sink = createMockSink()
    const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
      getEventSink: () => sink,
      getSessionId: () => "oc-session-impact-test",
      getAgentName: () => "sentinel",
    })

    await hookWithSink({
      tool: "argus_record_finding",
      args: {
        findings: JSON.stringify([
          {
            check: "reentrancy-drain",
            severity: "Critical",
            confidence: "High",
            description: "Vault drain via reentrancy",
            file: "src/Vault.sol",
            lines: [42, 58],
            source: "slither",
            impact: "Complete vault drain via cross-function reentrancy",
            recommendation: "Add OpenZeppelin nonReentrant modifier on withdraw()",
            proofOfConcept: "forge test --match-test testReentrancyDrain -vvvv",
          },
        ]),
      },
      result: JSON.stringify({
        success: true,
        count: 1,
        findings: [
          {
            check: "reentrancy-drain",
            severity: "Critical",
            confidence: "High",
            description: "Vault drain via reentrancy",
            file: "src/Vault.sol",
            lines: [42, 58],
            source: "slither",
            reported_by_agent: "sentinel",
            impact: "Complete vault drain via cross-function reentrancy",
            recommendation: "Add OpenZeppelin nonReentrant modifier on withdraw()",
            proofOfConcept: "forge test --match-test testReentrancyDrain -vvvv",
          },
        ],
      }),
    })

    expect(auditState.findings).toHaveLength(1)
    const stored = auditState.findings.at(0)
    expect(stored?.impact).toBe("Complete vault drain via cross-function reentrancy")
    expect(stored?.recommendation).toBe("Add OpenZeppelin nonReentrant modifier on withdraw()")
    expect(stored?.proofOfConcept).toBe("forge test --match-test testReentrancyDrain -vvvv")

    const findingEvent = sink.events.find((e) => e.type === "finding.added")
    expect(findingEvent).toBeDefined()
    const payload = findingEvent?.payload as Record<string, unknown> | undefined
    expect(payload?.impact).toBe("Complete vault drain via cross-function reentrancy")
    expect(payload?.recommendation).toBe("Add OpenZeppelin nonReentrant modifier on withdraw()")
    expect(payload?.proofOfConcept).toBe("forge test --match-test testReentrancyDrain -vvvv")
  })

  test("argus_record_finding warns but records when finding is outside declared scope", async () => {
    auditState.scope = ["src/Vault.sol"]
    const sink = createMockSink()
    const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
      getEventSink: () => sink,
      getSessionId: () => "oc-session-scope-warning",
      getAgentName: () => "sentinel",
    })

    await hookWithSink({
      tool: "argus_record_finding",
      args: {},
      result: JSON.stringify({
        success: true,
        count: 1,
        findings: [
          {
            check: "outside-scope-note",
            severity: "Low",
            confidence: "High",
            description: "Finding was collected outside requested scope",
            file: "src/Token.sol",
            lines: [1, 2],
            source: "manual",
          },
        ],
      }),
    })

    expect(auditState.findings).toHaveLength(1)
    expect(auditState.findings[0]?.file).toBe("src/Token.sol")
    expect(hookWithSink.getLastDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: expect.objectContaining({ code: "OUT_OF_SCOPE_FINDING", policy: "warn" }),
        }),
      ]),
    )
  })

  test("cross-tool observations with same check+file+lines are deduplicated", async () => {
    const slitherResult = {
      success: true,
      findingsCount: 1,
      findings: [
        {
          id: "abc123",
          check: "reentrancy-eth",
          severity: "High",
          confidence: "High",
          description: "Reentrancy from slither",
          file: "src/Vault.sol",
          lines: [10, 20],
          source: "slither",
        },
      ],
      executionTime: 5000,
      errors: [],
    }

    const patternResult = {
      sources: [
        {
          source: "pattern-db",
          matches: [
            {
              pattern: "reentrancy-eth",
              severity: "High",
              file: "src/Vault.sol",
              lines: [10, 20],
              description: "Reentrancy from pattern checker",
            },
          ],
        },
      ],
      patternsChecked: 5,
      executionTime: 100,
    }

    await hook({
      tool: "argus_slither_analyze",
      args: { target: "." },
      result: JSON.stringify(slitherResult),
    })

    await hook({
      tool: "argus_check_patterns",
      args: { target: "." },
      result: JSON.stringify(patternResult),
    })

    // Same check+file+lines from different tools are deduplicated by finding-store
    expect(auditState.findings).toHaveLength(1)
    expect(auditState.findings.at(0)?.source).toBe("slither")
  })

  test("contract analyzer updates contractsReviewed", async () => {
    const analyzerResult = {
      name: "Vault",
      filePath: "src/Vault.sol",
      functions: [],
      stateVars: [],
      inheritance: [],
      accessControlPattern: "ownable",
      externalCalls: [],
      riskIndicators: [],
    }

    await hook({
      tool: "argus_analyze_contract",
      args: { file_path: "src/Vault.sol" },
      result: JSON.stringify(analyzerResult),
    })

    expect(auditState.contractsReviewed).toContain("src/Vault.sol")
    expect(auditState.contractsReviewed).toHaveLength(1)
  })

  test("tool name recorded in toolsExecuted", async () => {
    const forgeResult = {
      success: true,
      summary: { passed: 5, failed: 0, skipped: 0, total: 5 },
      tests: [],
      executionTime: 1000,
    }

    await hook({
      tool: "argus_forge_test",
      args: { target: "." },
      result: JSON.stringify(forgeResult),
    })

    expect(auditState.toolsExecuted).toHaveLength(1)
    expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_forge_test")
    expect(auditState.toolsExecuted.at(0)?.success).toBe(true)
    expect(auditState.toolsExecuted.at(0)?.findingsCount).toBe(0)
  })

  test("forge test failed count is tracked from summary.failed", async () => {
    const forgeResult = {
      success: false,
      summary: { passed: 2, failed: 3, skipped: 1, total: 6 },
      tests: [],
      executionTime: 1200,
    }

    await hook({
      tool: "argus_forge_test",
      args: { target: "." },
      result: JSON.stringify(forgeResult),
    })

    expect(auditState.toolsExecuted).toHaveLength(1)
    expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_forge_test")
    expect(auditState.toolsExecuted.at(0)?.success).toBe(false)
    expect(auditState.toolsExecuted.at(0)?.findingsCount).toBe(3)
  })

  test("malformed JSON is no-op", async () => {
    await hook({
      tool: "argus_slither_analyze",
      args: {},
      result: "not json at all",
    })

    expect(auditState.findings).toHaveLength(0)
    expect(auditState.toolsExecuted).toHaveLength(0)
    expect(auditState.contractsReviewed).toHaveLength(0)
  })

  test("empty findings array — no findings added", async () => {
    const slitherResult = {
      success: true,
      findingsCount: 0,
      findings: [],
      executionTime: 5000,
      errors: [],
    }

    await hook({
      tool: "argus_slither_analyze",
      args: { target: "." },
      result: JSON.stringify(slitherResult),
    })

    expect(auditState.findings).toHaveLength(0)
    expect(auditState.toolsExecuted).toHaveLength(1)
    expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_slither_analyze")
    expect(auditState.toolsExecuted.at(0)?.findingsCount).toBe(0)
  })

  test("duplicate tool execution recorded separately", async () => {
    const slitherResult = {
      success: true,
      findingsCount: 0,
      findings: [],
      executionTime: 1000,
      errors: [],
    }

    await hook({
      tool: "argus_slither_analyze",
      args: { target: "." },
      result: JSON.stringify(slitherResult),
    })

    await hook({
      tool: "argus_slither_analyze",
      args: { target: "./src" },
      result: JSON.stringify(slitherResult),
    })

    expect(auditState.toolsExecuted).toHaveLength(2)
    expect(auditState.toolsExecuted[0]?.tool).toBe("argus_slither_analyze")
    expect(auditState.toolsExecuted[1]?.tool).toBe("argus_slither_analyze")
  })

  test("forge fuzz recorded without extracting findings", async () => {
    const fuzzResult = {
      success: true,
      results: [{ testName: "testFuzz_withdraw", status: "pass", runs: 256, gas: 50000 }],
      counterexamples: [],
      totalRuns: 256,
      executionTime: 3000,
    }

    await hook({
      tool: "argus_forge_fuzz",
      args: { target: "." },
      result: JSON.stringify(fuzzResult),
    })

    expect(auditState.findings).toHaveLength(0)
    expect(auditState.toolsExecuted).toHaveLength(1)
    expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_forge_fuzz")
  })

  test("contract analyzer does not add duplicate paths", async () => {
    const analyzerResult = {
      name: "Vault",
      filePath: "src/Vault.sol",
      functions: [],
      stateVars: [],
      inheritance: [],
      externalCalls: [],
      riskIndicators: [],
    }

    await hook({
      tool: "argus_analyze_contract",
      args: { file_path: "src/Vault.sol" },
      result: JSON.stringify(analyzerResult),
    })

    await hook({
      tool: "argus_analyze_contract",
      args: { file_path: "src/Vault.sol" },
      result: JSON.stringify(analyzerResult),
    })

    expect(auditState.contractsReviewed).toHaveLength(1)
  })

  test("no-op when audit state is unavailable", async () => {
    const hookWithoutState = createToolTrackingHook(() => null)

    await hookWithoutState({
      tool: "argus_slither_analyze",
      args: { target: "." },
      result: JSON.stringify({ success: true, findings: [] }),
    })
  })

  test("emits tool events to sink even when audit state is unavailable", async () => {
    const sink = createMockSink()
    const hookWithoutState = createToolTrackingHook(() => null, undefined, {
      getEventSink: () => sink,
      getSessionId: () => "oc-session-1",
    })

    await hookWithoutState({
      tool: "argus_slither_analyze",
      args: { target: "." },
      result: JSON.stringify({ success: true, findings: [] }),
    })

    const started = sink.events.filter((e) => e.type === "tool.started")
    const completed = sink.events.filter((e) => e.type === "tool.completed")

    expect(started).toHaveLength(1)
    expect(completed).toHaveLength(1)

    const startPayload = started[0]?.payload as Record<string, unknown>
    expect(startPayload.tool).toBe("argus_slither_analyze")

    const completedPayload = completed[0]?.payload as Record<string, unknown>
    expect(completedPayload.tool).toBe("argus_slither_analyze")
    expect(completedPayload.findingsCount).toBe(0)
    expect(completedPayload.success).toBe(false)

    // tool_call_id must be consistent between started and completed
    expect(started[0]?.tool_call_id).toBe(completed[0]?.tool_call_id)

    // run_id and session_id are empty strings when state is unavailable
    expect(started[0]?.run_id).toBe("")
    expect(started[0]?.session_id).toBe("")
  })

  describe("phase advancement", () => {
    test("argus_slither_analyze advances phase from reconnaissance to scanning", async () => {
      const slitherResult = {
        success: true,
        findingsCount: 0,
        findings: [],
        executionTime: 1000,
        errors: [],
      }

      await hook({
        tool: "argus_slither_analyze",
        args: { target: "." },
        result: JSON.stringify(slitherResult),
      })

      expect(auditState.currentPhase).toBe("scanning")
    })

    test("argus_solodit_search advances phase from scanning to research", async () => {
      auditState.currentPhase = "scanning"

      const soloditResult = {
        results: [],
        totalFound: 0,
        query: "test",
      }

      await hook({
        tool: "argus_solodit_search",
        args: { query: "test" },
        result: JSON.stringify(soloditResult),
      })

      expect(String(auditState.currentPhase)).toBe("research")
    })

    test("argus_forge_test advances phase to testing", async () => {
      auditState.currentPhase = "research"

      const forgeResult = {
        success: true,
        summary: { passed: 1, failed: 0, skipped: 0, total: 1 },
        tests: [],
      }

      await hook({
        tool: "argus_forge_test",
        args: { target: "." },
        result: JSON.stringify(forgeResult),
      })

      expect(String(auditState.currentPhase)).toBe("testing")
    })

    test("argus_generate_report advances phase to reporting", async () => {
      auditState.currentPhase = "testing"

      const reportResult = {
        report: "# Report",
        format: "markdown",
        findingsCount: 0,
        run_id: "test-run",
        filePath: ".argus/reports/test.md",
      }

      await hook({
        tool: "argus_generate_report",
        args: { project_name: "Vault" },
        result: JSON.stringify(reportResult),
      })

      expect(String(auditState.currentPhase)).toBe("reporting")
    })

    test("does not regress phase when tool maps to earlier phase", async () => {
      auditState.currentPhase = "testing"

      const slitherResult = {
        success: true,
        findingsCount: 0,
        findings: [],
        executionTime: 1000,
        errors: [],
      }

      await hook({
        tool: "argus_slither_analyze",
        args: { target: "." },
        result: JSON.stringify(slitherResult),
      })

      expect(auditState.currentPhase).toBe("testing")
    })

    test("emits phase.changed event to sink when phase advances", async () => {
      const sink = createMockSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
        getSessionId: () => "oc-session-1",
      })

      const slitherResult = {
        success: true,
        findingsCount: 0,
        findings: [],
        executionTime: 1000,
        errors: [],
      }

      await hookWithSink({
        tool: "argus_slither_analyze",
        args: { target: "." },
        result: JSON.stringify(slitherResult),
      })

      const phaseChanged = sink.events.filter((event) => event.type === "phase.changed")
      expect(phaseChanged).toHaveLength(1)

      const payload = phaseChanged[0]?.payload as Record<string, unknown>
      expect(payload.phase).toBe("scanning")
      expect(payload.trigger).toBe("argus_slither_analyze")
    })
  })

  describe("solodit evidence tracking", () => {
    test("solodit search results captured in auditState.soloditResults", async () => {
      const soloditResult = {
        results: [
          {
            title: "Reentrancy in withdraw",
            severity: "High",
            description: "State change after external call",
            protocol: "Compound",
            url: "https://solodit.xyz/issues/1",
            remediation: "Use checks-effects-interactions",
          },
          {
            title: "Oracle manipulation",
            severity: "Medium",
            description: "TWAP can be manipulated",
            protocol: "Uniswap",
            url: "https://solodit.xyz/issues/2",
            remediation: "Use longer TWAP window",
          },
        ],
        totalFound: 2,
        query: "reentrancy withdraw vault",
      }

      await hook({
        tool: "argus_solodit_search",
        args: { query: "reentrancy withdraw vault" },
        result: JSON.stringify(soloditResult),
      })

      expect(auditState.soloditResults).toBeDefined()
      expect(auditState.soloditResults).toHaveLength(1)

      const stored = auditState.soloditResults?.at(0)
      expect(stored).toBeDefined()
      expect(stored?.query).toBe("reentrancy withdraw vault")
      expect(stored?.resultCount).toBe(2)
      expect(stored?.timestamp).toBeGreaterThan(0)
      expect(stored?.topResults).toHaveLength(2)
      const topFirst = stored?.topResults.at(0)
      expect(topFirst).toBeDefined()
      expect(topFirst?.title).toBe("Reentrancy in withdraw")
      expect(topFirst?.severity).toBe("High")
      expect(topFirst?.url).toBe("https://solodit.xyz/issues/1")
      expect(topFirst?.protocol).toBe("Compound")
    })

    test("solodit search with empty results stores empty topResults", async () => {
      const soloditResult = {
        results: [],
        totalFound: 0,
        query: "nonexistent vulnerability pattern",
      }

      await hook({
        tool: "argus_solodit_search",
        args: { query: "nonexistent vulnerability pattern" },
        result: JSON.stringify(soloditResult),
      })

      expect(auditState.soloditResults).toHaveLength(1)

      const stored = auditState.soloditResults?.at(0)
      expect(stored).toBeDefined()
      expect(stored?.query).toBe("nonexistent vulnerability pattern")
      expect(stored?.resultCount).toBe(0)
      expect(stored?.topResults).toHaveLength(0)
    })

    test("solodit search with error field still records execution", async () => {
      const soloditResult = {
        results: [],
        totalFound: 0,
        query: "flash loan attack",
        error: "Solodit MCP not available",
      }

      await hook({
        tool: "argus_solodit_search",
        args: { query: "flash loan attack" },
        result: JSON.stringify(soloditResult),
      })

      expect(auditState.soloditResults).toHaveLength(1)
      const stored = auditState.soloditResults?.at(0)
      expect(stored).toBeDefined()
      expect(stored?.query).toBe("flash loan attack")
      expect(stored?.resultCount).toBe(0)

      expect(auditState.toolsExecuted).toHaveLength(1)
      expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_solodit_search")
    })

    test("solodit results limited to top 5", async () => {
      const soloditResult = {
        results: Array.from({ length: 8 }, (_, i) => ({
          title: `Finding ${i + 1}`,
          severity: "Medium",
          description: `Description ${i + 1}`,
          protocol: `Protocol ${i + 1}`,
          url: `https://solodit.xyz/issues/${i + 1}`,
          remediation: `Fix ${i + 1}`,
        })),
        totalFound: 8,
        query: "oracle manipulation",
      }

      await hook({
        tool: "argus_solodit_search",
        args: { query: "oracle manipulation" },
        result: JSON.stringify(soloditResult),
      })

      expect(auditState.soloditResults).toHaveLength(1)

      const stored = auditState.soloditResults?.at(0)
      expect(stored).toBeDefined()
      expect(stored?.topResults).toHaveLength(5)
      expect(stored?.resultCount).toBe(8)
      expect(stored?.topResults.at(0)?.title).toBe("Finding 1")
      expect(stored?.topResults.at(4)?.title).toBe("Finding 5")
    })

    test("multiple solodit searches accumulate results", async () => {
      const first = {
        results: [
          {
            title: "Reentrancy",
            severity: "High",
            description: "desc",
            protocol: "Aave",
            url: "https://solodit.xyz/issues/1",
            remediation: "fix",
          },
        ],
        totalFound: 1,
        query: "reentrancy",
      }

      const second = {
        results: [
          {
            title: "Flash loan",
            severity: "Critical",
            description: "desc",
            protocol: "dYdX",
            url: "https://solodit.xyz/issues/2",
            remediation: "fix",
          },
        ],
        totalFound: 1,
        query: "flash loan",
      }

      await hook({
        tool: "argus_solodit_search",
        args: { query: "reentrancy" },
        result: JSON.stringify(first),
      })

      await hook({
        tool: "argus_solodit_search",
        args: { query: "flash loan" },
        result: JSON.stringify(second),
      })

      expect(auditState.soloditResults).toHaveLength(2)
      expect(auditState.soloditResults?.at(0)?.query).toBe("reentrancy")
      expect(auditState.soloditResults?.at(1)?.query).toBe("flash loan")
    })
  })

  describe("fuzz counterexample tracking", () => {
    test("fuzz counterexamples captured in auditState.fuzzCounterexamples", async () => {
      const fuzzResult = {
        success: false,
        results: [
          { testName: "testFuzz_withdraw(uint256)", status: "fail", runs: 128, gas: 45000 },
        ],
        counterexamples: [
          {
            testName: "testFuzz_withdraw(uint256)",
            inputs: {
              arg0: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
            },
            revertReason: "Arithmetic overflow",
          },
        ],
        totalRuns: 128,
        executionTime: 2000,
      }

      await hook({
        tool: "argus_forge_fuzz",
        args: { target: "." },
        result: JSON.stringify(fuzzResult),
      })

      expect(auditState.fuzzCounterexamples).toHaveLength(1)
      const ce = auditState.fuzzCounterexamples?.at(0)
      expect(ce).toBeDefined()
      expect(ce?.testName).toBe("testFuzz_withdraw(uint256)")
      expect(ce?.inputs).toEqual([
        "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      ])
      expect(ce?.revertReason).toBe("Arithmetic overflow")
      expect(ce?.runs).toBe(128)
      expect(ce?.timestamp).toBeGreaterThan(0)
      expect(auditState.findings).toHaveLength(0)
    })

    test("fuzz results with no counterexamples stores empty array", async () => {
      const fuzzResult = {
        success: true,
        results: [{ testName: "testFuzz_deposit(uint256)", status: "pass", runs: 256, gas: 30000 }],
        counterexamples: [],
        totalRuns: 256,
        executionTime: 1500,
      }

      await hook({
        tool: "argus_forge_fuzz",
        args: { target: "." },
        result: JSON.stringify(fuzzResult),
      })

      expect(auditState.fuzzCounterexamples).toHaveLength(0)
      expect(auditState.toolsExecuted).toHaveLength(1)
      expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_forge_fuzz")
    })

    test("fuzz counterexample includes revert reason when present", async () => {
      const fuzzResult = {
        success: false,
        results: [],
        counterexamples: [
          {
            testName: "testFuzz_transfer(address,uint256)",
            inputs: { arg0: "0x0000000000000000000000000000000000000000", arg1: "1000" },
            revertReason: "ERC20: transfer to zero address",
          },
        ],
        totalRuns: 64,
        executionTime: 800,
      }

      await hook({
        tool: "argus_forge_fuzz",
        args: { target: "." },
        result: JSON.stringify(fuzzResult),
      })

      expect(auditState.fuzzCounterexamples).toHaveLength(1)
      const ce = auditState.fuzzCounterexamples?.at(0)
      expect(ce).toBeDefined()
      expect(ce?.revertReason).toBe("ERC20: transfer to zero address")
      expect(ce?.inputs).toEqual(["0x0000000000000000000000000000000000000000", "1000"])
    })

    test("fuzz counterexample without revert reason omits it", async () => {
      const fuzzResult = {
        success: false,
        results: [],
        counterexamples: [
          {
            testName: "testFuzz_mint(uint256)",
            inputs: { arg0: "0" },
          },
        ],
        totalRuns: 256,
        executionTime: 500,
      }

      await hook({
        tool: "argus_forge_fuzz",
        args: { target: "." },
        result: JSON.stringify(fuzzResult),
      })

      expect(auditState.fuzzCounterexamples).toHaveLength(1)
      const ce = auditState.fuzzCounterexamples?.at(0)
      expect(ce).toBeDefined()
      expect(ce?.testName).toBe("testFuzz_mint(uint256)")
      expect(ce?.revertReason).toBeUndefined()
      expect(ce?.runs).toBe(256)
    })

    test("fuzz counterexample supports array-shaped inputs", async () => {
      const fuzzResult = {
        success: false,
        results: [],
        counterexamples: [
          {
            testName: "testFuzz_swap(uint256,uint256)",
            inputs: ["100", "0"],
            revertReason: "Division by zero",
          },
        ],
        totalRuns: 42,
        executionTime: 600,
      }

      await hook({
        tool: "argus_forge_fuzz",
        args: { target: "." },
        result: JSON.stringify(fuzzResult),
      })

      expect(auditState.fuzzCounterexamples).toHaveLength(1)
      const ce = auditState.fuzzCounterexamples?.at(0)
      expect(ce).toBeDefined()
      expect(ce?.inputs).toEqual(["100", "0"])
      expect(ce?.revertReason).toBe("Division by zero")
      expect(ce?.runs).toBe(42)
    })

    test("multiple fuzz runs accumulate counterexamples", async () => {
      const firstRun = {
        success: false,
        results: [],
        counterexamples: [
          {
            testName: "testFuzz_withdraw(uint256)",
            inputs: { arg0: "999999" },
            revertReason: "Insufficient balance",
          },
        ],
        totalRuns: 128,
        executionTime: 1000,
      }

      const secondRun = {
        success: false,
        results: [],
        counterexamples: [
          {
            testName: "testFuzz_deposit(uint256)",
            inputs: { arg0: "0" },
          },
          {
            testName: "testFuzz_swap(uint256,uint256)",
            inputs: { arg0: "100", arg1: "0" },
            revertReason: "Division by zero",
          },
        ],
        totalRuns: 256,
        executionTime: 2000,
      }

      await hook({
        tool: "argus_forge_fuzz",
        args: { target: "." },
        result: JSON.stringify(firstRun),
      })

      auditState.toolsExecuted = []

      await hook({
        tool: "argus_forge_fuzz",
        args: { target: "." },
        result: JSON.stringify(secondRun),
      })

      expect(auditState.fuzzCounterexamples).toHaveLength(3)
      const ce0 = auditState.fuzzCounterexamples?.at(0)
      const ce1 = auditState.fuzzCounterexamples?.at(1)
      const ce2 = auditState.fuzzCounterexamples?.at(2)
      expect(ce0).toBeDefined()
      expect(ce1).toBeDefined()
      expect(ce2).toBeDefined()
      expect(ce0?.testName).toBe("testFuzz_withdraw(uint256)")
      expect(ce0?.runs).toBe(128)
      expect(ce1?.testName).toBe("testFuzz_deposit(uint256)")
      expect(ce1?.runs).toBe(256)
      expect(ce2?.testName).toBe("testFuzz_swap(uint256,uint256)")
      expect(ce2?.revertReason).toBe("Division by zero")
    })
  })

  describe("skill load tracking", () => {
    test("skill name extracted from markdown and added to skillsLoaded", async () => {
      const skillResult = `## Argus Skill: reentrancy [Source: bundled]

**Source**: bundled
**Path**: skills/reentrancy.md
**Description**: Reentrancy vulnerability patterns

[Provenance: MIT | https://example.com]

# Reentrancy Vulnerability

Detailed content about reentrancy...`

      await hook({
        tool: "argus_skill_load",
        args: { name: "reentrancy" },
        result: skillResult,
      })

      expect(auditState.skillsLoaded).toBeDefined()
      expect(auditState.skillsLoaded).toContain("reentrancy")
      expect(auditState.toolsExecuted).toHaveLength(1)
      expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_skill_load")
    })

    test("duplicate skill names are not added twice", async () => {
      const skillResult = `## Argus Skill: reentrancy [Source: bundled]

**Source**: bundled
**Path**: skills/reentrancy.md

# Reentrancy Vulnerability

Content...`

      await hook({
        tool: "argus_skill_load",
        args: { name: "reentrancy" },
        result: skillResult,
      })

      await hook({
        tool: "argus_skill_load",
        args: { name: "reentrancy" },
        result: skillResult,
      })

      expect(auditState.skillsLoaded).toHaveLength(1)
    })
  })

  describe("report generation tracking", () => {
    test("report generation sets reportGenerated to true", async () => {
      const reportResult = {
        report: "# Audit Report\n...",
        format: "markdown",
        findingsCount: 5,
        run_id: "run-test",
        filePath: ".argus/reports/Vault-security-audit-2026-03-02.md",
      }

      await hook({
        tool: "argus_generate_report",
        args: { project_name: "Vault" },
        result: JSON.stringify(reportResult),
      })

      expect(auditState.reportGenerated).toBe(true)
      expect(auditState.toolsExecuted).toHaveLength(1)
      expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_generate_report")
    })
  })

  describe("knowledge sync tracking", () => {
    test("sync event logged with success status", async () => {
      const syncResult = {
        success: true,
        entriesCount: 7769,
        source: "api.scvd.dev",
      }

      await hook({
        tool: "argus_sync_knowledge",
        args: { force: false },
        result: JSON.stringify(syncResult),
      })

      expect(auditState.knowledgeSynced).toBeDefined()
      expect(auditState.knowledgeSynced?.success).toBe(true)
      expect(auditState.knowledgeSynced?.timestamp).toBeGreaterThan(0)
      expect(auditState.toolsExecuted).toHaveLength(1)
      expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_sync_knowledge")
    })

    test("sync failure logged with success=false", async () => {
      const syncResult = {
        success: false,
        error: "Network timeout",
      }

      await hook({
        tool: "argus_sync_knowledge",
        args: { force: true },
        result: JSON.stringify(syncResult),
      })

      expect(auditState.knowledgeSynced).toBeDefined()
      expect(auditState.knowledgeSynced?.success).toBe(false)
      expect(auditState.knowledgeSynced?.timestamp).toBeGreaterThan(0)
    })
  })

  describe("forge coverage tracking", () => {
    test("coverage summary extracted to coverageReport", async () => {
      const coverageResult = {
        success: true,
        report: {
          files: [
            {
              path: "src/Vault.sol",
              linesPct: 85.5,
              statementsPct: 80.0,
              branchesPct: 70.0,
              functionsPct: 90.0,
            },
            {
              path: "src/Token.sol",
              linesPct: 100,
              statementsPct: 100,
              branchesPct: 95.0,
              functionsPct: 100,
            },
          ],
          summary: {
            totalLinesPct: 92.75,
            totalStatementsPct: 90.0,
            totalBranchesPct: 82.5,
            totalFunctionsPct: 95.0,
          },
        },
        executionTime: 5000,
      }

      await hook({
        tool: "argus_forge_coverage",
        args: { target: "." },
        result: JSON.stringify(coverageResult),
      })

      expect(auditState.coverageReport).toBeDefined()
      expect(auditState.coverageReport?.files).toHaveLength(2)
      const covFile0 = auditState.coverageReport?.files.at(0)
      const covFile1 = auditState.coverageReport?.files.at(1)
      expect(covFile0).toBeDefined()
      expect(covFile0?.path).toBe("src/Vault.sol")
      expect(covFile0?.linesPct).toBe(85.5)
      expect(covFile0?.branchesPct).toBe(70.0)
      expect(covFile0?.functionsPct).toBe(90.0)
      expect(covFile1).toBeDefined()
      expect(covFile1?.path).toBe("src/Token.sol")
      expect(auditState.toolsExecuted).toHaveLength(1)
      expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_forge_coverage")
      expect(auditState.coverageAttempt?.status).toBe("run")
    })

    test("coverage failure records explicit coverage attempt state", async () => {
      await hook({
        tool: "argus_forge_coverage",
        args: { target: "." },
        result: JSON.stringify({
          success: false,
          error: "forge coverage unavailable",
        }),
      })

      expect(auditState.coverageAttempt?.status).toBe("failed")
      expect(auditState.coverageAttempt?.reason).toBe("forge coverage unavailable")
      expect(auditState.toolsExecuted.at(0)?.findingCounts?.recordedFindings).toBe(0)
    })
  })

  describe("proxy detection tracking", () => {
    test("proxy detection with isProxy=true creates proxyContracts entry", async () => {
      const proxyResult = {
        isProxy: true,
        file: "src/VaultProxy.sol",
        proxyType: "UUPS",
        indicators: ["delegatecall", "ERC1967 storage slot"],
        confidence: "High",
      }

      await hook({
        tool: "argus_proxy_detection",
        args: { file_path: "src/VaultProxy.sol" },
        result: JSON.stringify(proxyResult),
      })

      expect(auditState.proxyContracts).toBeDefined()
      expect(auditState.proxyContracts).toHaveLength(1)
      const proxy0 = auditState.proxyContracts?.at(0)
      expect(proxy0).toBeDefined()
      expect(proxy0?.file).toBe("src/VaultProxy.sol")
      expect(proxy0?.proxyType).toBe("UUPS")
      expect(proxy0?.indicators).toEqual(["delegatecall", "ERC1967 storage slot"])
      expect(auditState.findings).toHaveLength(0)
      expect(auditState.toolsExecuted).toHaveLength(1)
      expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_proxy_detection")
    })

    test("proxy detection with isProxy=false does not create proxyContracts entry", async () => {
      const proxyResult = {
        isProxy: false,
        file: "src/Vault.sol",
        indicators: [],
        confidence: "High",
      }

      await hook({
        tool: "argus_proxy_detection",
        args: { file_path: "src/Vault.sol" },
        result: JSON.stringify(proxyResult),
      })

      expect(auditState.proxyContracts).toBeUndefined()
      expect(auditState.toolsExecuted).toHaveLength(1)
    })
  })

  describe("gas analysis tracking", () => {
    test("gas hotspots extracted to gasHotspots", async () => {
      const gasResult = {
        hotspots: [
          { contract: "Vault", function: "withdraw", avgGas: 150000 },
          { contract: "Vault", function: "deposit", avgGas: 85000 },
        ],
        threshold: 50000,
        totalContracts: 1,
      }

      await hook({
        tool: "argus_gas_analysis",
        args: { target: "." },
        result: JSON.stringify(gasResult),
      })

      expect(auditState.gasHotspots).toBeDefined()
      expect(auditState.gasHotspots).toHaveLength(2)
      const gas0 = auditState.gasHotspots?.at(0)
      const gas1 = auditState.gasHotspots?.at(1)
      expect(gas0).toBeDefined()
      expect(gas0?.contract).toBe("Vault")
      expect(gas0?.function).toBe("withdraw")
      expect(gas0?.avgGas).toBe(150000)
      expect(gas1).toBeDefined()
      expect(gas1?.function).toBe("deposit")
      expect(auditState.toolsExecuted).toHaveLength(1)
      expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_gas_analysis")
    })

    test("gas analysis with empty hotspots stores empty array", async () => {
      const gasResult = {
        hotspots: [],
        threshold: 50000,
        totalContracts: 1,
      }

      await hook({
        tool: "argus_gas_analysis",
        args: { target: "." },
        result: JSON.stringify(gasResult),
      })

      expect(auditState.gasHotspots).toBeDefined()
      expect(auditState.gasHotspots).toHaveLength(0)
    })
  })

  describe("event sink emission", () => {
    test("emits tool.started and tool.completed for argus tools", async () => {
      const sink = createMockSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
        getSessionId: () => "oc-session-1",
      })

      await hookWithSink({
        tool: "argus_forge_test",
        args: { target: "." },
        result: JSON.stringify({
          success: true,
          summary: { passed: 5, failed: 0, skipped: 0, total: 5 },
          tests: [],
        }),
      })

      const started = sink.events.filter((e) => e.type === "tool.started")
      const completed = sink.events.filter((e) => e.type === "tool.completed")

      expect(started).toHaveLength(1)
      expect(completed).toHaveLength(1)

      expect(started[0]?.source).toBe("tool-tracking-hook")
      expect(started[0]?.session_id).toBe("oc-session-1")
      expect(started[0]?.run_id).toBe(auditState.sessionId)
      const startPayload = started[0]?.payload as Record<string, unknown>
      expect(startPayload.tool).toBe("argus_forge_test")

      const completedPayload = completed[0]?.payload as Record<string, unknown>
      expect(completedPayload.tool).toBe("argus_forge_test")
      expect(completedPayload.findingsCount).toBe(0)
      expect(completedPayload.success).toBe(true)

      expect(started[0]?.tool_call_id).toBe(completed[0]?.tool_call_id)
    })

    test("emits finding.added for each new finding from slither", async () => {
      const sink = createMockSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
      })

      const slitherResult = {
        findings: [
          {
            check: "reentrancy-eth",
            severity: "High",
            confidence: "High",
            description: "Reentrancy",
            file: "src/Vault.sol",
            lines: [10, 20],
            source: "slither",
          },
          {
            check: "unchecked-transfer",
            severity: "Medium",
            confidence: "Medium",
            description: "Unchecked transfer",
            file: "src/Token.sol",
            lines: [30, 35],
            source: "slither",
          },
        ],
      }

      await hookWithSink({
        tool: "argus_slither_analyze",
        args: { target: "." },
        result: JSON.stringify(slitherResult),
      })

      const findingEvents = sink.events.filter((e) => e.type === "finding.added")
      expect(findingEvents).toHaveLength(2)

      const f1 = findingEvents[0]?.payload as Record<string, unknown>
      expect(f1.check).toBe("reentrancy-eth")
      expect(f1.severity).toBe("High")
      expect(f1.run_id).toBe(auditState.sessionId)

      const f2 = findingEvents[1]?.payload as Record<string, unknown>
      expect(f2.check).toBe("unchecked-transfer")
    })

    test("prefers run-scoped sink when session sink run mismatches state run", async () => {
      const mismatchedSink = createMockSink("run-mismatched")
      const runScopedSink = createMockSink("run-canonical")
      auditState.sessionId = "run-canonical"

      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSinkForSession: () => mismatchedSink,
        getEventSink: () => mismatchedSink,
        getEventSinkForRun: (runId: string) => (runId === "run-canonical" ? runScopedSink : null),
        getSessionId: () => "oc-session-1",
      })

      await hookWithSink({
        tool: "argus_forge_test",
        args: { target: "." },
        result: JSON.stringify({
          success: true,
          summary: { passed: 1, failed: 0, skipped: 0, total: 1 },
          tests: [],
        }),
      })

      expect(mismatchedSink.events).toHaveLength(0)
      expect(runScopedSink.events.filter((event) => event.type === "tool.started")).toHaveLength(1)
      expect(runScopedSink.events.filter((event) => event.type === "tool.completed")).toHaveLength(
        1,
      )
    })

    test("records findings count from read_findings tool output", async () => {
      const sink = createMockSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
      })

      await hookWithSink({
        tool: "argus_read_findings",
        args: { run_id: auditState.sessionId },
        result: JSON.stringify({
          success: true,
          truncated: false,
          reportInput: {
            run_id: auditState.sessionId,
            findings: [
              {
                check: "one",
                severity: "Low",
                file: "A.sol",
                lines: [1, 1],
                description: "one",
                source: "manual",
                confidence: "High",
              },
              {
                check: "two",
                severity: "Medium",
                file: "B.sol",
                lines: [2, 2],
                description: "two",
                source: "manual",
                confidence: "High",
              },
            ],
            toolsExecuted: [],
            scope: [],
          },
        }),
      })

      const completed = sink.events.find((e) => e.type === "tool.completed")
      const completedPayload = completed?.payload as Record<string, unknown>
      expect(completedPayload.tool).toBe("argus_read_findings")
      expect(completedPayload.findingsCount).toBe(2)
      expect(auditState.toolsExecuted.at(-1)?.findingsCount).toBe(2)
    })

    test("emits tool.started and tool.completed for skill_load", async () => {
      const sink = createMockSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
      })

      await hookWithSink({
        tool: "argus_skill_load",
        args: { name: "reentrancy" },
        result: `## Argus Skill: reentrancy [Source: bundled]\n\nContent...`,
      })

      const started = sink.events.filter((e) => e.type === "tool.started")
      const completed = sink.events.filter((e) => e.type === "tool.completed")

      expect(started).toHaveLength(1)
      expect(completed).toHaveLength(1)

      const startPayload = started[0]?.payload as Record<string, unknown>
      expect(startPayload.tool).toBe("argus_skill_load")
    })

    test("deduplicates repeated observations — emits finding.added only for first", async () => {
      const sink = createMockSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
      })

      const slitherResult = {
        findings: [
          {
            check: "reentrancy-eth",
            severity: "High",
            confidence: "High",
            description: "Reentrancy",
            file: "src/Vault.sol",
            lines: [10, 20],
            source: "slither",
          },
        ],
      }

      await hookWithSink({
        tool: "argus_slither_analyze",
        args: { target: "." },
        result: JSON.stringify(slitherResult),
      })

      const findingsBefore = sink.events.filter((e) => e.type === "finding.added").length
      expect(findingsBefore).toBe(1)

      const patternResult = {
        sources: [
          {
            source: "pattern-db",
            matches: [
              {
                pattern: "reentrancy-eth",
                severity: "High",
                file: "src/Vault.sol",
                lines: [10, 20],
                description: "Reentrancy from pattern",
              },
            ],
          },
        ],
      }

      await hookWithSink({
        tool: "argus_check_patterns",
        args: { target: "." },
        result: JSON.stringify(patternResult),
      })

      // Same check+file+lines deduped — no new finding.added event
      const findingsAfter = sink.events.filter((e) => e.type === "finding.added").length
      expect(findingsAfter).toBe(1)
    })

    test("does not emit to sink for non-argus tools", async () => {
      const sink = createMockSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
      })

      await hookWithSink({
        tool: "bash",
        args: {},
        result: "hello",
      })

      expect(sink.events).toHaveLength(0)
    })

    test("gracefully handles sink failure without crashing", async () => {
      const failingSink = createFailingSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => failingSink,
      })

      await expect(
        hookWithSink({
          tool: "argus_forge_test",
          args: { target: "." },
          result: JSON.stringify({
            success: true,
            summary: { passed: 1, failed: 0, skipped: 0, total: 1 },
            tests: [],
          }),
        }),
      ).resolves.toBeUndefined()

      expect(auditState.toolsExecuted).toHaveLength(1)
    })

    test("argus_record_finding fails fast when sink write fails", async () => {
      const failingSink = createFailingSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => failingSink,
        getSessionId: () => "oc-session-1",
      })

      await expect(
        hookWithSink({
          tool: "argus_record_finding",
          args: {},
          result: JSON.stringify({
            success: true,
            count: 1,
            findings: [
              {
                check: "manual-issue",
                severity: "High",
                confidence: "High",
                description: "Manual issue",
                file: "src/Vault.sol",
                lines: [10, 12],
                source: "manual",
              },
            ],
          }),
        }),
      ).rejects.toThrow("Failed to emit tool.started event to sink")
    })

    test("does not emit when no sink is provided", async () => {
      const hookWithoutSink = createToolTrackingHook(() => auditState)

      await hookWithoutSink({
        tool: "argus_forge_test",
        args: { target: "." },
        result: JSON.stringify({
          success: true,
          summary: { passed: 1, failed: 0, skipped: 0, total: 1 },
          tests: [],
        }),
      })

      expect(auditState.toolsExecuted).toHaveLength(1)
    })

    test("tool_call_id is consistent between started and completed events", async () => {
      const sink = createMockSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
      })

      await hookWithSink({
        tool: "argus_analyze_contract",
        args: { file_path: "src/Vault.sol" },
        result: JSON.stringify({ filePath: "src/Vault.sol", functions: [] }),
      })

      const started = sink.events.find((e) => e.type === "tool.started")
      const completed = sink.events.find((e) => e.type === "tool.completed")

      expect(started?.tool_call_id).toBeDefined()
      expect(started?.tool_call_id).toBe(completed?.tool_call_id)
      expect(started?.tool_call_id?.length).toBeGreaterThan(0)
    })
  })

  describe("drop diagnostics", () => {
    test("truncated output emits completed event as non-success with error", async () => {
      const sink = createMockSink()
      const hookWithDiag = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
      })

      await hookWithDiag({
        tool: "argus_check_patterns",
        args: { target: "." },
        result: "... output was truncated ... 2048 bytes truncated ...",
      })

      const diags = hookWithDiag.getLastDiagnostics()
      expect(diags).toHaveLength(1)
      expect(diags[0]?.reason.code).toBe("TRUNCATED_OUTPUT")

      const completed = sink.events.filter((e) => e.type === "tool.completed")
      expect(completed).toHaveLength(1)

      const payload = completed[0]?.payload as Record<string, unknown>
      expect(payload.tool).toBe("argus_check_patterns")
      expect(payload.success).toBe(false)
      expect(payload.findingsCount).toBe(0)
      expect(payload.error).toContain("truncated")
    })

    test("malformed JSON emits MALFORMED_JSON diagnostic", async () => {
      const hookWithDiag = createToolTrackingHook(() => auditState)

      await hookWithDiag({
        tool: "argus_slither_analyze",
        args: {},
        result: "not json at all",
      })

      const diags = hookWithDiag.getLastDiagnostics()
      expect(diags).toHaveLength(1)
      expect(diags[0]?.type).toBe("drop")
      expect(diags[0]?.source).toBe("tool-tracking-hook")
      expect(diags[0]?.tool).toBe("argus_slither_analyze")
      expect(diags[0]?.reason.code).toBe("MALFORMED_JSON")
      expect(diags[0]?.reason.policy).toBe("warn")
      expect(diags[0]?.timestamp).toBeGreaterThan(0)
    })

    test("missing required field emits MISSING_REQUIRED_FIELD diagnostic for slither", async () => {
      const hookWithDiag = createToolTrackingHook(() => auditState)

      const slitherResult = {
        findings: [
          { check: "reentrancy", description: "desc" },
          { check: "overflow", description: "desc", file: "Vault.sol", lines: [1, 5] },
        ],
      }

      await hookWithDiag({
        tool: "argus_slither_analyze",
        args: {},
        result: JSON.stringify(slitherResult),
      })

      const diags = hookWithDiag.getLastDiagnostics()
      expect(diags.length).toBeGreaterThanOrEqual(1)

      const missingField = diags.find((d) => d.reason.code === "MISSING_REQUIRED_FIELD")
      expect(missingField).toBeDefined()
      expect(missingField?.reason.message).toContain("Slither finding skipped")
      expect(missingField?.tool).toBe("argus_slither_analyze")

      expect(auditState.findings).toHaveLength(1)
    })

    test("missing required field emits MISSING_REQUIRED_FIELD diagnostic for patterns", async () => {
      const hookWithDiag = createToolTrackingHook(() => auditState)

      const patternResult = {
        sources: [
          {
            source: "pattern-db",
            matches: [{ pattern: "reentrancy", description: "desc" }],
          },
        ],
      }

      await hookWithDiag({
        tool: "argus_check_patterns",
        args: {},
        result: JSON.stringify(patternResult),
      })

      const diags = hookWithDiag.getLastDiagnostics()
      expect(diags).toHaveLength(1)
      expect(diags[0]?.reason.code).toBe("MISSING_REQUIRED_FIELD")
      expect(diags[0]?.reason.message).toContain("Pattern finding skipped")
    })

    test("strict-fail mode throws on MALFORMED_JSON", async () => {
      const hookStrict = createToolTrackingHook(() => auditState, undefined, {
        dropPolicy: "strict-fail",
      })

      await expect(
        hookStrict({
          tool: "argus_slither_analyze",
          args: {},
          result: "not json",
        }),
      ).rejects.toThrow(DropDiagnosticsError)
    })

    test("strict-fail mode throws on MISSING_REQUIRED_FIELD", async () => {
      const hookStrict = createToolTrackingHook(() => auditState, undefined, {
        dropPolicy: "strict-fail",
      })

      const slitherResult = {
        findings: [{ check: "reentrancy" }],
      }

      await expect(
        hookStrict({
          tool: "argus_slither_analyze",
          args: {},
          result: JSON.stringify(slitherResult),
        }),
      ).rejects.toThrow(DropDiagnosticsError)
    })

    test("warn mode does not throw on missing fields", async () => {
      const hookWarn = createToolTrackingHook(() => auditState, undefined, {
        dropPolicy: "warn",
      })

      const slitherResult = {
        findings: [{ check: "reentrancy" }],
      }

      await expect(
        hookWarn({
          tool: "argus_slither_analyze",
          args: {},
          result: JSON.stringify(slitherResult),
        }),
      ).resolves.toBeUndefined()

      const diags = hookWarn.getLastDiagnostics()
      expect(diags).toHaveLength(1)
      expect(diags[0]?.reason.code).toBe("MISSING_REQUIRED_FIELD")
    })

    test("truncated JSON output is NOT treated as success with 0 findings", async () => {
      const sink = createMockSink()
      const hookWithDiag = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
      })

      const truncatedJson = '{"success": true, "findings": [{"check": "reentrancy"'

      await hookWithDiag({
        tool: "argus_slither_analyze",
        args: { target: "." },
        result: truncatedJson,
      })

      const diags = hookWithDiag.getLastDiagnostics()
      expect(diags).toHaveLength(1)
      expect(diags[0]?.reason.code).toBe("TRUNCATED_OUTPUT")

      const completed = sink.events.filter((e) => e.type === "tool.completed")
      expect(completed).toHaveLength(1)

      const payload = completed[0]?.payload as Record<string, unknown>
      expect(payload.success).toBe(false)
      expect(payload.error).toContain("truncated")
    })

    test("OpenCode truncation message is NOT treated as success", async () => {
      const sink = createMockSink()
      const hookWithDiag = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
      })

      await hookWithDiag({
        tool: "argus_check_patterns",
        args: { target: "." },
        result: "... output was truncated ... 2048 bytes truncated ...",
      })

      const diags = hookWithDiag.getLastDiagnostics()
      expect(diags).toHaveLength(1)
      expect(diags[0]?.reason.code).toBe("TRUNCATED_OUTPUT")

      const completed = sink.events.filter((e) => e.type === "tool.completed")
      expect(completed).toHaveLength(1)

      const payload = completed[0]?.payload as Record<string, unknown>
      expect(payload.success).toBe(false)
      expect(payload.error).toContain("truncated")
    })
  })

  describe("event enrichment for replay", () => {
    test("solodit_search tool.completed carries soloditResults", async () => {
      const sink = createMockSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
      })

      await hookWithSink({
        tool: "argus_solodit_search",
        args: { query: "reentrancy" },
        result: JSON.stringify({
          results: [
            {
              title: "Reentrancy in withdraw",
              severity: "High",
              url: "https://solodit.xyz/1",
              protocol: "Compound",
            },
          ],
          totalFound: 1,
          query: "reentrancy",
        }),
      })

      const completed = sink.events.find((e) => e.type === "tool.completed")
      const payload = completed?.payload as Record<string, unknown>
      expect(payload.success).toBe(true)
      expect(payload.soloditResults).toBeDefined()
      expect(Array.isArray(payload.soloditResults)).toBe(true)
      const results = payload.soloditResults as Array<Record<string, unknown>>
      expect(results).toHaveLength(1)
      expect(results[0]?.query).toBe("reentrancy")
    })

    test("forge_fuzz tool.completed carries fuzzCounterexamples", async () => {
      const sink = createMockSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
      })

      await hookWithSink({
        tool: "argus_forge_fuzz",
        args: { target: "." },
        result: JSON.stringify({
          counterexamples: [{ testName: "testFuzz_withdraw(uint256)", inputs: ["999"] }],
          totalRuns: 128,
        }),
      })

      const completed = sink.events.find((e) => e.type === "tool.completed")
      const payload = completed?.payload as Record<string, unknown>
      expect(payload.success).toBe(true)
      expect(payload.fuzzCounterexamples).toBeDefined()
      const ces = payload.fuzzCounterexamples as Array<Record<string, unknown>>
      expect(ces).toHaveLength(1)
      expect(ces[0]?.testName).toBe("testFuzz_withdraw(uint256)")
    })

    test("forge_coverage tool.completed carries coverageReport", async () => {
      const sink = createMockSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
      })

      await hookWithSink({
        tool: "argus_forge_coverage",
        args: { target: "." },
        result: JSON.stringify({
          report: {
            files: [
              {
                path: "src/Vault.sol",
                linesPct: 85,
                statementsPct: 80,
                branchesPct: 70,
                functionsPct: 90,
              },
            ],
          },
        }),
      })

      const completed = sink.events.find((e) => e.type === "tool.completed")
      const payload = completed?.payload as Record<string, unknown>
      expect(payload.success).toBe(true)
      expect(payload.coverageReport).toBeDefined()
      const report = payload.coverageReport as Record<string, unknown>
      expect(Array.isArray(report.files)).toBe(true)
    })

    test("gas_analysis tool.completed carries gasHotspots", async () => {
      const sink = createMockSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
      })

      await hookWithSink({
        tool: "argus_gas_analysis",
        args: { target: "." },
        result: JSON.stringify({
          hotspots: [{ contract: "Vault", function: "withdraw", avgGas: 150000 }],
          threshold: 50000,
          totalContracts: 1,
        }),
      })

      const completed = sink.events.find((e) => e.type === "tool.completed")
      const payload = completed?.payload as Record<string, unknown>
      expect(payload.success).toBe(true)
      expect(payload.gasHotspots).toBeDefined()
      const hotspots = payload.gasHotspots as Array<Record<string, unknown>>
      expect(hotspots).toHaveLength(1)
      expect(hotspots[0]?.contract).toBe("Vault")
    })

    test("proxy_detection tool.completed carries proxyContracts", async () => {
      const sink = createMockSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
      })

      await hookWithSink({
        tool: "argus_proxy_detection",
        args: { file_path: "src/VaultProxy.sol" },
        result: JSON.stringify({
          isProxy: true,
          file: "src/VaultProxy.sol",
          proxyType: "UUPS",
          indicators: ["delegatecall"],
          confidence: "High",
        }),
      })

      const completed = sink.events.find((e) => e.type === "tool.completed")
      const payload = completed?.payload as Record<string, unknown>
      expect(payload.success).toBe(true)
      expect(payload.proxyContracts).toBeDefined()
      const proxies = payload.proxyContracts as Array<Record<string, unknown>>
      expect(proxies).toHaveLength(1)
      expect(proxies[0]?.proxyType).toBe("UUPS")
    })

    test("skill_load tool.completed carries skillsLoaded", async () => {
      const sink = createMockSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
      })

      await hookWithSink({
        tool: "argus_skill_load",
        args: { name: "reentrancy" },
        result: `## Argus Skill: reentrancy [Source: bundled]\n\n**Source**: bundled\n**Path**: skills/reentrancy.md\n\n# Reentrancy`,
      })

      const completed = sink.events.find((e) => e.type === "tool.completed")
      const payload = completed?.payload as Record<string, unknown>
      expect(payload.success).toBe(true)
      expect(payload.skillsLoaded).toBeDefined()
      const skills = payload.skillsLoaded as string[]
      expect(skills).toContain("reentrancy")
    })

    test("check_patterns tool.completed carries patternVersion", async () => {
      const sink = createMockSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
      })

      await hookWithSink({
        tool: "argus_check_patterns",
        args: { target: "." },
        result: JSON.stringify({
          sources: [],
          patternsChecked: 5,
          patternVersion: "1.0.0",
        }),
      })

      const completed = sink.events.find((e) => e.type === "tool.completed")
      const payload = completed?.payload as Record<string, unknown>
      expect(payload.success).toBe(true)
      expect(payload.patternVersion).toBe("1.0.0")
      expect(auditState.patternVersion).toBe("1.0.0")
    })

    test("failed tool does not include enrichment data", async () => {
      const sink = createMockSink()
      const hookWithSink = createToolTrackingHook(() => auditState, undefined, {
        getEventSink: () => sink,
      })

      await hookWithSink({
        tool: "argus_solodit_search",
        args: { query: "test" },
        result: "not valid json",
      })

      const completed = sink.events.find((e) => e.type === "tool.completed")
      const payload = completed?.payload as Record<string, unknown>
      expect(payload.success).toBe(false)
      expect(payload.soloditResults).toBeUndefined()
    })
  })
})

describe("createToolTrackingHook orphan buffer bounds (WS-3 I7)", () => {
  const CLEAN_RESULT = JSON.stringify({ success: true, findingsCount: 0, findings: [] })

  function bufferingHook(orphanBufferBounds: {
    maxSessions?: number
    maxEventsPerSession?: number
    ttlMs?: number
  }): ReturnType<typeof createToolTrackingHook> {
    const state = createAuditState("/test/project").state
    state.sessionId = "orphan-run"
    return createToolTrackingHook(() => state, undefined, { orphanBufferBounds })
  }

  function bufferSession(
    hook: ReturnType<typeof createToolTrackingHook>,
    sessionID: string,
  ): Promise<void> {
    return hook({ tool: "argus_check_patterns", args: {}, result: CLEAN_RESULT, sessionID })
  }

  test("evicts the stalest session when the global session cap is exceeded", async () => {
    const hook = bufferingHook({ maxSessions: 2 })
    await bufferSession(hook, "sess-A")
    await bufferSession(hook, "sess-B")
    await bufferSession(hook, "sess-C")

    expect(await hook.flushOrphanEvents("sess-A", createMockSink("orphan-run"))).toBe(0)
    expect(await hook.flushOrphanEvents("sess-B", createMockSink("orphan-run"))).toBeGreaterThan(0)
    expect(await hook.flushOrphanEvents("sess-C", createMockSink("orphan-run"))).toBeGreaterThan(0)
  })

  test("proactively reclaims TTL-expired sessions when a new session buffers", async () => {
    const hook = bufferingHook({ ttlMs: 50 })
    await bufferSession(hook, "sess-old")
    await new Promise((resolve) => setTimeout(resolve, 100))
    await bufferSession(hook, "sess-new")

    expect(await hook.flushOrphanEvents("sess-old", createMockSink("orphan-run"))).toBe(0)
    expect(await hook.flushOrphanEvents("sess-new", createMockSink("orphan-run"))).toBeGreaterThan(
      0,
    )
  })

  test("clearOrphanEvents drops a session's buffer on session.deleted cleanup", async () => {
    const hook = bufferingHook({})
    await bufferSession(hook, "sess-x")

    hook.clearOrphanEvents("sess-x")

    expect(await hook.flushOrphanEvents("sess-x", createMockSink("orphan-run"))).toBe(0)
  })
})
