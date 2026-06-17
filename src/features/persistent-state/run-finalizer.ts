import { ARGUS_BUILD_PROVENANCE, ARGUS_PLUGIN_BUILD } from "../../shared/plugin-metadata"
import { validateEventSequence } from "../../state/projectors"
import type { AuditEvent } from "../../state/schemas"
import { SCHEMA_VERSION } from "../../state/schemas"
import type { EventSink } from "./event-sink"
import { readEvents } from "./event-sink"

export type FinalizationResult = {
  success: boolean
  invariantsPassed: boolean
  errors: string[]
  warnings: string[]
  runId: string
  timestamp: number
}

type ExistingFinalizationResult = FinalizationResult & {
  finalizedIndex: number
}

export interface FinalizeRunOptions {
  // A report carrying a Completeness Warning was generated in warn mode (strict-fail
  // throws before writing), so by default the warning stays informational here rather
  // than hard-failing finalization of an otherwise-valid live run. Pass "strict-fail"
  // for offline/post-hoc validation that should reject any incomplete report.
  completenessPolicy?: "warn" | "strict-fail"
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

function isGenerateReportCompletion(event: AuditEvent): boolean {
  if (event.type !== "tool.completed") return false
  const payload = asRecord(event.payload)
  if (!payload) return false
  return payload.tool === "argus_generate_report" || payload.name === "argus_generate_report"
}

async function collectReportCompletenessWarnings(events: AuditEvent[]): Promise<string[]> {
  const warnings: string[] = []
  const reportEvents = events.filter(isGenerateReportCompletion)

  for (const event of reportEvents) {
    const payload = asRecord(event.payload)
    const filePath = payload?.filePath
    if (typeof filePath !== "string" || filePath.length === 0) continue

    try {
      const report = await Bun.file(filePath).text()
      if (report.includes("## ⚠ Completeness Warning")) {
        warnings.push("generated report contains Completeness Warning")
      }
    } catch {
      // Missing report files are handled by report-generation/tool-tracking gates.
    }
  }

  return warnings
}

function collectReportQualityGateErrors(events: AuditEvent[]): string[] {
  const errors: string[] = []
  const reportEvents = events.filter(isGenerateReportCompletion)

  for (const event of reportEvents) {
    const payload = asRecord(event.payload)
    const qualityGates = asRecord(payload?.qualityGates)
    if (qualityGates?.passed !== false) continue

    const violations = Array.isArray(qualityGates.violations)
      ? qualityGates.violations.filter((entry): entry is string => typeof entry === "string")
      : []
    const details = violations.length > 0 ? `: ${violations.join("; ")}` : ""
    errors.push(`generated report failed quality gates${details}`)
  }

  return errors
}

type ThemisVerdict = {
  approved?: unknown
  pipeline_issues?: unknown
  false_positives?: unknown
  missed_findings?: unknown
  severity_adjustments?: unknown
}

type ThemisDisposition = {
  status?: unknown
  verdict?: ThemisVerdict
  notes?: unknown
  justification?: unknown
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isResolvedThemisDisposition(value: unknown): boolean {
  const disposition = asRecord(value) as ThemisDisposition | null
  if (disposition?.status === "approved") {
    return disposition.verdict?.approved === true
  }
  if (disposition?.status === "overridden") {
    return disposition.verdict?.approved === false && hasText(disposition.justification)
  }
  return false
}

function isRemediatedThemisDisposition(value: unknown): boolean {
  const disposition = asRecord(value) as ThemisDisposition | null
  return (
    disposition?.status === "remediated" &&
    disposition.verdict?.approved === false &&
    hasText(disposition.notes)
  )
}

function hasRejectedThemisVerdict(value: unknown): boolean {
  const verdict = asRecord(value) as ThemisVerdict | null
  return verdict?.approved === false
}

function collectThemisDispositionErrors(events: AuditEvent[]): string[] {
  let reportIndex = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event && isGenerateReportCompletion(event)) {
      reportIndex = index
      break
    }
  }
  if (reportIndex === -1) return []

  const laterEvents = events.slice(reportIndex + 1)
  const hasResolvedDisposition = laterEvents.some((event) => {
    if (event.type !== "tool.completed") return false
    const payload = asRecord(event.payload)
    return isResolvedThemisDisposition(payload?.themisDisposition)
  })

  if (hasResolvedDisposition) return []

  const hasRemediatedDisposition = laterEvents.some((event) => {
    if (event.type !== "tool.completed") return false
    const payload = asRecord(event.payload)
    return isRemediatedThemisDisposition(payload?.themisDisposition)
  })

  if (hasRemediatedDisposition) {
    return ["remediated Themis disposition requires fresh approved Themis validation"]
  }

  const hasUnresolvedRejection = laterEvents.some((event) => {
    if (event.type !== "tool.completed") return false
    const payload = asRecord(event.payload)
    return (
      payload?.tool === "task" &&
      payload.subagent_type === "themis" &&
      hasRejectedThemisVerdict(payload.themis)
    )
  })

  return hasUnresolvedRejection
    ? ["generated report has unresolved Themis issues"]
    : ["generated report has no resolved Themis disposition"]
}

export function hasResolvedThemisDispositionAfterReport(events: AuditEvent[]): boolean {
  let reportIndex = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event && isGenerateReportCompletion(event)) {
      reportIndex = index
      break
    }
  }
  if (reportIndex === -1) return false

  return events.slice(reportIndex + 1).some((event) => {
    if (event.type !== "tool.completed") return false
    const payload = asRecord(event.payload)
    return isResolvedThemisDisposition(payload?.themisDisposition)
  })
}

function collectParentChildIntegrityErrors(events: AuditEvent[]): string[] {
  const errors: string[] = []
  const parentByChild = new Map<string, string>()

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

    // Intentionally no one-correlation-per-child invariant: correlation_id is minted per
    // dispatch, and a child subagent session is legitimately re-dispatched/continued across
    // remediation rounds, so one child session correctly carries multiple correlation_ids.
  }

  return errors
}

function collectMultiSessionErrors(events: AuditEvent[]): string[] {
  const allSessionIds = new Set(events.map((e) => e.session_id).filter(Boolean))
  if (allSessionIds.size <= 1) return []

  const knownIds = new Set<string>()

  for (const event of events) {
    const payload = asRecord(event.payload)
    if (!payload) continue
    const childSessionId = payload.child_session_id
    if (typeof childSessionId === "string" && childSessionId.length > 0) {
      knownIds.add(childSessionId)
      if (event.session_id) {
        knownIds.add(event.session_id)
      }
    }
  }

  for (const event of events) {
    if (event.type !== "session.created") {
      continue
    }
    if (event.session_id && event.session_id.length > 0) {
      knownIds.add(event.session_id)
    }
  }

  const firstSessionId = events.find((e) => e.session_id)?.session_id ?? ""
  const unexplained: string[] = []
  for (const id of allSessionIds) {
    if (id === firstSessionId) continue
    if (knownIds.has(id)) continue
    unexplained.push(id)
  }

  if (unexplained.length > 0) {
    return [
      `unexpected session writers detected (not in parent-child graph): ${unexplained.join(", ")}`,
    ]
  }
  return []
}

function collectInvariantErrors(events: AuditEvent[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  try {
    validateEventSequence(events)
  } catch (error) {
    errors.push(`invalid event sequence: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!hasSessionCreated(events)) {
    errors.push("missing required lifecycle event: session.created")
  }

  warnings.push(...collectOrphanedToolStarts(events))
  errors.push(...collectParentChildIntegrityErrors(events))
  warnings.push(...collectMultiSessionErrors(events))
  return { errors, warnings }
}

function parseExistingFinalizationResult(
  events: AuditEvent[],
  runId: string,
): ExistingFinalizationResult | null {
  const reversedIndex = [...events].reverse().findIndex((event) => event.type === "run.finalized")
  if (reversedIndex < 0) {
    return null
  }

  const finalizedIndex = events.length - 1 - reversedIndex
  const finalized = events[finalizedIndex]
  if (!finalized) {
    return null
  }

  const payload =
    typeof finalized.payload === "object" &&
    finalized.payload !== null &&
    !Array.isArray(finalized.payload)
      ? (finalized.payload as Record<string, unknown>)
      : null

  const errors = Array.isArray(payload?.errors)
    ? payload.errors.filter((entry): entry is string => typeof entry === "string")
    : []
  const warnings = Array.isArray(payload?.warnings)
    ? payload.warnings.filter((entry): entry is string => typeof entry === "string")
    : []
  const invariantsPassed =
    typeof payload?.invariantsPassed === "boolean"
      ? payload.invariantsPassed
      : typeof payload?.finalized === "boolean"
        ? payload.finalized
        : errors.length === 0

  return {
    success: invariantsPassed,
    invariantsPassed,
    errors,
    warnings,
    runId,
    timestamp: finalized.timestamp,
    finalizedIndex,
  }
}

export async function finalizeRun(
  runId: string,
  projectDir: string,
  sink: EventSink | null,
  options: FinalizeRunOptions = {},
): Promise<FinalizationResult> {
  const completenessPolicy = options.completenessPolicy ?? "warn"
  const timestamp = Date.now()
  const events = sink ? await sink.readAll() : await readEvents(runId, projectDir)
  const existingResult = parseExistingFinalizationResult(events, runId)
  const hasEventsAfterExistingFinalization =
    existingResult !== null && existingResult.finalizedIndex < events.length - 1
  if (existingResult?.invariantsPassed && !hasEventsAfterExistingFinalization) {
    const completeness = await collectReportCompletenessWarnings(events)
    const reportErrors = [
      ...(completenessPolicy === "strict-fail" ? completeness : []),
      ...collectReportQualityGateErrors(events),
      ...collectThemisDispositionErrors(events),
    ]
    if (reportErrors.length === 0) {
      return {
        success: existingResult.success,
        invariantsPassed: existingResult.invariantsPassed,
        errors: existingResult.errors,
        warnings: existingResult.warnings,
        runId: existingResult.runId,
        timestamp: existingResult.timestamp,
      }
    }
  }

  const { errors, warnings } = collectInvariantErrors(events)
  const completeness = await collectReportCompletenessWarnings(events)
  if (completenessPolicy === "strict-fail") {
    errors.push(...completeness)
  } else {
    warnings.push(...completeness)
  }
  errors.push(...collectReportQualityGateErrors(events))
  errors.push(...collectThemisDispositionErrors(events))
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
        warnings,
        status: invariantsPassed ? "finalized" : "failed-finalization",
        plugin_version: ARGUS_PLUGIN_BUILD,
        build_commit: ARGUS_BUILD_PROVENANCE.gitSha ?? null,
        build_dirty: ARGUS_BUILD_PROVENANCE.gitDirty ?? null,
      },
    })
    sink.markFinalized()
  }

  return {
    success: invariantsPassed,
    invariantsPassed,
    errors,
    warnings,
    runId,
    timestamp,
  }
}
