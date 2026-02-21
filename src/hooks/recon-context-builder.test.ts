import { describe, expect, test } from "bun:test"
import type { AuditArtifact } from "../utils/audit-artifact-detector"
import type { DependencyRisk } from "../utils/dependency-scanner"
import type { ProjectConfig } from "../utils/project-detector"
import type { ReconContext } from "./recon-context-builder"
import { buildReconContextBlock } from "./recon-context-builder"

function makeProjectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    type: "foundry",
    srcDir: "src",
    testDir: "test",
    remappings: [],
    viaIr: false,
    rootDir: "/tmp/test",
    hasFoundry: true,
    hasHardhat: false,
    isUpgradeable: false,
    dependencyRisks: [],
    ...overrides,
  }
}

function makeRisk(overrides: Partial<DependencyRisk> = {}): DependencyRisk {
  return {
    package: "@openzeppelin/contracts",
    version: "4.8.0",
    risk: "high",
    category: "known-vulnerability",
    recommendation: "Upgrade to >= 4.9.0",
    ...overrides,
  }
}

function makeArtifact(overrides: Partial<AuditArtifact> = {}): AuditArtifact {
  return {
    type: "audit-report",
    path: "/tmp/test/audit/report.md",
    name: "report.md",
    ...overrides,
  }
}

describe("buildReconContextBlock", () => {
  test("returns null when no data is available", () => {
    const recon: ReconContext = {
      projectConfig: null,
      dependencyRisks: [],
      auditArtifacts: [],
    }
    expect(buildReconContextBlock(recon)).toBeNull()
  })

  test("includes framework info for Foundry project", () => {
    const recon: ReconContext = {
      projectConfig: makeProjectConfig({ hasFoundry: true, hasHardhat: false }),
      dependencyRisks: [],
      auditArtifacts: [],
    }
    const result = buildReconContextBlock(recon)
    expect(result).toContain("<argus-recon>")
    expect(result).toContain("</argus-recon>")
    expect(result).toContain("Framework: Foundry")
  })

  test("includes framework info for mixed project", () => {
    const recon: ReconContext = {
      projectConfig: makeProjectConfig({ hasFoundry: true, hasHardhat: true }),
      dependencyRisks: [],
      auditArtifacts: [],
    }
    const result = buildReconContextBlock(recon)
    expect(result).toContain("Framework: Foundry, Hardhat")
  })

  test("includes optimizer, evm version, upgradeable, and profiles", () => {
    const recon: ReconContext = {
      projectConfig: makeProjectConfig({
        optimizer: { enabled: true, runs: 200 },
        evmVersion: "paris",
        isUpgradeable: true,
        profiles: ["default", "ci"],
      }),
      dependencyRisks: [],
      auditArtifacts: [],
    }
    const result = buildReconContextBlock(recon)
    expect(result).toContain("Optimizer: runs=200")
    expect(result).toContain("EVM Version: paris")
    expect(result).toContain("Upgradeable: yes")
    expect(result).toContain("Profiles: default, ci")
  })

  test("includes dependency risks", () => {
    const recon: ReconContext = {
      projectConfig: null,
      dependencyRisks: [
        makeRisk({ package: "@openzeppelin/contracts", version: "4.8.0", risk: "high" }),
        makeRisk({ package: "solmate", version: "5.0.0", risk: "medium" }),
      ],
      auditArtifacts: [],
    }
    const result = buildReconContextBlock(recon)
    expect(result).toContain("Dependency Risks:")
    expect(result).toContain("@openzeppelin/contracts@4.8.0: high")
    expect(result).toContain("solmate@5.0.0: medium")
  })

  test("includes audit artifacts", () => {
    const recon: ReconContext = {
      projectConfig: null,
      dependencyRisks: [],
      auditArtifacts: [
        makeArtifact({ type: "audit-report", path: "/project/audit/report.md" }),
        makeArtifact({ type: "slither-output", path: "/project/slither.json" }),
      ],
    }
    const result = buildReconContextBlock(recon)
    expect(result).toContain("Existing Audit Artifacts:")
    expect(result).toContain("audit-report: /project/audit/report.md")
    expect(result).toContain("slither-output: /project/slither.json")
  })

  test("truncates dependency risks to 5 items", () => {
    const risks: DependencyRisk[] = Array.from({ length: 8 }, (_, i) =>
      makeRisk({ package: `pkg-${i}`, version: `${i}.0.0` }),
    )
    const recon: ReconContext = {
      projectConfig: null,
      dependencyRisks: risks,
      auditArtifacts: [],
    }
    const result = buildReconContextBlock(recon)
    expect(result).not.toBeNull()
    if (!result) return
    const riskLines = result.split("\n").filter((l) => l.startsWith("  - pkg-"))
    expect(riskLines).toHaveLength(5)
    expect(result).toContain("pkg-0")
    expect(result).toContain("pkg-4")
    expect(result).not.toContain("pkg-5")
  })

  test("truncates audit artifacts to 5 items", () => {
    const artifacts: AuditArtifact[] = Array.from({ length: 7 }, (_, i) =>
      makeArtifact({ path: `/project/artifact-${i}.md`, name: `artifact-${i}.md` }),
    )
    const recon: ReconContext = {
      projectConfig: null,
      dependencyRisks: [],
      auditArtifacts: artifacts,
    }
    const result = buildReconContextBlock(recon)
    expect(result).not.toBeNull()
    if (!result) return
    const artifactLines = result.split("\n").filter((l) => l.includes("artifact-"))
    expect(artifactLines).toHaveLength(5)
    expect(result).toContain("artifact-0")
    expect(result).toContain("artifact-4")
    expect(result).not.toContain("artifact-5")
  })

  test("does not include Upgradeable line when not upgradeable", () => {
    const recon: ReconContext = {
      projectConfig: makeProjectConfig({ isUpgradeable: false }),
      dependencyRisks: [],
      auditArtifacts: [],
    }
    const result = buildReconContextBlock(recon)
    expect(result).not.toContain("Upgradeable")
  })
})
