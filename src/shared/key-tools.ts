/**
 * Canonical list of key audit tools and mappings used by the reporting gate
 * and report preflight to determine which tools must complete before report
 * generation is allowed.
 */

/** Maps full tool names to short names used in the reporting gate. */
export const TOOL_SHORT_NAMES: Record<string, string> = {
  argus_slither_analyze: "slither",
  argus_forge_test: "forge-test",
  argus_check_patterns: "patterns",
  argus_solodit_search: "solodit",
  argus_analyze_contract: "analyzer",
}

/** The short names of tools that must complete before report generation. */
export const KEY_TOOLS = ["slither", "forge-test", "patterns", "solodit", "analyzer"]

/** Maps unavailable-tool short names to their KEY_TOOLS counterpart. */
export const UNAVAILABLE_TO_KEY_TOOL: Record<string, string> = {
  slither: "slither",
  forge: "forge-test",
  solodit: "solodit",
}

type ToolCoverageRecord = {
  tool: string
  success?: boolean
}

function keyToolName(record: ToolCoverageRecord): string {
  return TOOL_SHORT_NAMES[record.tool] ?? record.tool
}

function excusedTools(unavailableTools?: string[]): Set<string> {
  return new Set(
    (unavailableTools ?? [])
      .map((t) => UNAVAILABLE_TO_KEY_TOOL[t])
      .filter((tool): tool is string => typeof tool === "string"),
  )
}

/**
 * Compute which key tools have not yet been attempted, excusing any that are
 * declared unavailable. Failed attempts are still coverage evidence: the report
 * can disclose the limitation instead of forcing the auditor to rerun a noisy
 * tool after deduplication and perturbing the report-input parity set.
 */
export function computeMissingKeyTools(
  toolsExecuted: ToolCoverageRecord[],
  unavailableTools?: string[],
): string[] {
  const executedShortNames = new Set(toolsExecuted.map(keyToolName))
  const excused = excusedTools(unavailableTools)
  return KEY_TOOLS.filter((t) => !executedShortNames.has(t) && !excused.has(t))
}

export function computeFailedKeyTools(
  toolsExecuted: ToolCoverageRecord[],
  unavailableTools?: string[],
): string[] {
  const excused = excusedTools(unavailableTools)
  return KEY_TOOLS.filter((tool) => {
    if (excused.has(tool)) return false
    const attempts = toolsExecuted.filter((record) => keyToolName(record) === tool)
    return attempts.length > 0 && attempts.every((record) => record.success !== true)
  })
}
