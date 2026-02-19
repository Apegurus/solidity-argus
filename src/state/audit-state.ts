import { randomUUID } from "crypto";
import type { AuditState } from "./types";
import { createFindingStore, type FindingStore } from "./finding-store";

/**
 * Factory function to create a new audit state instance (NOT singleton)
 * Each call creates a fresh state with a unique session ID
 */
export function createAuditState(projectDir: string): {
  state: AuditState;
  store: FindingStore;
} {
  const state: AuditState = {
    sessionId: randomUUID(),
    projectDir,
    contractsReviewed: [],
    findings: [],
    toolsExecuted: [],
    currentPhase: "reconnaissance",
    scope: [],
    startTime: Date.now(),
    soloditResults: [],
    fuzzCounterexamples: [],
  };

  const store = createFindingStore(state);

  return { state, store };
}
