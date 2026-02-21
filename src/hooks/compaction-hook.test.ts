import { describe, expect, test } from "bun:test"
import type { AuditState, Finding } from "../state/types"
import type { ProjectConfig } from "../utils/project-detector"
import { createCompactionHook } from "./compaction-hook"
import type { ReconContext } from "./recon-context-builder"

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "abc123",
    check: "reentrancy-eth",
    severity: "Medium",
    confidence: "High",
    description: "Reentrancy vulnerability",
    file: "src/Vault.sol",
    lines: [10, 20] as [number, number],
    source: "slither",
    ...overrides,
  }
}

function makeState(overrides: Partial<AuditState> = {}): AuditState {
  return {
    sessionId: "test-session-1",
    projectDir: "/tmp/test-project",
    contractsReviewed: [],
    findings: [],
    toolsExecuted: [],
    currentPhase: "reconnaissance",
    scope: [],
    startTime: Date.now(),
    ...overrides,
  }
}

describe("createCompactionHook", () => {
  test("returns null when no audit state", async () => {
    const hook = createCompactionHook(() => null)
    const result = await hook({ summary: "This is the original summary." })
    expect(result).toBeNull()
  })

  test("prepends XML block when audit active", async () => {
    const state = makeState()
    const hook = createCompactionHook(() => state)
    const result = await hook({ summary: "original" })
    expect(result).toStartWith("<argus-audit-state>")
  })

  test("finding counts by severity correct", async () => {
    const state = makeState({
      findings: [
        makeFinding({ id: "f1", severity: "Critical" }),
        makeFinding({ id: "f2", severity: "Critical" }),
        makeFinding({ id: "f3", severity: "High" }),
      ],
    })
    const hook = createCompactionHook(() => state)
    const result = await hook({ summary: "s" })
    expect(result).toContain("Critical: 2")
    expect(result).toContain("High: 1")
    expect(result).toContain("Medium: 0")
    expect(result).toContain("Low: 0")
    expect(result).toContain("Informational: 0")
  })

  test("contracts listed", async () => {
    const state = makeState({
      contractsReviewed: ["Vault.sol", "Token.sol"],
    })
    const hook = createCompactionHook(() => state)
    const result = await hook({ summary: "s" })
    expect(result).toContain("Vault.sol")
    expect(result).toContain("Token.sol")
  })

  test("XML is parseable", async () => {
    const state = makeState()
    const hook = createCompactionHook(() => state)
    const result = await hook({ summary: "s" })
    expect(result).not.toBeNull()
    expect(result).toContain("<argus-audit-state>")
    expect(result).toContain("</argus-audit-state>")
    if (!result) return

    const openIdx = result.indexOf("<argus-audit-state>")
    const closeIdx = result.indexOf("</argus-audit-state>")
    expect(openIdx).toBeLessThan(closeIdx)
  })

  test("returns only XML block without original summary", async () => {
    const state = makeState()
    const hook = createCompactionHook(() => state)
    const result = await hook({ summary: "Important audit context about the Vault contract." })
    expect(result).toContain("<argus-audit-state>")
    expect(result).not.toContain("Important audit context")
  })

  test("phase included", async () => {
    const state = makeState({ currentPhase: "manual-review" })
    const hook = createCompactionHook(() => state)
    const result = await hook({ summary: "s" })
    expect(result).toContain("Phase: manual-review")
  })

  test("includes reconnaissance block when provided", async () => {
    const state = makeState()
    const recon: ReconContext = {
      projectConfig: {
        type: "foundry",
        srcDir: "src",
        testDir: "test",
        remappings: [],
        viaIr: false,
        rootDir: "/tmp",
        hasFoundry: true,
        hasHardhat: false,
        isUpgradeable: false,
        dependencyRisks: [],
      } satisfies ProjectConfig,
      dependencyRisks: [
        {
          package: "@openzeppelin/contracts",
          version: "4.8.0",
          risk: "high",
          category: "known-vulnerability",
          recommendation: "Upgrade",
        },
      ],
      auditArtifacts: [],
    }
    const hook = createCompactionHook(
      () => state,
      () => recon,
    )
    const result = await hook({ summary: "s" })
    expect(result).toContain("<argus-audit-state>")
    expect(result).toContain("<argus-recon>")
    expect(result).toContain("Framework: Foundry")
    expect(result).toContain("@openzeppelin/contracts@4.8.0: high")
  })

  test("works without reconnaissance (backward compat)", async () => {
    const state = makeState({ currentPhase: "scanning" })
    const hook = createCompactionHook(() => state)
    const result = await hook({ summary: "s" })
    expect(result).toContain("<argus-audit-state>")
    expect(result).toContain("Phase: scanning")
    expect(result).not.toContain("<argus-recon>")
  })

  test("returns recon block alone when no audit state", async () => {
    const recon: ReconContext = {
      projectConfig: null,
      dependencyRisks: [],
      auditArtifacts: [{ type: "slither-output", path: "/tmp/slither.json", name: "slither.json" }],
    }
    const hook = createCompactionHook(
      () => null,
      () => recon,
    )
    const result = await hook({ summary: "s" })
    expect(result).not.toContain("<argus-audit-state>")
    expect(result).toContain("<argus-recon>")
    expect(result).toContain("slither-output: /tmp/slither.json")
  })

  test("returns null when no state and recon returns null", async () => {
    const hook = createCompactionHook(
      () => null,
      () => null,
    )
    const result = await hook({ summary: "s" })
    expect(result).toBeNull()
  })
})
