import type { AuditPhase, AuditState } from "../../state/types"

const PHASE_ORDER: AuditPhase[] = [
  "reconnaissance",
  "scanning",
  "manual-review",
  "attack-surface",
  "research",
  "testing",
  "reporting",
  "complete",
]

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

    return [
      `[Argus Audit Enforcer] Audit in progress — current phase: ${auditState.currentPhase}.`,
      `Next phase: ${nextPhase}. Do not stop until audit is complete.`,
      `Progress: ${auditState.findings.length} findings, ${auditState.contractsReviewed.length} contracts reviewed.`,
    ].join(" ")
  }
}
