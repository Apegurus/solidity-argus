import { describe, expect, test } from "bun:test"
import { createFindingStore } from "./finding-store"
import type { AuditState, Finding } from "./types"

function createBaseState(findings: Finding[] = []): AuditState {
  return {
    sessionId: "test-session",
    projectDir: "/test/project",
    contractsReviewed: [],
    findings,
    toolsExecuted: [],
    currentPhase: "reconnaissance",
    scope: [],
    startTime: 1,
    soloditResults: [],
    fuzzCounterexamples: [],
  }
}

function createPersistedFinding(check: string, file: string, lines: [number, number]): Finding {
  return {
    id: `persisted-${check}-${file}-${lines[0]}-${lines[1]}`,
    check,
    severity: "High",
    confidence: "High",
    description: `${check} finding`,
    file,
    lines,
    source: "slither",
  }
}

describe("FindingStore", () => {
  test("generateObservationId produces same ID for same content", () => {
    const state = createBaseState()
    const store = createFindingStore(state)

    const first = store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "First observation",
      file: "Vault.sol",
      lines: [10, 15],
      source: "slither",
    })

    const second = store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "Second observation",
      file: "Vault.sol",
      lines: [10, 15],
      source: "manual",
    })

    expect(state.findings.length).toBe(2)
    expect(first.id).toBe(second.id)
  })

  test("generateObservationId produces different IDs for different content", () => {
    const state = createBaseState()
    const store = createFindingStore(state)

    const first = store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "First observation",
      file: "Vault.sol",
      lines: [10, 15],
      source: "slither",
    })

    const second = store.addFinding({
      check: "unchecked-call",
      severity: "High",
      confidence: "High",
      description: "Same file and lines, different check",
      file: "Vault.sol",
      lines: [10, 15],
      source: "manual",
    })

    expect(first.id).not.toBe(second.id)
  })

  test("generateObservationId does not use a counter", () => {
    const state = createBaseState()
    const store = createFindingStore(state)

    const ids = new Set<string>()

    for (let i = 0; i < 100; i += 1) {
      const finding = store.addFinding({
        check: "reentrancy-eth",
        severity: "High",
        confidence: "High",
        description: `Observation ${i}`,
        file: "Vault.sol",
        lines: [10, 15],
        source: "manual",
      })
      ids.add(finding.id)
    }

    expect(ids.size).toBe(1)
  })

  test("hydrates persisted findings and supports hasFinding", () => {
    const state = createBaseState([
      createPersistedFinding("reentrancy-eth", "Vault.sol", [10, 15]),
      createPersistedFinding("unchecked-call", "Token.sol", [20, 24]),
    ])
    const store = createFindingStore(state)

    expect(store.hasFinding("reentrancy-eth", "Vault.sol", [10, 15])).toBe(true)
    expect(store.hasFinding("unchecked-call", "Token.sol", [20, 24])).toBe(true)
  })

  test("ignores malformed persisted findings during hydration", () => {
    const validFinding = createPersistedFinding("reentrancy-eth", "Vault.sol", [10, 15])
    const malformed = {
      ...createPersistedFinding("bad", "Vault.sol", [1, 2]),
      lines: [1] as unknown as [number, number],
    }

    const state = createBaseState([validFinding, malformed as unknown as Finding])
    const store = createFindingStore(state)

    expect(store.hasFinding("reentrancy-eth", "Vault.sol", [10, 15])).toBe(true)
    expect(store.hasFinding("bad", "Vault.sol", [1, 2])).toBe(false)
  })

  test("serialize reflects observation counts", () => {
    const state = createBaseState()
    const store = createFindingStore(state)

    store.addFinding({
      check: "issue-a",
      severity: "High",
      confidence: "High",
      description: "issue a",
      file: "A.sol",
      lines: [1, 1],
      source: "manual",
    })

    store.addFinding({
      check: "issue-a",
      severity: "High",
      confidence: "High",
      description: "issue a duplicate observation",
      file: "A.sol",
      lines: [1, 1],
      source: "manual",
    })

    expect(store.serialize()).toContain("Findings: 2")
  })
})
