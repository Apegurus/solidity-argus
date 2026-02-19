import { describe, expect, it } from "bun:test"
import { createToolErrorRecoveryHandler } from "./tool-error-recovery"
import type { AuditState } from "../../state/types"

function makeAuditState(): AuditState {
  return {
    sessionId: "s1",
    projectDir: "/tmp",
    contractsReviewed: [],
    findings: [],
    toolsExecuted: [],
    currentPhase: "scanning",
    scope: [],
    startTime: Date.now(),
  }
}

describe("createToolErrorRecoveryHandler", () => {
  it("returns slither fallback directive on ENOENT", () => {
    const handler = createToolErrorRecoveryHandler()
    const result = handler({
      tool: "argus_slither_analyze",
      result: "Error: ENOENT: slither not found",
    })

    expect(result).toContain("[Argus Fallback]")
    expect(result).toContain("Slither is unavailable")
    expect(result).toContain("argus_analyze_contract")
    expect(result).toContain("argus_check_patterns")
  })

  it("returns forge fallback directive on command failed with not found", () => {
    const handler = createToolErrorRecoveryHandler()
    const result = handler({
      tool: "argus_forge_test",
      result: "Error: command failed: forge not found",
    })

    expect(result).toContain("[Argus Fallback]")
    expect(result).toContain("Foundry/Forge is unavailable")
  })

  it("returns solodit fallback on network error with not found", () => {
    const handler = createToolErrorRecoveryHandler()
    const result = handler({
      tool: "argus_solodit_search",
      result: "Error: fetch failed - not found",
    })

    expect(result).toContain("Solodit")
    expect(result).toContain("argus_check_patterns")
  })

  it("returns null for successful tool output", () => {
    const handler = createToolErrorRecoveryHandler()
    const result = handler({
      tool: "argus_slither_analyze",
      result: "Analysis complete. Found 3 issues.",
    })

    expect(result).toBeNull()
  })

  it("returns null for unknown tool with error", () => {
    const handler = createToolErrorRecoveryHandler()
    const result = handler({
      tool: "argus_unknown_tool",
      result: "Error: something went wrong",
    })

    expect(result).toBeNull()
  })

  it("returns via_ir hint when slither output mentions via_ir", () => {
    const handler = createToolErrorRecoveryHandler()
    const result = handler({
      tool: "argus_slither_analyze",
      result: "via_ir enabled — flatten fallback failed. Ensure forge and solc are available.",
    })

    expect(result).toContain("via_ir")
    expect(result).toContain("forge-flatten fallback")
  })

  it("returns via_ir hint when slither output mentions flatten fallback", () => {
    const handler = createToolErrorRecoveryHandler()
    const result = handler({
      tool: "argus_slither_analyze",
      result: "[flatten-fallback] Analysis completed via forge flatten",
    })

    expect(result).toContain("via_ir")
  })

  it("records tool as unavailable in audit state on ENOENT", () => {
    const state = makeAuditState()
    const handler = createToolErrorRecoveryHandler(() => state)
    handler({
      tool: "argus_slither_analyze",
      result: "Error: ENOENT: slither not found",
    })

    expect(state.unavailableTools).toEqual(["slither"])
  })

  it("does not duplicate unavailable tool entries", () => {
    const state = makeAuditState()
    const handler = createToolErrorRecoveryHandler(() => state)
    handler({ tool: "argus_slither_analyze", result: "ENOENT: slither not found" })
    handler({ tool: "argus_slither_analyze", result: "ENOENT: slither not found" })

    expect(state.unavailableTools).toEqual(["slither"])
  })

  it("records multiple unavailable tools", () => {
    const state = makeAuditState()
    const handler = createToolErrorRecoveryHandler(() => state)
    handler({ tool: "argus_slither_analyze", result: "ENOENT: slither not found" })
    handler({ tool: "argus_forge_test", result: "forge not found" })

    expect(state.unavailableTools).toEqual(["slither", "forge"])
  })

  it("does not record tool when state getter is not provided", () => {
    const handler = createToolErrorRecoveryHandler()
    const result = handler({ tool: "argus_slither_analyze", result: "ENOENT: slither not found" })

    expect(result).toContain("[Argus Fallback]")
  })

  it("does not record tool when state is null", () => {
    const handler = createToolErrorRecoveryHandler(() => null)
    const result = handler({ tool: "argus_slither_analyze", result: "ENOENT: slither not found" })

    expect(result).toContain("[Argus Fallback]")
  })

  it("returns fallback with install hint on generic error", () => {
    const handler = createToolErrorRecoveryHandler()
    const result = handler({
      tool: "argus_slither_analyze",
      result: "Error: command failed with exit code 1",
    })

    expect(result).toContain("[Argus Recovery Hint]")
    expect(result).toContain("pip install slither-analyzer")
    expect(result).toContain("argus_analyze_contract")
  })
})
