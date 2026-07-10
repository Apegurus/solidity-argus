import { escapeMarkdown } from "../shared/untrusted-content"
import type { AuditArtifact } from "../utils/audit-artifact-detector"
import type { DependencyRisk } from "../utils/dependency-scanner"
import type { ProjectConfig } from "../utils/project-detector"

export interface ReconContext {
  projectConfig: ProjectConfig | null
  dependencyRisks: DependencyRisk[]
  auditArtifacts: AuditArtifact[]
}

const MAX_RECON_VALUE_LEN = 256

// Security: project-derived strings (package names, foundry.toml values, artifact
// paths) are attacker-influenced yet injected into the agent-facing <argus-recon>
// block. Escape Markdown/tag structure and collapse newlines so a value cannot forge
// the closing tag or add a standalone instruction line; length-cap to bound size.
function sanitizeReconValue(value: string): string {
  return escapeMarkdown(value.slice(0, MAX_RECON_VALUE_LEN)).replace(/[\r\n]+/g, " ")
}

/**
 * Builds an XML-like reconnaissance context block from project data.
 * Returns null if no data is available (all fields empty/null).
 *
 * The block is injected into compaction output so Argus agents retain
 * project intelligence across context window compressions.
 */
export function buildReconContextBlock(recon: ReconContext): string | null {
  if (
    !recon.projectConfig &&
    recon.dependencyRisks.length === 0 &&
    recon.auditArtifacts.length === 0
  ) {
    return null
  }

  const lines: string[] = ["<argus-recon>"]

  if (recon.projectConfig) {
    const frameworks: string[] = []
    if (recon.projectConfig.hasFoundry) frameworks.push("Foundry")
    if (recon.projectConfig.hasHardhat) frameworks.push("Hardhat")
    if (frameworks.length > 0) {
      lines.push(`Framework: ${frameworks.join(", ")}`)
    }
    if (recon.projectConfig.optimizer) {
      lines.push(`Optimizer: runs=${recon.projectConfig.optimizer.runs}`)
    }
    if (recon.projectConfig.evmVersion) {
      lines.push(`EVM Version: ${sanitizeReconValue(recon.projectConfig.evmVersion)}`)
    }
    if (recon.projectConfig.isUpgradeable) {
      lines.push(`Upgradeable: yes`)
    }
    if (recon.projectConfig.profiles && recon.projectConfig.profiles.length > 0) {
      lines.push(`Profiles: ${recon.projectConfig.profiles.map(sanitizeReconValue).join(", ")}`)
    }
  }

  if (recon.dependencyRisks.length > 0) {
    lines.push("Dependency Risks:")
    for (const risk of recon.dependencyRisks.slice(0, 5)) {
      lines.push(
        `  - ${sanitizeReconValue(risk.package)}@${sanitizeReconValue(risk.version)}: ${risk.risk}`,
      )
    }
  }

  if (recon.auditArtifacts.length > 0) {
    lines.push("Existing Audit Artifacts:")
    for (const artifact of recon.auditArtifacts.slice(0, 5)) {
      lines.push(`  - ${artifact.type}: ${sanitizeReconValue(artifact.path)}`)
    }
  }

  lines.push("</argus-recon>")
  return lines.join("\n")
}
