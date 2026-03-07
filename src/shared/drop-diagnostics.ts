import { createLogger } from "./logger"

const logger = createLogger()

/**
 * "warn": log and continue (default). "error": collect, continue, surface.
 * "strict-fail": collect, then throw after all diagnostics gathered.
 */
export type DropPolicy = "warn" | "error" | "strict-fail"

export type DropReason = {
  code: string
  field?: string
  message: string
  policy: DropPolicy
}

export type DropDiagnostic = {
  type: "drop"
  source: string
  tool?: string
  reason: DropReason
  timestamp: number
}

export type DropDiagnosticsCollector = {
  warn(code: string, message: string, field?: string): void
  error(code: string, message: string, field?: string): void
  getDiagnostics(): DropDiagnostic[]
  hasErrors(): boolean
  throwIfStrict(): void
}

/** Thrown in strict-fail mode when error-level diagnostics exist. */
export class DropDiagnosticsError extends Error {
  public readonly diagnostics: DropDiagnostic[]

  constructor(diagnostics: DropDiagnostic[]) {
    const errorDiags = diagnostics.filter(
      (d) => d.reason.policy === "strict-fail" || d.reason.policy === "error",
    )
    const summary = errorDiags.map((d) => `[${d.reason.code}] ${d.reason.message}`).join("; ")
    super(`Drop diagnostics: ${errorDiags.length} error(s) — ${summary}`)
    this.name = "DropDiagnosticsError"
    this.diagnostics = diagnostics
  }
}

export function createDropDiagnosticsCollector(
  policy: DropPolicy,
  source: string,
  tool?: string,
): DropDiagnosticsCollector {
  const diagnostics: DropDiagnostic[] = []
  let errorCount = 0

  function push(code: string, message: string, level: "warn" | "error", field?: string): void {
    const effectivePolicy: DropPolicy = level === "error" ? policy : "warn"
    const diagnostic: DropDiagnostic = {
      type: "drop",
      source,
      tool,
      reason: {
        code,
        message,
        policy: effectivePolicy,
        ...(field !== undefined ? { field } : {}),
      },
      timestamp: Date.now(),
    }
    diagnostics.push(diagnostic)

    if (level === "error") {
      errorCount++
    }

    const logMsg = `[${source}${tool ? `:${tool}` : ""}] ${code}${field ? ` (field: ${field})` : ""}: ${message}`
    if (level === "error") {
      logger.error(logMsg)
    } else {
      logger.warn(logMsg)
    }
  }

  return {
    warn(code: string, message: string, field?: string): void {
      push(code, message, "warn", field)
    },

    error(code: string, message: string, field?: string): void {
      push(code, message, "error", field)
    },

    getDiagnostics(): DropDiagnostic[] {
      return [...diagnostics]
    },

    hasErrors(): boolean {
      return errorCount > 0
    },

    throwIfStrict(): void {
      if (policy === "strict-fail" && errorCount > 0) {
        throw new DropDiagnosticsError(diagnostics)
      }
    },
  }
}
