import type { AuditState, FindingSeverity } from "../state/types"
import type { ReconContext } from "./recon-context-builder"
import { buildReconContextBlock } from "./recon-context-builder"

export function createCompactionHook(
  getAuditState: (sessionId?: string) => AuditState | null,
  getReconContext?: () => ReconContext | null,
): (input: { summary: string; sessionId?: string }) => Promise<string | null> {
  return async (input: { summary: string; sessionId?: string }): Promise<string | null> => {
    const state = getAuditState(input.sessionId)

    const parts: string[] = []

    if (state) {
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

      parts.push(
        [
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
        ].join("\n"),
      )
    }

    if (getReconContext) {
      const recon = getReconContext()
      if (recon) {
        const reconBlock = buildReconContextBlock(recon)
        if (reconBlock) parts.push(reconBlock)
      }
    }

    return parts.length > 0 ? parts.join("\n") : null
  }
}
