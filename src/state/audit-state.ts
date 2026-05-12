import { randomUUID } from "node:crypto"
import { createFindingStore, type FindingStore } from "./finding-store"
import type { AuditState } from "./types"

/**
 * Factory function to create a new audit state instance (NOT singleton)
 * Each call creates a fresh state with a unique session ID
 */
export function createAuditState(projectDir: string): {
  state: AuditState
  store: FindingStore
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
  }

  const store = createFindingStore(state)

  return { state, store }
}
