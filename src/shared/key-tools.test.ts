import { describe, expect, test } from "bun:test"
import { computeMissingKeyTools } from "./key-tools"

describe("computeMissingKeyTools", () => {
  test("counts only successful executions as satisfying required tools", () => {
    const missing = computeMissingKeyTools([
      { tool: "argus_slither_analyze", success: false },
      { tool: "argus_forge_test", success: true },
      { tool: "argus_check_patterns", success: true },
      { tool: "argus_solodit_search", success: true },
      { tool: "argus_analyze_contract", success: true },
    ])

    expect(missing).toEqual(["slither"])
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
