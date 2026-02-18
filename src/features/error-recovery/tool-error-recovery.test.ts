import { describe, expect, it } from "bun:test"
import { createToolErrorRecoveryHandler } from "./tool-error-recovery"

describe("createToolErrorRecoveryHandler", () => {
  it("returns slither install hint on ENOENT", () => {
    const handler = createToolErrorRecoveryHandler()
    const result = handler({
      tool: "argus_slither_analyze",
      result: "Error: ENOENT: slither not found",
    })

    expect(result).toContain("pip install slither-analyzer")
  })

  it("returns forge install hint on command failed", () => {
    const handler = createToolErrorRecoveryHandler()
    const result = handler({
      tool: "argus_forge_test",
      result: "Error: command failed: forge not found",
    })

    expect(result).toContain("foundryup")
  })

  it("returns solodit hint on network error", () => {
    const handler = createToolErrorRecoveryHandler()
    const result = handler({
      tool: "argus_solodit_search",
      result: "Error: fetch failed - not found",
    })

    expect(result).toContain("Solodit API")
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
})
