const DEFAULT_MAX_CHARS = 50_000
const MIN_CHARS = 1000

export interface TruncatorConfig {
  maxChars?: number
}

export function createToolOutputTruncator(config: TruncatorConfig = {}) {
  const maxChars = Math.max(config.maxChars ?? DEFAULT_MAX_CHARS, MIN_CHARS)

  return (output: string): string => {
    if (output.length <= maxChars) return output

    const truncated = output.slice(0, maxChars)
    return `${truncated}\n\n[Truncated: ${output.length.toLocaleString()} → ${maxChars.toLocaleString()} chars]`
  }
}
