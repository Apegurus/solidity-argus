import { createLogger } from "../../shared/logger"
import type { AuditState } from "../../state/types"

type ToolFallbackEntry = {
  install: string
  fallback: string
}

const TOOL_FALLBACKS: Record<string, ToolFallbackEntry> = {
  slither: {
    install: "pip install slither-analyzer",
    fallback:
      "Slither is unavailable. PROCEED with the audit using `argus_analyze_contract` for structural profiling and `argus_check_patterns` for vulnerability scanning. Note in the final report: \"Automated static analysis (Slither) was unavailable; manual review intensity increased.\"",
  },
  forge: {
    install: "curl -L https://foundry.paradigm.xyz | bash && foundryup",
    fallback:
      "Foundry/Forge is unavailable. SKIP automated testing and fuzzing. Verify findings through manual code tracing and static analysis. Note in the final report: \"Dynamic testing (Forge) was unavailable; findings verified via manual analysis.\"",
  },
  solodit: {
    install: "",
    fallback:
      "Solodit API is unreachable. PROCEED using `argus_check_patterns` with local vulnerability rules. Note in the final report: \"External vulnerability databases were inaccessible; research limited to local patterns.\"",
  },
  scvd: {
    install: "",
    fallback:
      "SCVD API is unavailable. PROCEED with local patterns and Solodit search if available.",
  },
}

const VIA_IR_HINT =
  "Project uses via_ir — Slither uses forge-flatten fallback automatically. Ensure forge and solc-select are installed."

function isToolUnavailable(lowerResult: string): boolean {
  return (
    lowerResult.includes("enoent") ||
    lowerResult.includes("not found") ||
    lowerResult.includes("not installed")
  )
}

function isToolError(lowerResult: string): boolean {
  return (
    isToolUnavailable(lowerResult) ||
    lowerResult.includes("command failed") ||
    lowerResult.includes("error:")
  )
}

function resolveToolBase(tool: string): string {
  return tool.replace("argus_", "").split("_")[0] ?? ""
}

export function createToolErrorRecoveryHandler(
  getAuditState?: () => AuditState | null,
) {
  const logger = createLogger()

  return (toolResult: { tool: string; result: string }): string | null => {
    const { tool, result } = toolResult
    const lowerResult = result.toLowerCase()

    const isViaIr =
      lowerResult.includes("via_ir") ||
      lowerResult.includes("via-ir") ||
      lowerResult.includes("flatten fallback") ||
      lowerResult.includes("flatten-fallback")

    if (isViaIr && tool.includes("slither")) {
      logger.info(`Tool error recovery hint for ${tool}: ${VIA_IR_HINT}`)
      return `\n[Argus Recovery Hint] ${VIA_IR_HINT}`
    }

    if (!isToolError(lowerResult)) return null

    const toolBase = resolveToolBase(tool)
    const entry = TOOL_FALLBACKS[toolBase]
    if (!entry) return null

    const unavailable = isToolUnavailable(lowerResult)

    if (unavailable && getAuditState) {
      const state = getAuditState()
      if (state) {
        state.unavailableTools ??= []
        if (!state.unavailableTools.includes(toolBase)) {
          state.unavailableTools.push(toolBase)
          logger.info(`Recorded ${toolBase} as unavailable — fallback activated`)
        }
      }
    }

    if (unavailable) {
      logger.info(`Tool unavailable fallback for ${tool}`)
      return `\n[Argus Fallback] ${entry.fallback}`
    }

    const installHint = entry.install ? ` (install: ${entry.install})` : ""
    logger.info(`Tool error recovery hint for ${tool}`)
    return `\n[Argus Recovery Hint] ${toolBase} error${installHint}. ${entry.fallback}`
  }
}
