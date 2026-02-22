import { validateEventSequence } from "../../state/projectors"
import type { AuditEvent } from "../../state/schemas"
import { SCHEMA_VERSION } from "../../state/schemas"
import type { EventSink } from "./event-sink"
import { readEvents } from "./event-sink"

export type FinalizationResult = {
  success: boolean
  invariantsPassed: boolean
  errors: string[]
  runId: string
  timestamp: number
}

export function hasSessionCreated(events: AuditEvent[]): boolean {
  return events.some((event) => event.type === "session.created")
}

export function hasSessionDeleted(events: AuditEvent[]): boolean {
  return events.some((event) => event.type === "session.deleted")
}

export type ToolLifecycleCheckResult = {
  orphanedToolCallIds: string[]
  malformedEvents: string[]
}

export function collectToolLifecycleIssues(events: AuditEvent[]): ToolLifecycleCheckResult {
  const startedCallIds = new Set<string>()
  const completedCallIds = new Set<string>()
  const malformedEvents: string[] = []

  for (const event of events) {
    if (event.type !== "tool.started" && event.type !== "tool.completed") {
      continue
    }

    if (typeof event.tool_call_id !== "string" || event.tool_call_id.length === 0) {
      malformedEvents.push(`${event.type} at seq ${event.seq} missing tool_call_id`)
      continue
    }

    if (event.type === "tool.started") {
      startedCallIds.add(event.tool_call_id)
    }

    if (event.type === "tool.completed") {
      completedCallIds.add(event.tool_call_id)
    }
  }

  const orphanedToolCallIds: string[] = []
  for (const toolCallId of startedCallIds) {
    if (!completedCallIds.has(toolCallId)) {
      orphanedToolCallIds.push(toolCallId)
    }
  }

  return {
    orphanedToolCallIds,
    malformedEvents,
  }
}

function collectOrphanedToolStarts(events: AuditEvent[]): string[] {
  const { orphanedToolCallIds, malformedEvents } = collectToolLifecycleIssues(events)
  const orphanedErrors = orphanedToolCallIds.map(
    (toolCallId) => `orphaned tool.started without matching tool.completed: ${toolCallId}`,
  )
  return [...malformedEvents, ...orphanedErrors]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function collectParentChildIntegrityErrors(events: AuditEvent[]): string[] {
  const errors: string[] = []
  const parentByChild = new Map<string, string>()
  const correlationByChild = new Map<string, string>()

  for (const event of events) {
    const payload = asRecord(event.payload)
    if (!payload) {
      continue
    }

    const childSessionId = payload.child_session_id
    if (typeof childSessionId !== "string" || childSessionId.length === 0) {
      continue
    }

    const parentSessionId = event.session_id
    if (!parentSessionId) {
      errors.push(`child session edge at seq ${event.seq} missing parent session_id`)
      continue
    }

    if (parentSessionId === childSessionId) {
      errors.push(`child session edge at seq ${event.seq} is self-referential`)
    }

    const correlationId = payload.correlation_id
    if (typeof correlationId !== "string" || correlationId.length === 0) {
      errors.push(`child session edge at seq ${event.seq} missing correlation_id`)
      continue
    }

    const existingParent = parentByChild.get(childSessionId)
    if (existingParent && existingParent !== parentSessionId) {
      errors.push(
        `child session ${childSessionId} mapped to multiple parents: ${existingParent}, ${parentSessionId}`,
      )
    } else {
      parentByChild.set(childSessionId, parentSessionId)
    }

    const existingCorrelation = correlationByChild.get(childSessionId)
    if (existingCorrelation && existingCorrelation !== correlationId) {
      errors.push(
        `child session ${childSessionId} has inconsistent correlation_id: ${existingCorrelation}, ${correlationId}`,
      )
    } else {
      correlationByChild.set(childSessionId, correlationId)
    }
  }

  return errors
}

function collectInvariantErrors(events: AuditEvent[]): string[] {
  const errors: string[] = []

  try {
    validateEventSequence(events)
  } catch (error) {
    errors.push(`invalid event sequence: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!hasSessionCreated(events)) {
    errors.push("missing required lifecycle event: session.created")
  }

  if (!hasSessionDeleted(events)) {
    errors.push("missing required lifecycle event: session.deleted")
  }

  errors.push(...collectOrphanedToolStarts(events))
  errors.push(...collectParentChildIntegrityErrors(events))
  return errors
}

export async function finalizeRun(
  runId: string,
  projectDir: string,
  sink: EventSink | null,
): Promise<FinalizationResult> {
  const timestamp = Date.now()
  const events = sink ? await sink.readAll() : await readEvents(runId, projectDir)
  const errors = collectInvariantErrors(events)
  const invariantsPassed = errors.length === 0
  const sessionId = events.at(-1)?.session_id ?? ""

  if (sink) {
    await sink.append({
      type: "run.finalized",
      run_id: runId,
      seq: 0,
      session_id: sessionId,
      source: "run-finalizer",
      schema_version: SCHEMA_VERSION,
      timestamp,
      payload: {
        finalized: invariantsPassed,
        invariantsPassed,
        errors,
        status: invariantsPassed ? "finalized" : "failed-finalization",
      },
    })
  }

  return {
    success: invariantsPassed,
    invariantsPassed,
    errors,
    runId,
    timestamp,
  }
}
