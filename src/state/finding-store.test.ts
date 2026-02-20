import { describe, expect, test } from "bun:test";
import { createFindingStore } from "./finding-store";
import type { AuditState, Finding } from "./types";

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
  };
}

function createPersistedFinding(
  check: string,
  file: string,
  lines: [number, number]
): Finding {
  return {
    id: `persisted-${check}-${file}-${lines[0]}-${lines[1]}`,
    check,
    severity: "High",
    confidence: "High",
    description: `${check} finding`,
    file,
    lines,
    source: "slither",
  };
}

describe("FindingStore - Hydration", () => {
  test("should deduplicate re-adds from hydrated persisted findings", () => {
    const persistedFindings = [
      createPersistedFinding("reentrancy-eth", "Vault.sol", [10, 15]),
      createPersistedFinding("unchecked-call", "Token.sol", [20, 24]),
      createPersistedFinding("tx-origin", "Auth.sol", [5, 9]),
    ];
    const state = createBaseState(persistedFindings);
    const store = createFindingStore(state);

    store.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "reentrancy-eth finding",
      file: "Vault.sol",
      lines: [10, 15],
      source: "slither",
    });

    store.addFinding({
      check: "unchecked-call",
      severity: "High",
      confidence: "High",
      description: "unchecked-call finding",
      file: "Token.sol",
      lines: [20, 24],
      source: "slither",
    });

    store.addFinding({
      check: "tx-origin",
      severity: "High",
      confidence: "High",
      description: "tx-origin finding",
      file: "Auth.sol",
      lines: [5, 9],
      source: "slither",
    });

    expect(state.findings.length).toBe(3);
  });

  test("should report hydrated findings via hasFinding", () => {
    const persistedFindings = [
      createPersistedFinding("reentrancy-eth", "Vault.sol", [10, 15]),
      createPersistedFinding("unchecked-call", "Token.sol", [20, 24]),
      createPersistedFinding("tx-origin", "Auth.sol", [5, 9]),
    ];
    const state = createBaseState(persistedFindings);
    const store = createFindingStore(state);

    expect(store.hasFinding("reentrancy-eth", "Vault.sol", [10, 15])).toBe(true);
    expect(store.hasFinding("unchecked-call", "Token.sol", [20, 24])).toBe(true);
    expect(store.hasFinding("tx-origin", "Auth.sol", [5, 9])).toBe(true);
  });

  test("should skip malformed findings while hydrating", () => {
    const validFinding = createPersistedFinding("reentrancy-eth", "Vault.sol", [10, 15]);
    const malformedFindings = [
      {
        ...createPersistedFinding("bad-check", "Vault.sol", [1, 2]),
        check: "",
      },
      {
        ...createPersistedFinding("bad-file", "Vault.sol", [3, 4]),
        file: "",
      },
      {
        ...createPersistedFinding("bad-lines", "Vault.sol", [5, 6]),
        lines: [5] as unknown as [number, number],
      },
    ];

    const state = createBaseState([
      validFinding,
      ...(malformedFindings as unknown as Finding[]),
    ]);
    const store = createFindingStore(state);

    expect(store.hasFinding("reentrancy-eth", "Vault.sol", [10, 15])).toBe(true);
    expect(store.hasFinding("bad-check", "Vault.sol", [1, 2])).toBe(false);
    expect(store.hasFinding("bad-file", "", [3, 4])).toBe(false);
    expect(store.hasFinding("bad-lines", "Vault.sol", [5, 6])).toBe(false);
  });

  test("should keep deduplication after serialize and rehydrate round trip", () => {
    const originalState = createBaseState();
    const originalStore = createFindingStore(originalState);

    originalStore.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "reentrancy-eth finding",
      file: "Vault.sol",
      lines: [10, 15],
      source: "slither",
    });

    originalStore.addFinding({
      check: "unchecked-call",
      severity: "High",
      confidence: "High",
      description: "unchecked-call finding",
      file: "Token.sol",
      lines: [20, 24],
      source: "slither",
    });

    originalStore.addFinding({
      check: "tx-origin",
      severity: "High",
      confidence: "High",
      description: "tx-origin finding",
      file: "Auth.sol",
      lines: [5, 9],
      source: "slither",
    });

    const serialized = JSON.stringify(originalState);
    const restoredState = JSON.parse(serialized) as AuditState;
    const restoredStore = createFindingStore(restoredState);

    restoredStore.addFinding({
      check: "reentrancy-eth",
      severity: "High",
      confidence: "High",
      description: "reentrancy-eth finding",
      file: "Vault.sol",
      lines: [10, 15],
      source: "slither",
    });

    restoredStore.addFinding({
      check: "unchecked-call",
      severity: "High",
      confidence: "High",
      description: "unchecked-call finding",
      file: "Token.sol",
      lines: [20, 24],
      source: "slither",
    });

    restoredStore.addFinding({
      check: "tx-origin",
      severity: "High",
      confidence: "High",
      description: "tx-origin finding",
      file: "Auth.sol",
      lines: [5, 9],
      source: "slither",
    });

    expect(restoredState.findings.length).toBe(3);
    expect(restoredStore.hasFinding("reentrancy-eth", "Vault.sol", [10, 15])).toBe(
      true
    );
  });
});
