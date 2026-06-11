import {
  collectToolLifecycleIssues,
  hasSessionCreated,
  hasSessionDeleted,
} from "../features/persistent-state/run-finalizer"
import type { AuditEvent } from "../state/schemas"

export interface PreflightResult {
  passed: boolean
  orphanedTools: string[]
  missingLifecycle: string[]
  missingRequiredTools: string[]
  warnings: string[]
}

export interface PreflightOptions {
  requiredTools?: string[]
  // Treats a report written mid-audit (before session.deleted/run.finalized) as
  // legitimate instead of a missing-lifecycle gap. Integrity checks are NOT relaxed:
  // session.created, orphaned-tool, malformed-event, and required-tool all still apply.
  allowLiveAudit?: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function hasCompletedTool(events: AuditEvent[], toolName: string): boolean {
  for (const event of events) {
    if (event.type !== "tool.completed") {
      continue
    }

    const payload = asRecord(event.payload)
    if (!payload) {
      continue
    }

    const name = payload.name
    const tool = payload.tool
    if (name === toolName || tool === toolName) {
      return true
    }
  }

  return false
}

function hasRunFinalized(events: AuditEvent[]): boolean {
  return events.some((event) => event.type === "run.finalized")
}

export function checkReportPreflight(
  events: AuditEvent[],
  options: PreflightOptions = {},
): PreflightResult {
  const missingLifecycle: string[] = []
  if (!hasSessionCreated(events)) {
    missingLifecycle.push("session.created")
  }
  if (!options.allowLiveAudit && !hasSessionDeleted(events) && !hasRunFinalized(events)) {
    missingLifecycle.push("session.deleted")
  }

  const { orphanedToolCallIds, malformedEvents } = collectToolLifecycleIssues(events)

  const missingRequiredTools: string[] = []
  for (const requiredTool of options.requiredTools ?? []) {
    if (!hasCompletedTool(events, requiredTool)) {
      missingRequiredTools.push(requiredTool)
    }
  }

  return {
    passed:
      orphanedToolCallIds.length === 0 &&
      missingLifecycle.length === 0 &&
      missingRequiredTools.length === 0,
    orphanedTools: orphanedToolCallIds,
    missingLifecycle,
    missingRequiredTools,
    warnings: malformedEvents,
  }
}
