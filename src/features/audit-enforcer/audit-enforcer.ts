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

const REPORTING_PHASES: AuditPhase[] = ["reporting", "complete"]

const KEY_TOOL_FAMILIES: Array<{ family: string; prefixes: string[] }> = [
  { family: "slither", prefixes: ["argus_slither_analyze", "slither"] },
  { family: "forge_test", prefixes: ["argus_forge_test", "forge_test"] },
  { family: "forge_fuzz", prefixes: ["argus_forge_fuzz", "forge_fuzz"] },
  { family: "forge_coverage", prefixes: ["argus_forge_coverage", "forge_coverage"] },
]

function getMissingToolFamilies(auditState: AuditState): string[] {
  const executedTools = auditState.toolsExecuted.map((t) => t.tool)
  return KEY_TOOL_FAMILIES.filter(
    ({ prefixes }) =>
      !executedTools.some((tool) => prefixes.some((prefix) => tool.startsWith(prefix))),
  ).map(({ family }) => family)
}

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
      const missing = getMissingToolFamilies(auditState)
      if (missing.length > 0) {
        parts.push(
          `\u26a0\ufe0f Tool coverage incomplete: ${missing.join(", ")} have not been executed. Do not proceed to report generation until required tools are complete.`,
        )
      }
    }

    return parts.join(" ")
  }
}
