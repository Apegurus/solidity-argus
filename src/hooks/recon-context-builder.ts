import type { ProjectConfig } from "../utils/project-detector"
import type { DependencyRisk } from "../utils/dependency-scanner"
import type { AuditArtifact } from "../utils/audit-artifact-detector"

export interface ReconContext {
  projectConfig: ProjectConfig | null
  dependencyRisks: DependencyRisk[]
  auditArtifacts: AuditArtifact[]
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
      lines.push(`EVM Version: ${recon.projectConfig.evmVersion}`)
    }
    if (recon.projectConfig.isUpgradeable) {
      lines.push(`Upgradeable: yes`)
    }
    if (recon.projectConfig.profiles && recon.projectConfig.profiles.length > 0) {
      lines.push(`Profiles: ${recon.projectConfig.profiles.join(", ")}`)
    }
  }

  if (recon.dependencyRisks.length > 0) {
    lines.push("Dependency Risks:")
    for (const risk of recon.dependencyRisks.slice(0, 5)) {
      lines.push(`  - ${risk.package}@${risk.version}: ${risk.risk}`)
    }
  }

  if (recon.auditArtifacts.length > 0) {
    lines.push("Existing Audit Artifacts:")
    for (const artifact of recon.auditArtifacts.slice(0, 5)) {
      lines.push(`  - ${artifact.type}: ${artifact.path}`)
    }
  }

  lines.push("</argus-recon>")
  return lines.join("\n")
}
