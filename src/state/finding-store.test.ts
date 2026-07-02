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

    expect(state.findings.length).toBe(1)
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

  test("hasFinding normalizes check and file case", () => {
    const state = createBaseState([
      createPersistedFinding("Reentrancy-Eth", "src/Vault.sol", [10, 15]),
    ])
    const store = createFindingStore(state)

    // Exact match
    expect(store.hasFinding("Reentrancy-Eth", "src/Vault.sol", [10, 15])).toBe(true)
    // Different case
    expect(store.hasFinding("reentrancy-eth", "src/Vault.sol", [10, 15])).toBe(true)
    expect(store.hasFinding("REENTRANCY-ETH", "SRC/VAULT.SOL", [10, 15])).toBe(true)
    // With whitespace
    expect(store.hasFinding("  reentrancy-eth  ", "  src/Vault.sol  ", [10, 15])).toBe(true)
    // Different lines still not a match
    expect(store.hasFinding("reentrancy-eth", "src/Vault.sol", [10, 16])).toBe(false)
  })

  test("generateObservationId normalizes case for same-content detection", () => {
    const state = createBaseState()
    const store = createFindingStore(state)

    const lower = store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "lowercase check",
      file: "src/vault.sol",
      lines: [10, 15],
      source: "slither",
    })

    const upper = store.addFinding({
      check: "Reentrancy-Eth",
      severity: "High",
      confidence: "High",
      description: "mixed case check",
      file: "src/Vault.sol",
      lines: [10, 15],
      source: "manual",
    })

    // Same observation ID despite different casing
    expect(lower.id).toBe(upper.id)
  })

  test("addFinding deduplicates by check+file+lines", () => {
    const state = createBaseState()
    const store = createFindingStore(state)

    const finding = {
      check: "reentrancy-eth",
      severity: "High" as const,
      confidence: "High" as const,
      description: "Reentrancy in withdraw()",
      file: "src/Vault.sol",
      lines: [10, 20] as [number, number],
      source: "slither" as const,
    }

    const first = store.addFinding(finding)
    const second = store.addFinding(finding)

    expect(second.id).toBe(first.id)
    expect(store.getFindings()).toHaveLength(1)
    expect(state.findings).toHaveLength(1)
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

    expect(store.serialize()).toContain("Findings: 1")
  })

  test("addFinding dedupes against a hydrated finding stored under a different id scheme (WS-5 #25)", () => {
    const state = createBaseState([
      createPersistedFinding("reentrancy-eth", "src/Vault.sol", [10, 15]),
    ])
    const store = createFindingStore(state)

    const added = store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "same logical finding, recorded live",
      file: "src/Vault.sol",
      lines: [10, 15],
      source: "slither",
    })

    expect(store.getFindings()).toHaveLength(1)
    expect(state.findings).toHaveLength(1)
    expect(added.id).toBe("persisted-reentrancy-eth-src/Vault.sol-10-15")
  })

  test("hasFinding matches an absolute path against a finding stored as relative (WS-5 #26)", () => {
    const state = createBaseState()
    const store = createFindingStore(state)
    store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "recorded with an absolute path",
      file: "/test/project/src/Vault.sol",
      lines: [10, 15],
      source: "slither",
    })

    expect(store.hasFinding("reentrancy-eth", "/test/project/src/Vault.sol", [10, 15])).toBe(true)
    expect(store.hasFinding("reentrancy-eth", "src/Vault.sol", [10, 15])).toBe(true)
  })
})
