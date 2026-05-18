import { PHASE_ORDER } from "../../shared/audit-phases"
import { computeMissingKeyTools } from "../../shared/key-tools"
import type { AuditPhase, AuditState } from "../../state/types"

const REPORTING_PHASES: AuditPhase[] = ["reporting", "complete"]

function getNextPhase(current: AuditPhase): AuditPhase | null {
  const idx = PHASE_ORDER.indexOf(current)
  if (idx === -1 || idx >= PHASE_ORDER.length - 1) return null
  return PHASE_ORDER[idx + 1] ?? null
}

export function createAuditEnforcer() {
  return (auditState: AuditState | null): string | null => {
    if (!auditState) return null
    if (auditState.currentPhase === "complete") return null

    const nextPhase = getNextPhase(auditState.currentPhase)
    if (!nextPhase) return null

    const parts: string[] = [
      `[Argus Audit Enforcer] Audit in progress — current phase: ${auditState.currentPhase}.`,
      `Next phase: ${nextPhase}. Do not stop until audit is complete.`,
      `Progress: ${auditState.findings.length} findings, ${auditState.contractsReviewed.length} contracts reviewed.`,
    ]

    if (REPORTING_PHASES.includes(auditState.currentPhase)) {
      const missing = computeMissingKeyTools(auditState.toolsExecuted, auditState.unavailableTools)
      if (missing.length > 0) {
        parts.push(
          `\u26a0\ufe0f Tool coverage incomplete: ${missing.join(", ")} have not been executed. Do not proceed to report generation until required tools are complete.`,
        )
      }
    }

    return parts.join(" ")
  }
}
