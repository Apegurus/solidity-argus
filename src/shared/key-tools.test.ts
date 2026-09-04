import { describe, expect, test } from "bun:test"
import { computeFailedKeyTools, computeMissingKeyTools } from "./key-tools"

describe("computeMissingKeyTools", () => {
  test("counts failed attempts as executed coverage", () => {
    const missing = computeMissingKeyTools([
      { tool: "argus_slither_analyze", success: false },
      { tool: "argus_forge_test", success: true },
      { tool: "argus_check_patterns", success: true },
      { tool: "argus_solodit_search", success: true },
      { tool: "argus_analyze_contract", success: true },
    ])

    expect(missing).toEqual([])
  })

  test("keeps unavailable tools excused even when not executed", () => {
    const missing = computeMissingKeyTools(
      [
        { tool: "argus_forge_test", success: true },
        { tool: "argus_check_patterns", success: true },
        { tool: "argus_solodit_search", success: true },
        { tool: "argus_analyze_contract", success: true },
      ],
      ["slither"],
    )

    expect(missing).toEqual([])
  })
})

describe("computeFailedKeyTools", () => {
  test("reports attempted key tools that never succeeded", () => {
    const failed = computeFailedKeyTools([
      { tool: "argus_slither_analyze", success: false },
      { tool: "argus_forge_test", success: true },
      { tool: "argus_check_patterns", success: false },
      { tool: "argus_solodit_search", success: true },
      { tool: "argus_analyze_contract", success: true },
    ])

    expect(failed).toEqual(["slither", "patterns"])
  })

  test("does not report a failed attempt when a later attempt succeeded", () => {
    const failed = computeFailedKeyTools([
      { tool: "argus_check_patterns", success: false },
      { tool: "argus_check_patterns", success: true },
    ])

    expect(failed).toEqual([])
  })
})
