export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Type guard: returns true when value is a non-empty string (after trimming). */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}
