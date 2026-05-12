import type { ToolContext } from "@opencode-ai/plugin"

export const FOUNDRY_NOT_FOUND_MESSAGE =
  "Foundry not found. Install: curl -L https://foundry.paradigm.xyz | bash"

/**
 * Classify a caught error from a forge command execution into a user-facing
 * error string.  Returns `undefined` when the error is not a recognized
 * forge-specific failure and should be handled by the caller.
 */
export function classifyForgeError(
  error: unknown,
  context: ToolContext,
  toolLabel: string,
): string | undefined {
  if (context.abort.aborted || (error instanceof DOMException && error.name === "AbortError")) {
    return `${toolLabel} aborted`
  }

  const maybeError = error as Error & { code?: string }

  if (maybeError.code === "ENOENT") {
    return FOUNDRY_NOT_FOUND_MESSAGE
  }

  if (maybeError.code === "ETIMEDOUT" || maybeError.message?.toLowerCase().includes("timed out")) {
    return `${toolLabel} timed out`
  }

  return undefined
}
