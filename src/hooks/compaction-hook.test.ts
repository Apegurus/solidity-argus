import { test, expect, describe } from "bun:test"
import { createCompactionHook } from "./compaction-hook"
import type { AuditState, Finding } from "../state/types"

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "abc123",
    check: "reentrancy-eth",
    severity: "Medium",
    confidence: "High",
    description: "Reentrancy vulnerability",
    file: "src/Vault.sol",
    lines: [10, 20] as [number, number],
    source: "slither",
    ...overrides,
  }
}

function makeState(overrides: Partial<AuditState> = {}): AuditState {
  return {
    sessionId: "test-session-1",
    projectDir: "/tmp/test-project",
    contractsReviewed: [],
    findings: [],
    toolsExecuted: [],
    currentPhase: "reconnaissance",
    scope: [],
    startTime: Date.now(),
    ...overrides,
  }
}

describe("createCompactionHook", () => {
  test("no-op when no audit state", async () => {
    const hook = createCompactionHook(() => null)
    const summary = "This is the original summary."
    const result = await hook({ summary })
    expect(result).toBe(summary)
  })

  test("prepends XML block when audit active", async () => {
    const state = makeState()
    const hook = createCompactionHook(() => state)
    const result = await hook({ summary: "original" })
    expect(result).toStartWith("<argus-audit-state>")
  })

  test("finding counts by severity correct", async () => {
    const state = makeState({
      findings: [
        makeFinding({ id: "f1", severity: "Critical" }),
        makeFinding({ id: "f2", severity: "Critical" }),
        makeFinding({ id: "f3", severity: "High" }),
      ],
    })
    const hook = createCompactionHook(() => state)
    const result = await hook({ summary: "s" })
    expect(result).toContain("Critical: 2")
    expect(result).toContain("High: 1")
    expect(result).toContain("Medium: 0")
    expect(result).toContain("Low: 0")
    expect(result).toContain("Informational: 0")
  })

  test("contracts listed", async () => {
    const state = makeState({
      contractsReviewed: ["Vault.sol", "Token.sol"],
    })
    const hook = createCompactionHook(() => state)
    const result = await hook({ summary: "s" })
    expect(result).toContain("Vault.sol")
    expect(result).toContain("Token.sol")
  })

  test("XML is parseable", async () => {
    const state = makeState()
    const hook = createCompactionHook(() => state)
    const result = await hook({ summary: "s" })
    expect(result).toContain("<argus-audit-state>")
    expect(result).toContain("</argus-audit-state>")

    // Extract XML block and verify structure
    const openIdx = result.indexOf("<argus-audit-state>")
    const closeIdx = result.indexOf("</argus-audit-state>")
    expect(openIdx).toBeLessThan(closeIdx)
  })

  test("original summary preserved", async () => {
    const state = makeState()
    const hook = createCompactionHook(() => state)
    const originalSummary = "Important audit context about the Vault contract."
    const result = await hook({ summary: originalSummary })
    expect(result).toContain(originalSummary)
  })

  test("phase included", async () => {
    const state = makeState({ currentPhase: "manual-review" })
    const hook = createCompactionHook(() => state)
    const result = await hook({ summary: "s" })
    expect(result).toContain("Phase: manual-review")
  })
})
