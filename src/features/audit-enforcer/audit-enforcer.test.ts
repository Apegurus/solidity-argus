import { describe, expect, it } from "bun:test"
import type { AuditState } from "../../state/types"
import { createAuditEnforcer } from "./audit-enforcer"

function makeMockState(phase: AuditState["currentPhase"] = "scanning"): AuditState {
  return {
    sessionId: "test",
    projectDir: "/tmp/test",
    contractsReviewed: ["Vault.sol"],
    findings: [
      {
        id: "f1",
        check: "reentrancy",
        severity: "High",
        confidence: "High",
        description: "test",
        file: "Vault.sol",
        lines: [1, 10] as [number, number],
        source: "slither",
      },
    ],
    toolsExecuted: [],
    currentPhase: phase,
    scope: [],
    startTime: Date.now(),
  }
}

describe("createAuditEnforcer", () => {
  it("returns continuation prompt for incomplete audit", () => {
    const enforcer = createAuditEnforcer()
    const result = enforcer(makeMockState("scanning"))

    expect(result).toContain("scanning")
    expect(result).toContain("manual-review")
    expect(result).toContain("Do not stop")
  })

  it("returns null for complete audit", () => {
    const enforcer = createAuditEnforcer()
    const result = enforcer(makeMockState("complete"))

    expect(result).toBeNull()
  })

  it("returns null when no audit state", () => {
    const enforcer = createAuditEnforcer()
    expect(enforcer(null)).toBeNull()
  })

  it("shows correct next phase for each phase", () => {
    const enforcer = createAuditEnforcer()

    expect(enforcer(makeMockState("reconnaissance"))).toContain("scanning")
    expect(enforcer(makeMockState("scanning"))).toContain("manual-review")
    expect(enforcer(makeMockState("manual-review"))).toContain("attack-surface")
    expect(enforcer(makeMockState("attack-surface"))).toContain("research")
    expect(enforcer(makeMockState("research"))).toContain("testing")
    expect(enforcer(makeMockState("testing"))).toContain("reporting")
    expect(enforcer(makeMockState("reporting"))).toContain("complete")
  })

  it("includes finding and contract counts", () => {
    const enforcer = createAuditEnforcer()
    const result = enforcer(makeMockState("scanning"))

    expect(result).toContain("1 findings")
    expect(result).toContain("1 contracts")
  })

  it("emits missing-tool reminder when in reporting phase with no tools executed", () => {
    const enforcer = createAuditEnforcer()
    const state = makeMockState("reporting")
    const result = enforcer(state)

    expect(result).toContain("Tool coverage incomplete")
    expect(result).toContain("slither")
    expect(result).toContain("forge_test")
    expect(result).toContain("forge_fuzz")
    expect(result).toContain("forge_coverage")
    expect(result).toContain("Do not proceed to report generation")
  })

  it("stays silent on missing-tool reminder when all key tools have been executed", () => {
    const enforcer = createAuditEnforcer()
    const state: AuditState = {
      ...makeMockState("complete"),
      toolsExecuted: [
        { tool: "argus_slither_analyze", startTime: 1, endTime: 2, success: true, findingsCount: 0 },
        { tool: "argus_forge_test", startTime: 1, endTime: 2, success: true, findingsCount: 0 },
        { tool: "argus_forge_fuzz", startTime: 1, endTime: 2, success: true, findingsCount: 0 },
        { tool: "argus_forge_coverage", startTime: 1, endTime: 2, success: true, findingsCount: 0 },
      ],
    }
    const result = enforcer(state)

    expect(result).toBeNull()
  })

  it("emits missing-tool reminder only for reporting/complete phases, not earlier phases", () => {
    const enforcer = createAuditEnforcer()
    const state = makeMockState("scanning")
    const result = enforcer(state)

    expect(result).not.toContain("Tool coverage incomplete")
  })
})
