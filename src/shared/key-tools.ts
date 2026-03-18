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

/**
 * Compute which key tools have not yet been executed, excusing any that are
 * declared unavailable.
 */
export function computeMissingKeyTools(
  toolsExecuted: Array<{ tool: string }>,
  unavailableTools?: string[],
): string[] {
  const executedShortNames = new Set(toolsExecuted.map((t) => TOOL_SHORT_NAMES[t.tool] ?? t.tool))
  const excused = new Set(
    (unavailableTools ?? []).map((t) => UNAVAILABLE_TO_KEY_TOOL[t]).filter(Boolean),
  )
  return KEY_TOOLS.filter((t) => !executedShortNames.has(t) && !excused.has(t))
}
