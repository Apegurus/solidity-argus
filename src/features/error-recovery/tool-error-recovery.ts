import { createLogger } from "../../shared/logger"

const RECOVERY_HINTS: Record<string, string> = {
  slither: "Install Slither: pip install slither-analyzer",
  forge: "Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup",
  solodit: "Check network connectivity or Solodit API status",
  scvd: "Check SCVD API at https://api.scvd.dev — may be temporarily unavailable",
}

export function createToolErrorRecoveryHandler() {
  const logger = createLogger()

  return (toolResult: { tool: string; result: string }): string | null => {
    const { tool, result } = toolResult
    const lowerResult = result.toLowerCase()

    const isError =
      lowerResult.includes("enoent") ||
      lowerResult.includes("not found") ||
      lowerResult.includes("command failed") ||
      lowerResult.includes("error:")

    if (!isError) return null

    const toolBase = tool.replace("argus_", "").split("_")[0] ?? ""
    const hint = RECOVERY_HINTS[toolBase]

    if (hint) {
      logger.info(`Tool error recovery hint for ${tool}: ${hint}`)
      return `\n[Argus Recovery Hint] ${hint}`
    }

    return null
  }
}
