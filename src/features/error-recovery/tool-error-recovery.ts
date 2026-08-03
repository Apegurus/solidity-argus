import { createLogger } from "../../shared/logger"
import type { AuditState } from "../../state/types"

type ToolFallbackEntry = {
  install: string
  fallback: string
}

const TOOL_FALLBACKS: Record<string, ToolFallbackEntry> = {
  slither: {
    install: "pipx install --python python3.13 slither-analyzer",
    fallback:
      'Slither is unavailable. PROCEED with the audit using `argus_analyze_contract` for structural profiling and `argus_check_patterns` for vulnerability scanning. Note in the final report: "Automated static analysis (Slither) was unavailable; manual review intensity increased."',
  },
  forge: {
    install: "curl -L https://foundry.paradigm.xyz | bash && foundryup",
    fallback:
      'Foundry/Forge is unavailable. SKIP automated testing and fuzzing. Verify findings through manual code tracing and static analysis. Note in the final report: "Dynamic testing (Forge) was unavailable; findings verified via manual analysis."',
  },
  solodit: {
    install: "",
    fallback:
      'Solodit API is unreachable. PROCEED using `argus_check_patterns` with local vulnerability rules. Note in the final report: "External vulnerability databases were inaccessible; research limited to local patterns."',
  },
  scvd: {
    install: "",
    fallback:
      "SCVD API is unavailable. PROCEED with local patterns and Solodit search if available.",
  },
}

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
  updateAuditState?: (patch: Partial<AuditState>) => Promise<void>,
) {
  const logger = createLogger()

  return (toolResult: { tool: string; result: string }): string | null => {
    const { tool, result } = toolResult
    if (!result || typeof result !== "string") return null
    const lowerResult = result.toLowerCase()

    if (tool.includes("slither") && lowerResult.includes("slither_via_ir_analysis_failed")) {
      logger.info(`Tool error recovery hint for ${tool}: via_ir capability loss`)
      return "\n[Argus Recovery Hint] Slither could not analyze this via_ir target. Continue with `argus_analyze_contract` for structural profiling and `argus_check_patterns` for vulnerability scanning, and record the static-analysis capability limitation in the final report."
    }

    if (!isToolError(lowerResult)) return null

    const toolBase = resolveToolBase(tool)
    const entry = TOOL_FALLBACKS[toolBase]
    if (!entry) return null

    const unavailable = isToolUnavailable(lowerResult)

    if (unavailable && getAuditState && updateAuditState) {
      const state = getAuditState()
      if (state) {
        const existing = state.unavailableTools ?? []
        if (!existing.includes(toolBase)) {
          void updateAuditState({
            unavailableTools: [...existing, toolBase],
          }).catch((error: unknown) => {
            logger.warn(`Failed to persist unavailable tool state for ${toolBase}`, error)
          })
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
