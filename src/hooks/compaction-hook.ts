import type { AuditState, FindingSeverity } from "../state/types"

/**
 * Creates a compaction hook that serializes audit state into XML format
 * so findings survive context window compression.
 *
 * The returned hook is called by OpenCode's `experimental.session.compacting`
 * event, receiving `{ summary: string }` and returning the enriched summary.
 */
export function createCompactionHook(
  getAuditState: () => AuditState | null
): (input: { summary: string }) => Promise<string | null> {
  return async (_input: { summary: string }): Promise<string | null> => {
    const state = getAuditState()
    if (!state) {
      return null
    }

    const severityCounts: Record<FindingSeverity, number> = {
      Critical: 0,
      High: 0,
      Medium: 0,
      Low: 0,
      Informational: 0,
    }

    for (const finding of state.findings) {
      severityCounts[finding.severity]++
    }

    const toolNames = state.toolsExecuted.map((t) => t.tool).join(", ")
    const contracts = state.contractsReviewed.join(", ")
    const started = new Date(state.startTime).toISOString()

    return [
      "<argus-audit-state>",
      `Phase: ${state.currentPhase}`,
      `Contracts Reviewed: ${contracts}`,
      "Findings:",
      `  Critical: ${severityCounts.Critical}`,
      `  High: ${severityCounts.High}`,
      `  Medium: ${severityCounts.Medium}`,
      `  Low: ${severityCounts.Low}`,
      `  Informational: ${severityCounts.Informational}`,
      `Tools Executed: ${toolNames}`,
      `Started: ${started}`,
      "</argus-audit-state>",
    ].join("\n")
  }
}
