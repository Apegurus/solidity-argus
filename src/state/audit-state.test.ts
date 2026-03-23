import { describe, expect, test } from "bun:test"
import { createAuditState } from "./audit-state"
import type { FindingSeverity } from "./types"

describe("AuditState - Finding Deduplication", () => {
  test("should create audit state with factory pattern", () => {
    const { state } = createAuditState("/test/project")
    expect(state.projectDir).toBe("/test/project")
    expect(state.findings).toEqual([])
    expect(state.contractsReviewed).toEqual([])
  })

  test("should add finding to store", () => {
    const { store } = createAuditState("/test/project")
    const finding = store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Reentrancy vulnerability detected",
      file: "Vault.sol",
      lines: [10, 15],
      source: "slither",
    })

    expect(finding.id).toBeDefined()
    expect(finding.check).toBe("reentrancy-eth")
    expect(finding.severity).toBe("High")
  })

  test("should deduplicate repeated observations with same check+file+lines", () => {
    const { store } = createAuditState("/test/project")

    // Add first finding
    const finding1 = store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Reentrancy vulnerability detected",
      file: "Vault.sol",
      lines: [10, 15],
      source: "slither",
    })

    // Add duplicate finding (same check, file, lines) — should be deduped
    const finding2 = store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Reentrancy vulnerability detected",
      file: "Vault.sol",
      lines: [10, 15],
      source: "slither",
    })

    expect(finding1.id).toBe(finding2.id)

    const findings = store.getFindings()
    expect(findings.length).toBe(1)
  })

  test("should not deduplicate findings with different lines", () => {
    const { store } = createAuditState("/test/project")

    store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Reentrancy vulnerability detected",
      file: "Vault.sol",
      lines: [10, 15],
      source: "slither",
    })

    store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Reentrancy vulnerability detected",
      file: "Vault.sol",
      lines: [20, 25],
      source: "slither",
    })

    const findings = store.getFindings()
    expect(findings.length).toBe(2)
  })

  test("should not deduplicate findings with different files", () => {
    const { store } = createAuditState("/test/project")

    store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Reentrancy vulnerability detected",
      file: "Vault.sol",
      lines: [10, 15],
      source: "slither",
    })

    store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Reentrancy vulnerability detected",
      file: "Token.sol",
      lines: [10, 15],
      source: "slither",
    })

    const findings = store.getFindings()
    expect(findings.length).toBe(2)
  })

  test("should not deduplicate findings with different checks", () => {
    const { store } = createAuditState("/test/project")

    store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Reentrancy vulnerability detected",
      file: "Vault.sol",
      lines: [10, 15],
      source: "slither",
    })

    store.addFinding({
      check: "unchecked-call",
      severity: "High",
      confidence: "High",
      description: "Unchecked call detected",
      file: "Vault.sol",
      lines: [10, 15],
      source: "slither",
    })

    const findings = store.getFindings()
    expect(findings.length).toBe(2)
  })

  test("should generate stable deterministic IDs", () => {
    const { store: store1 } = createAuditState("/test/project")
    const { store: store2 } = createAuditState("/test/project")

    const finding1 = store1.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Reentrancy vulnerability detected",
      file: "Vault.sol",
      lines: [10, 15],
      source: "slither",
    })

    const finding2 = store2.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Reentrancy vulnerability detected",
      file: "Vault.sol",
      lines: [10, 15],
      source: "slither",
    })

    // Same check+file+lines should produce same ID
    expect(finding1.id).toBe(finding2.id)
  })
})

describe("AuditState - Severity Filtering", () => {
  test("should filter findings by severity", () => {
    const { store } = createAuditState("/test/project")

    store.addFinding({
      check: "critical-issue",
      severity: "Critical",
      confidence: "High",
      description: "Critical issue",
      file: "Vault.sol",
      lines: [1, 5],
      source: "slither",
    })

    store.addFinding({
      check: "high-issue",
      severity: "High",
      confidence: "High",
      description: "High issue",
      file: "Vault.sol",
      lines: [6, 10],
      source: "slither",
    })

    store.addFinding({
      check: "medium-issue",
      severity: "Medium",
      confidence: "High",
      description: "Medium issue",
      file: "Vault.sol",
      lines: [11, 15],
      source: "slither",
    })

    const highSeverity = store.getFindings({ severity: "High" })
    expect(highSeverity.length).toBe(1)
    expect(highSeverity.at(0)?.check).toBe("high-issue")
  })

  test("should filter findings by source", () => {
    const { store } = createAuditState("/test/project")

    store.addFinding({
      check: "slither-issue",
      severity: "High",
      confidence: "High",
      description: "Slither issue",
      file: "Vault.sol",
      lines: [1, 5],
      source: "slither",
    })

    store.addFinding({
      check: "manual-issue",
      severity: "High",
      confidence: "High",
      description: "Manual issue",
      file: "Vault.sol",
      lines: [6, 10],
      source: "manual",
    })

    const slitherFindings = store.getFindings({ source: "slither" })
    expect(slitherFindings.length).toBe(1)
    expect(slitherFindings.at(0)?.source).toBe("slither")
  })

  test("should return all findings when no filter provided", () => {
    const { store } = createAuditState("/test/project")

    store.addFinding({
      check: "issue1",
      severity: "High",
      confidence: "High",
      description: "Issue 1",
      file: "Vault.sol",
      lines: [1, 5],
      source: "slither",
    })

    store.addFinding({
      check: "issue2",
      severity: "Medium",
      confidence: "High",
      description: "Issue 2",
      file: "Vault.sol",
      lines: [6, 10],
      source: "manual",
    })

    const allFindings = store.getFindings()
    expect(allFindings.length).toBe(2)
  })
})

describe("AuditState - hasFinding", () => {
  test("should return true for existing finding", () => {
    const { store } = createAuditState("/test/project")

    store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Reentrancy vulnerability detected",
      file: "Vault.sol",
      lines: [10, 15],
      source: "slither",
    })

    const exists = store.hasFinding("reentrancy-eth", "Vault.sol", [10, 15])
    expect(exists).toBe(true)
  })

  test("should return false for non-existing finding", () => {
    const { store } = createAuditState("/test/project")

    store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Reentrancy vulnerability detected",
      file: "Vault.sol",
      lines: [10, 15],
      source: "slither",
    })

    const exists = store.hasFinding("unchecked-call", "Vault.sol", [10, 15])
    expect(exists).toBe(false)
  })

  test("should return false for different line range", () => {
    const { store } = createAuditState("/test/project")

    store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Reentrancy vulnerability detected",
      file: "Vault.sol",
      lines: [10, 15],
      source: "slither",
    })

    const exists = store.hasFinding("reentrancy-eth", "Vault.sol", [20, 25])
    expect(exists).toBe(false)
  })
})

describe("AuditState - Serialization", () => {
  test("should serialize state for compaction", () => {
    const { state, store } = createAuditState("/test/project")

    state.contractsReviewed.push("Vault.sol", "Token.sol")

    store.addFinding({
      check: "critical-issue",
      severity: "Critical",
      confidence: "High",
      description: "Critical issue",
      file: "Vault.sol",
      lines: [1, 5],
      source: "slither",
    })

    store.addFinding({
      check: "high-issue",
      severity: "High",
      confidence: "High",
      description: "High issue",
      file: "Vault.sol",
      lines: [6, 10],
      source: "slither",
    })

    store.addFinding({
      check: "medium-issue",
      severity: "Medium",
      confidence: "High",
      description: "Medium issue",
      file: "Vault.sol",
      lines: [11, 15],
      source: "slither",
    })

    const serialized = store.serialize()

    expect(serialized).toContain("Contracts: 2")
    expect(serialized).toContain("Findings: 3")
    expect(serialized).toContain("1 Critical")
    expect(serialized).toContain("1 High")
    expect(serialized).toContain("1 Medium")
  })

  test("should serialize with correct phase", () => {
    const { state, store } = createAuditState("/test/project")
    state.currentPhase = "scanning"

    store.addFinding({
      check: "issue",
      severity: "High",
      confidence: "High",
      description: "Issue",
      file: "Vault.sol",
      lines: [1, 5],
      source: "slither",
    })

    const serialized = store.serialize()
    expect(serialized).toContain("Phase: scanning")
  })

  test("should serialize with zero findings", () => {
    const { state, store } = createAuditState("/test/project")
    state.contractsReviewed.push("Vault.sol")

    const serialized = store.serialize()
    expect(serialized).toContain("Contracts: 1")
    expect(serialized).toContain("Findings: 0")
  })

  test("should serialize with multiple severity levels", () => {
    const { state, store } = createAuditState("/test/project")
    state.contractsReviewed.push("Vault.sol")

    const severities: FindingSeverity[] = [
      "Critical",
      "Critical",
      "High",
      "Medium",
      "Low",
      "Informational",
    ]

    severities.forEach((severity, idx) => {
      store.addFinding({
        check: `issue-${idx}`,
        severity,
        confidence: "High",
        description: `Issue ${idx}`,
        file: "Vault.sol",
        lines: [idx + 1, idx + 5],
        source: "slither",
      })
    })

    const serialized = store.serialize()
    expect(serialized).toContain("2 Critical")
    expect(serialized).toContain("1 High")
    expect(serialized).toContain("1 Medium")
    expect(serialized).toContain("1 Low")
    expect(serialized).toContain("1 Informational")
  })
})

describe("AuditState - State Transitions", () => {
  test("should track current phase", () => {
    const { state } = createAuditState("/test/project")
    expect(state.currentPhase).toBe("reconnaissance")

    state.currentPhase = "scanning"
    expect(state.currentPhase).toBe("scanning")

    state.currentPhase = "reporting"
    expect(state.currentPhase).toBe("reporting")
  })

  test("should track contracts reviewed", () => {
    const { state } = createAuditState("/test/project")
    expect(state.contractsReviewed.length).toBe(0)

    state.contractsReviewed.push("Vault.sol")
    state.contractsReviewed.push("Token.sol")

    expect(state.contractsReviewed.length).toBe(2)
    expect(state.contractsReviewed).toContain("Vault.sol")
  })

  test("should track tool executions", () => {
    const { state } = createAuditState("/test/project")
    expect(state.toolsExecuted.length).toBe(0)

    state.toolsExecuted.push({
      tool: "slither",
      startTime: Date.now(),
      endTime: Date.now() + 1000,
      success: true,
      findingsCount: 5,
    })

    expect(state.toolsExecuted.length).toBe(1)
    expect(state.toolsExecuted.at(0)?.tool).toBe("slither")
  })

  test("should maintain session ID", () => {
    const { state: state1 } = createAuditState("/test/project")
    const { state: state2 } = createAuditState("/test/project")

    // Different instances should have different session IDs
    expect(state1.sessionId).not.toBe(state2.sessionId)
  })

  test("should track start time", () => {
    const before = Date.now()
    const { state } = createAuditState("/test/project")
    const after = Date.now()

    expect(state.startTime).toBeGreaterThanOrEqual(before)
    expect(state.startTime).toBeLessThanOrEqual(after)
  })
})
