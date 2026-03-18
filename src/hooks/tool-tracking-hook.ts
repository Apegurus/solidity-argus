import { randomUUID } from "node:crypto"
import type { EventSink } from "../features/persistent-state/event-sink"
import type {
  DropDiagnostic,
  DropDiagnosticsCollector,
  DropPolicy,
} from "../shared/drop-diagnostics"
import { createDropDiagnosticsCollector } from "../shared/drop-diagnostics"
import { createLogger } from "../shared/logger"
import { normalizeToCanonicalFinding } from "../state/adapters"
import type { FindingStore } from "../state/finding-store"
import { createFindingStore } from "../state/finding-store"
import type { AuditEvent } from "../state/schemas"
import { SCHEMA_VERSION } from "../state/schemas"
import type {
  ArgusAgentName,
  AuditState,
  Finding,
  FindingSeverity,
  FuzzCounterexample,
  SoloditResult,
} from "../state/types"

const logger = createLogger()

type ToolHookInput = {
  tool: string
  args: unknown
  result: string
  sessionID?: string
  callID?: string
}

type ToolExecutionMetadata = {
  tool: string
  findingsCount: number
}

export type ToolTrackingOptions = {
  getEventSink?: () => EventSink | null
  getEventSinkForSession?: (sessionId: string) => EventSink | null
  getEventSinkForRun?: (runId: string) => EventSink | null
  getActiveRunSinks?: () => EventSink[]
  getSessionId?: () => string
  getAgentName?: () => ArgusAgentName | undefined
  getAgentNameForSession?: (sessionId: string) => ArgusAgentName | undefined
  dropPolicy?: DropPolicy
  onChildSessionDetected?: (parentSessionId: string, childSessionId: string) => void
}

const VALID_SEVERITIES: ReadonlySet<string> = new Set([
  "Critical",
  "High",
  "Medium",
  "Low",
  "Informational",
])

const VALID_CONFIDENCES: ReadonlySet<string> = new Set(["High", "Medium", "Low"])

function toSeverity(value: unknown): FindingSeverity {
  if (typeof value === "string" && VALID_SEVERITIES.has(value)) {
    return value as FindingSeverity
  }
  return "Informational"
}

function toConfidence(value: unknown): "High" | "Medium" | "Low" {
  if (typeof value === "string" && VALID_CONFIDENCES.has(value)) {
    return value as "High" | "Medium" | "Low"
  }
  return "Low"
}

function toLines(value: unknown): [number, number] | undefined {
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    return [value[0], value[1]]
  }
  return undefined
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

function toFindingSource(value: unknown): Finding["source"] {
  if (
    value === "slither" ||
    value === "manual" ||
    value === "pattern" ||
    value === "scvd" ||
    value === "solodit" ||
    value === "fuzz"
  ) {
    return value
  }

  return "manual"
}

async function emitToSink(
  sink: EventSink,
  event: AuditEvent,
  options?: { failFast?: boolean },
): Promise<void> {
  try {
    await sink.append(event)
  } catch (error) {
    const message = `Failed to emit ${event.type} event to sink: ${error instanceof Error ? error.message : String(error)}`
    logger.error(message)

    if (options?.failFast) {
      throw new Error(message)
    }
  }
}

function buildEvent(
  type: AuditEvent["type"],
  runId: string,
  sessionId: string,
  toolCallId: string,
  payload: unknown,
): AuditEvent {
  return {
    type,
    run_id: runId,
    seq: 0,
    session_id: sessionId,
    tool_call_id: toolCallId,
    source: "tool-tracking-hook",
    schema_version: SCHEMA_VERSION,
    timestamp: Date.now(),
    payload,
  }
}

/**
 * Defensively parse a child session_id from a `task` tool result.
 * The result may be JSON with a top-level or nested `session_id` field,
 * or plain text with an embedded JSON fragment.
 */
function parseChildSessionId(result: string): string | null {
  // Strategy 1: Full JSON parse (structured tool output)
  try {
    const parsed = JSON.parse(result)
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      if (typeof parsed.session_id === "string" && parsed.session_id.length > 0) {
        return parsed.session_id
      }
      if (
        typeof parsed.result === "object" &&
        parsed.result !== null &&
        !Array.isArray(parsed.result) &&
        typeof parsed.result.session_id === "string" &&
        parsed.result.session_id.length > 0
      ) {
        return parsed.result.session_id
      }
    }
  } catch {
    // Not valid JSON — fall through to regex strategies
  }

  // Strategy 2: OpenCode task tool XML format
  // <task_metadata>
  // session_id: ses_xxx
  // </task_metadata>
  const xmlMatch = result.match(
    /<task_metadata>[\s\S]*?session_id:\s*(ses_\S+)[\s\S]*?<\/task_metadata>/,
  )
  if (xmlMatch?.[1]) {
    return xmlMatch[1]
  }

  // Strategy 3: JSON fragment in plain text
  const jsonFragmentMatch = result.match(/"session_id"\s*:\s*"([^"]+)"/)
  if (jsonFragmentMatch?.[1]) {
    return jsonFragmentMatch[1]
  }

  // Strategy 4: Bare session_id line (e.g. "session_id: ses_xxx" outside XML tags)
  const bareMatch = result.match(/session_id:\s*(ses_\S+)/)
  if (bareMatch?.[1]) {
    return bareMatch[1]
  }

  return null
}

function identifyMissingFields(
  finding: Record<string, unknown>,
  requiredFields: readonly string[],
): string[] {
  const missing: string[] = []
  for (const field of requiredFields) {
    if (field === "lines") {
      if (!toLines(finding.lines)) missing.push(field)
    } else if (typeof finding[field] !== "string") {
      missing.push(field)
    }
  }
  return missing
}

const SLITHER_REQUIRED = ["check", "description", "file", "lines"] as const
const PATTERN_REQUIRED = ["pattern", "description", "file", "lines"] as const
const MANUAL_REQUIRED = ["check", "description", "file", "lines"] as const

function processSlitherResult(
  parsed: Record<string, unknown>,
  store: FindingStore,
  diag: DropDiagnosticsCollector,
  metadata: { reportedByAgent: ArgusAgentName; reportedBySessionId: string },
): number {
  const findings = parsed.findings
  if (!Array.isArray(findings)) return 0

  let count = 0
  for (const raw of findings) {
    const finding = toRecord(raw)
    if (!finding) continue

    const check = finding.check
    const description = finding.description
    const file = finding.file
    const lines = toLines(finding.lines)

    if (
      typeof check !== "string" ||
      typeof description !== "string" ||
      typeof file !== "string" ||
      !lines
    ) {
      const missing = identifyMissingFields(finding, SLITHER_REQUIRED)
      diag.error(
        "MISSING_REQUIRED_FIELD",
        `Slither finding skipped: missing ${missing.join(", ")}`,
        missing[0],
      )
      continue
    }

    store.addFinding({
      check,
      severity: toSeverity(finding.severity),
      confidence: toConfidence(finding.confidence),
      description,
      file,
      lines,
      source: "slither",
      reported_by_agent: metadata.reportedByAgent,
      reported_by_session_id: metadata.reportedBySessionId,
    })
    count++
  }

  return count
}

function processPatternResult(
  parsed: Record<string, unknown>,
  store: FindingStore,
  diag: DropDiagnosticsCollector,
  metadata: { reportedByAgent: ArgusAgentName; reportedBySessionId: string },
): number {
  const sources = parsed.sources
  if (!Array.isArray(sources)) return 0

  let count = 0
  for (const rawSource of sources) {
    const source = toRecord(rawSource)
    if (!source) continue

    const matches = source.matches
    if (!Array.isArray(matches)) continue

    for (const rawMatch of matches) {
      const match = toRecord(rawMatch)
      if (!match) continue

      const pattern = match.pattern
      const description = match.description
      const file = match.file
      const lines = toLines(match.lines)

      if (
        typeof pattern !== "string" ||
        typeof description !== "string" ||
        typeof file !== "string" ||
        !lines
      ) {
        const missing = identifyMissingFields(match, PATTERN_REQUIRED)
        diag.error(
          "MISSING_REQUIRED_FIELD",
          `Pattern finding skipped: missing ${missing.join(", ")}`,
          missing[0],
        )
        continue
      }

      store.addFinding({
        check: pattern,
        severity: toSeverity(match.severity),
        confidence: "Medium",
        description,
        file,
        lines,
        source: "pattern",
        reported_by_agent: metadata.reportedByAgent,
        reported_by_session_id: metadata.reportedBySessionId,
      })
      count++
    }
  }

  return count
}

function processRecordedFindingResult(
  parsed: Record<string, unknown>,
  store: FindingStore,
  diag: DropDiagnosticsCollector,
  metadata: { reportedByAgent: ArgusAgentName; reportedBySessionId: string },
): number {
  const findings = parsed.findings
  if (!Array.isArray(findings)) {
    diag.error(
      "MISSING_REQUIRED_FIELD",
      "argus_record_finding result missing findings array",
      "findings",
    )
    return 0
  }

  let count = 0
  for (const raw of findings) {
    const finding = toRecord(raw)
    if (!finding) continue

    const check = finding.check
    const description = finding.description
    const file = finding.file
    const lines = toLines(finding.lines)

    if (
      typeof check !== "string" ||
      typeof description !== "string" ||
      typeof file !== "string" ||
      !lines
    ) {
      const missing = identifyMissingFields(finding, MANUAL_REQUIRED)
      diag.error(
        "MISSING_REQUIRED_FIELD",
        `Recorded finding skipped: missing ${missing.join(", ")}`,
        missing[0],
      )
      continue
    }

    const reportedByAgentRaw = finding.reported_by_agent
    const reportedByAgent =
      reportedByAgentRaw === "argus" ||
      reportedByAgentRaw === "sentinel" ||
      reportedByAgentRaw === "pythia" ||
      reportedByAgentRaw === "scribe" ||
      reportedByAgentRaw === "unknown"
        ? (reportedByAgentRaw as ArgusAgentName)
        : metadata.reportedByAgent

    store.addFinding({
      check,
      severity: toSeverity(finding.severity),
      confidence: toConfidence(finding.confidence),
      description,
      file,
      lines,
      source: toFindingSource(finding.source),
      remediation: typeof finding.remediation === "string" ? finding.remediation : undefined,
      exploitReference:
        typeof finding.exploitReference === "string" ? finding.exploitReference : undefined,
      reported_by_agent: reportedByAgent,
      reported_by_session_id:
        typeof finding.reported_by_session_id === "string" &&
        finding.reported_by_session_id.length > 0
          ? finding.reported_by_session_id
          : metadata.reportedBySessionId,
      issue_fingerprint:
        typeof finding.issue_fingerprint === "string" ? finding.issue_fingerprint : undefined,
      observation_fingerprint:
        typeof finding.observation_fingerprint === "string"
          ? finding.observation_fingerprint
          : undefined,
      observation_id:
        typeof finding.observation_id === "string" ? finding.observation_id : undefined,
    })
    count++
  }

  return count
}

function processContractAnalyzerResult(parsed: Record<string, unknown>, state: AuditState): void {
  if (typeof parsed.filePath === "string") {
    if (!state.contractsReviewed.includes(parsed.filePath)) {
      state.contractsReviewed.push(parsed.filePath)
    }
    return
  }

  const profile = toRecord(parsed.contractProfile)
  if (profile && typeof profile.filePath === "string") {
    if (!state.contractsReviewed.includes(profile.filePath)) {
      state.contractsReviewed.push(profile.filePath)
    }
  }
}

function processFuzzResult(parsed: Record<string, unknown>, state: AuditState): void {
  const counterexamples = parsed.counterexamples
  if (!Array.isArray(counterexamples) || counterexamples.length === 0) return

  const totalRuns = typeof parsed.totalRuns === "number" ? parsed.totalRuns : 0

  state.fuzzCounterexamples ??= []

  for (const raw of counterexamples) {
    const ce = toRecord(raw)
    if (!ce) continue

    const testName = ce.testName
    if (typeof testName !== "string") continue

    const rawInputs = ce.inputs
    const inputs = Array.isArray(rawInputs)
      ? rawInputs.map(String)
      : (() => {
          const rec = toRecord(rawInputs)
          return rec ? Object.values(rec).map(String) : []
        })()

    const entry: FuzzCounterexample = {
      testName,
      inputs,
      runs: totalRuns,
      timestamp: Date.now(),
    }

    if (typeof ce.revertReason === "string") {
      entry.revertReason = ce.revertReason
    }

    state.fuzzCounterexamples.push(entry)
  }
}

function processSoloditResult(parsed: Record<string, unknown>, state: AuditState): void {
  const query = typeof parsed.query === "string" ? parsed.query : ""
  const results = Array.isArray(parsed.results) ? parsed.results : []
  const totalFound = typeof parsed.totalFound === "number" ? parsed.totalFound : results.length

  const topResults: SoloditResult["topResults"] = results.slice(0, 5).map((raw) => {
    const r = toRecord(raw)
    return {
      title: typeof r?.title === "string" ? r.title : "",
      severity: typeof r?.severity === "string" ? r.severity : "",
      url: typeof r?.url === "string" ? r.url : "",
      protocol: typeof r?.protocol === "string" ? r.protocol : "",
    }
  })

  state.soloditResults ??= []
  state.soloditResults.push({
    query,
    timestamp: Date.now(),
    resultCount: totalFound,
    topResults,
  })
}

function recordToolExecution(state: AuditState, toolName: string, findingsCount: number): void {
  const now = Date.now()
  state.toolsExecuted.push({
    tool: toolName,
    startTime: now,
    endTime: now,
    success: true,
    findingsCount,
  })
}

const TOOL_PHASE_MAP: Record<string, AuditState["currentPhase"]> = {
  argus_slither_analyze: "scanning",
  argus_check_patterns: "scanning",
  argus_analyze_contract: "scanning",
  argus_proxy_detection: "scanning",
  argus_solodit_search: "research",
  argus_forge_test: "testing",
  argus_forge_fuzz: "testing",
  argus_forge_coverage: "testing",
  argus_gas_analysis: "testing",
  argus_generate_report: "reporting",
}

const PHASE_ORDER: readonly AuditState["currentPhase"][] = [
  "reconnaissance",
  "scanning",
  "manual-review",
  "attack-surface",
  "research",
  "testing",
  "reporting",
  "complete",
]

function inferPhaseAdvancement(
  state: AuditState,
  toolName: string,
): AuditState["currentPhase"] | null {
  const inferredPhase = TOOL_PHASE_MAP[toolName]
  if (!inferredPhase) return null

  const currentIdx = PHASE_ORDER.indexOf(state.currentPhase)
  const inferredIdx = PHASE_ORDER.indexOf(inferredPhase)
  if (inferredIdx <= currentIdx) return null

  return inferredPhase
}

type OrphanEvent = {
  event: AuditEvent
  failFast: boolean
  bufferedAt: number
}

const ORPHAN_BUFFER_TTL_MS = 60_000
const MAX_ORPHAN_EVENTS_PER_SESSION = 50

export type ToolTrackingHook = {
  (input: ToolHookInput): Promise<void>
  getLastDiagnostics(): DropDiagnostic[]
  flushOrphanEvents(sessionId: string, sink: EventSink): Promise<number>
}

export function createToolTrackingHook(
  getAuditState: (sessionId?: string) => AuditState | null,
  onStateChanged?: (metadata: ToolExecutionMetadata) => void,
  options?: ToolTrackingOptions,
): ToolTrackingHook {
  const storesByState = new WeakMap<AuditState, FindingStore>()
  let lastDiagnostics: DropDiagnostic[] = []
  const orphanBuffer = new Map<string, OrphanEvent[]>()

  function bufferOrphanEvent(sessionId: string, entry: OrphanEvent): void {
    let entries = orphanBuffer.get(sessionId)
    if (!entries) {
      entries = []
      orphanBuffer.set(sessionId, entries)
    }
    if (entries.length >= MAX_ORPHAN_EVENTS_PER_SESSION) {
      logger.warn(
        `Orphan event buffer full for session ${sessionId} (${MAX_ORPHAN_EVENTS_PER_SESSION} events) — dropping oldest`,
      )
      entries.shift()
    }
    entries.push(entry)
  }

  function resolveStateAndStore(
    sessionId?: string,
  ): { state: AuditState; store: FindingStore } | null {
    const state = getAuditState(sessionId)
    if (!state) return null

    let store = storesByState.get(state)
    if (!store) {
      store = createFindingStore(state)
      storesByState.set(state, store)
    }

    return { state, store }
  }

  const hookFn = async (input: ToolHookInput): Promise<void> => {
    // Handle task tool (subagent dispatch) before argus_ filter
    if (input.tool === "task") {
      const childSessionId = parseChildSessionId(input.result)
      const correlationId = randomUUID()
      const resolved = resolveStateAndStore(input.sessionID)
      const sessionId = input.sessionID ?? options?.getSessionId?.() ?? ""
      const toolCallId = randomUUID()

      if (childSessionId) {
        options?.onChildSessionDetected?.(sessionId, childSessionId)
      }

      let sink: EventSink | null =
        (sessionId ? options?.getEventSinkForSession?.(sessionId) : null) ??
        options?.getEventSink?.() ??
        null

      if (sink && resolved) {
        const runId = resolved.state.sessionId
        if (sink.runId !== runId) {
          const runScopedSink = options?.getEventSinkForRun?.(runId) ?? null
          if (runScopedSink && runScopedSink.runId === runId) {
            sink = runScopedSink
          } else {
            logger.warn(
              `Skipping task sink emission due to run mismatch: state run ${runId}, sink run ${sink.runId}`,
            )
            sink = null
          }
        }
      }

      if (sink && resolved) {
        const runId = resolved.state.sessionId
        await emitToSink(
          sink,
          buildEvent("tool.started", runId, sessionId, toolCallId, {
            tool: "task",
            args: input.args,
            correlation_id: correlationId,
            child_session_id: childSessionId ?? null,
          }),
        )

        await emitToSink(
          sink,
          buildEvent("tool.completed", runId, sessionId, toolCallId, {
            tool: "task",
            findingsCount: 0,
            success: true,
            correlation_id: correlationId,
            child_session_id: childSessionId ?? null,
          }),
        )
      }

      if (resolved) {
        recordToolExecution(resolved.state, "task", 0)
        onStateChanged?.({ tool: "task", findingsCount: 0 })
      }

      return
    }

    if (!input.tool.startsWith("argus_")) {
      return
    }

    const resolved = resolveStateAndStore(input.sessionID)
    if (!resolved) {
      if (input.tool === "argus_record_finding") {
        throw new Error("argus_record_finding requires active audit state")
      }

      const sinkForNoState = options?.getEventSink?.()
      if (sinkForNoState) {
        const toolCallId = randomUUID()
        await emitToSink(
          sinkForNoState,
          buildEvent("tool.started", "", "", toolCallId, {
            tool: input.tool,
            args: input.args,
          }),
        )
        await emitToSink(
          sinkForNoState,
          buildEvent("tool.completed", "", "", toolCallId, {
            tool: input.tool,
            findingsCount: 0,
            success: false,
          }),
        )
      }
      return
    }

    const { state: auditState, store } = resolved
    const runId = auditState.sessionId
    const sessionId = input.sessionID ?? options?.getSessionId?.() ?? ""
    let sink: EventSink | null =
      (sessionId ? options?.getEventSinkForSession?.(sessionId) : null) ??
      options?.getEventSink?.() ??
      null
    if (sink && sink.runId !== runId) {
      const runScopedSink = options?.getEventSinkForRun?.(runId) ?? null
      if (runScopedSink && runScopedSink.runId === runId) {
        sink = runScopedSink
      } else {
        // Single-run coalescence: if exactly one active (non-finalized) sink
        // exists, use it rather than dropping events silently.
        const activeSinks = options?.getActiveRunSinks?.() ?? []
        const coalescedSink = activeSinks.length === 1 ? activeSinks[0] : undefined
        if (coalescedSink) {
          logger.debug(
            `Coalescing tool ${input.tool} from session ${sessionId} into active run ${coalescedSink.runId} (state run ${runId}, original sink run ${sink.runId})`,
          )
          sink = coalescedSink
        } else {
          logger.warn(
            `Skipping sink emission for ${input.tool} due to run mismatch: state run ${runId}, sink run ${sink.runId}`,
          )
          sink = null
        }
      }
    }
    const reportedByAgent =
      (input.sessionID ? options?.getAgentNameForSession?.(input.sessionID) : undefined) ??
      options?.getAgentName?.() ??
      "unknown"
    const findingMetadata = {
      reportedByAgent,
      reportedBySessionId: sessionId,
    }
    const toolCallId = randomUUID()
    const policy = options?.dropPolicy ?? "warn"
    const diag = createDropDiagnosticsCollector(policy, "tool-tracking-hook", input.tool)

    if (sink) {
      await emitToSink(
        sink,
        buildEvent("tool.started", runId, sessionId, toolCallId, {
          tool: input.tool,
          args: input.args,
        }),
        { failFast: input.tool === "argus_record_finding" },
      )
    } else if (sessionId) {
      const event = buildEvent("tool.started", runId, sessionId, toolCallId, {
        tool: input.tool,
        args: input.args,
      })
      bufferOrphanEvent(sessionId, {
        event,
        failFast: input.tool === "argus_record_finding",
        bufferedAt: Date.now(),
      })
      logger.warn(
        `Buffered orphan tool.started event for ${input.tool} from session ${sessionId} (run_id=${runId})`,
      )
    }

    const findingsCountBefore = auditState.findings.length
    let findingsCount = 0
    let completedSuccess = false
    let completionError: string | undefined

    try {
      if (input.tool === "argus_skill_load") {
        const nameMatch = input.result.match(/^##\s+Argus Skill:\s+(.+?)(?:\s+\[|$)/m)
        const skillName = nameMatch?.[1]?.trim()
        if (skillName) {
          auditState.skillsLoaded ??= []
          if (!auditState.skillsLoaded.includes(skillName)) {
            auditState.skillsLoaded.push(skillName)
          }
        }
        findingsCount = 0
        completedSuccess = true
      } else {
        let parsed: unknown
        try {
          parsed = JSON.parse(input.result)
        } catch {
          // For large tool outputs (e.g. argus_check_patterns can produce 3MB+),
          // OpenCode may truncate the result before it reaches this hook.
          // Two truncation modes:
          //   1. Partial JSON — first N bytes of valid JSON (check for "success": true)
          //   2. OpenCode replacement — full output replaced with "...N bytes truncated..."
          const successInPartialJson = input.result.match(/"success"\s*:\s*(true|false)/)
          const opencodeTruncation = input.result.match(
            /bytes truncated|output was truncated|tool call succeeded/i,
          )
          const truncatedSuccess = successInPartialJson?.[1] === "true" || !!opencodeTruncation
          if (truncatedSuccess) {
            diag.error(
              "TRUNCATED_OUTPUT",
              `${input.tool} output was truncated (${input.result.length} chars) — tool likely succeeded`,
            )
            logger.warn(
              `Tool output truncated — findings may be incomplete (${input.tool}, ${input.result.length} chars)`,
            )
            completionError = "Tool output truncated — findings may be incomplete"
          } else {
            diag.error("MALFORMED_JSON", `Failed to parse JSON result from ${input.tool}`)
            if (input.tool === "argus_record_finding") {
              throw new Error("argus_record_finding returned malformed JSON")
            }
          }
          diag.throwIfStrict()
          return
        }

        const record = toRecord(parsed)
        if (!record) {
          if (input.tool === "argus_record_finding") {
            throw new Error("argus_record_finding response must be a JSON object")
          }
          return
        }

        switch (input.tool) {
          case "argus_slither_analyze": {
            findingsCount = processSlitherResult(record, store, diag, findingMetadata)
            if (auditState.scope.length === 0 && findingsCount > 0) {
              const slitherFindings = Array.isArray(record.findings) ? record.findings : []
              const files = [
                ...new Set(
                  slitherFindings
                    .map((f: Record<string, unknown>) => f.file as string)
                    .filter(Boolean),
                ),
              ]
              if (files.length > 0) {
                auditState.scope = files
              }
            }
            break
          }
          case "argus_check_patterns":
            findingsCount = processPatternResult(record, store, diag, findingMetadata)
            if (typeof record.patternVersion === "string") {
              auditState.patternVersion = record.patternVersion
            }
            break
          case "argus_record_finding":
            findingsCount = processRecordedFindingResult(record, store, diag, findingMetadata)
            break
          case "argus_analyze_contract": {
            processContractAnalyzerResult(record, auditState)
            const filePath = (input.args as Record<string, unknown>)?.file_path as string
            if (filePath && !auditState.scope.includes(filePath)) {
              auditState.scope = [...auditState.scope, filePath]
            }
            break
          }
          case "argus_solodit_search":
            processSoloditResult(record, auditState)
            break
          case "argus_forge_test": {
            const summary = toRecord(record.summary)
            if (summary && typeof summary.failed === "number") {
              findingsCount = summary.failed
            }
            break
          }
          case "argus_forge_fuzz":
            processFuzzResult(record, auditState)
            break
          case "argus_generate_report": {
            const reportError = toRecord(record.error)
            const filePath = record.filePath
            if (reportError) {
              const errorMessage =
                typeof reportError.message === "string"
                  ? reportError.message
                  : "argus_generate_report reported an unknown error"
              throw new Error(`argus_generate_report failed: ${errorMessage}`)
            }
            if (typeof filePath !== "string" || filePath.length === 0) {
              throw new Error("argus_generate_report completed without filePath")
            }
            auditState.reportGenerated = true
            break
          }
          case "argus_sync_knowledge": {
            const success = record.success === true
            auditState.knowledgeSynced = { success, timestamp: Date.now() }
            break
          }
          case "argus_forge_coverage": {
            const reportObj = toRecord(record.report)
            const files = reportObj?.files
            if (Array.isArray(files)) {
              auditState.coverageReport = {
                files: files
                  .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
                  .map((f) => ({
                    path: typeof f.path === "string" ? f.path : "unknown",
                    linesPct: typeof f.linesPct === "number" ? f.linesPct : 0,
                    statementsPct: typeof f.statementsPct === "number" ? f.statementsPct : 0,
                    branchesPct: typeof f.branchesPct === "number" ? f.branchesPct : 0,
                    functionsPct: typeof f.functionsPct === "number" ? f.functionsPct : 0,
                  })),
              }
            }
            break
          }
          case "argus_proxy_detection": {
            if (record.isProxy === true) {
              auditState.proxyContracts ??= []
              auditState.proxyContracts.push({
                file: typeof record.file === "string" ? record.file : "unknown",
                proxyType: typeof record.proxyType === "string" ? record.proxyType : "unknown",
                indicators: Array.isArray(record.indicators)
                  ? record.indicators.filter((i): i is string => typeof i === "string")
                  : [],
              })
            }
            break
          }
          case "argus_gas_analysis": {
            const hotspots = record.hotspots
            if (Array.isArray(hotspots)) {
              auditState.gasHotspots = hotspots
                .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
                .map((h) => ({
                  contract: typeof h.contract === "string" ? h.contract : "unknown",
                  function: typeof h.function === "string" ? h.function : "unknown",
                  avgGas: typeof h.avgGas === "number" ? h.avgGas : 0,
                }))
            }
            break
          }
        }

        diag.throwIfStrict()

        if (input.tool === "argus_record_finding" && findingsCount === 0) {
          throw new Error("argus_record_finding did not persist any findings")
        }

        if (input.tool === "argus_record_finding" && !sink) {
          const newFindings = auditState.findings.slice(findingsCountBefore)
          if (newFindings.length > 0) {
            throw new Error(
              `argus_record_finding produced ${newFindings.length} finding(s) but no event sink is available — findings would be lost from the report`,
            )
          }
          diag.error(
            "NO_EVENT_SINK",
            "argus_record_finding: no active event sink — no new findings to emit",
          )
        }

        if (sink) {
          const failFast = input.tool === "argus_record_finding"
          const newFindings = auditState.findings.slice(findingsCountBefore)
          for (const [index, finding] of newFindings.entries()) {
            const { data: canonical } = normalizeToCanonicalFinding(finding, runId, 0, {
              reportedByAgent,
              reportedBySessionId: sessionId,
              toolCallId,
              observationId: `${toolCallId}:${index + 1}`,
            })
            await emitToSink(
              sink,
              buildEvent("finding.added", runId, sessionId, toolCallId, canonical),
              { failFast },
            )
          }
        }

        completedSuccess = true
      }

      recordToolExecution(auditState, input.tool, findingsCount)

      const nextPhase = inferPhaseAdvancement(auditState, input.tool)
      if (nextPhase) {
        auditState.currentPhase = nextPhase
        if (sink) {
          await emitToSink(
            sink,
            buildEvent("phase.changed", runId, sessionId, toolCallId, {
              phase: nextPhase,
              trigger: input.tool,
            }),
          )
        }
      }

      onStateChanged?.({ tool: input.tool, findingsCount })
    } catch (error) {
      completionError = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      lastDiagnostics = diag.getDiagnostics()
      if (sink) {
        const failFast = input.tool === "argus_record_finding"
        // Enrichment data for event replay — projector extracts these from payloads
        const enrichment: Record<string, unknown> = {}
        if (completedSuccess) {
          switch (input.tool) {
            case "argus_solodit_search":
              if (auditState.soloditResults) enrichment.soloditResults = auditState.soloditResults
              break
            case "argus_forge_fuzz":
              if (auditState.fuzzCounterexamples)
                enrichment.fuzzCounterexamples = auditState.fuzzCounterexamples
              break
            case "argus_forge_coverage":
              if (auditState.coverageReport) enrichment.coverageReport = auditState.coverageReport
              break
            case "argus_gas_analysis":
              if (auditState.gasHotspots) enrichment.gasHotspots = auditState.gasHotspots
              break
            case "argus_proxy_detection":
              if (auditState.proxyContracts) enrichment.proxyContracts = auditState.proxyContracts
              break
            case "argus_skill_load":
              if (auditState.skillsLoaded) enrichment.skillsLoaded = auditState.skillsLoaded
              break
            case "argus_check_patterns":
              if (auditState.patternVersion) enrichment.patternVersion = auditState.patternVersion
              break
          }
        }
        await emitToSink(
          sink,
          buildEvent("tool.completed", runId, sessionId, toolCallId, {
            tool: input.tool,
            findingsCount,
            success: completedSuccess,
            ...(completionError ? { error: completionError } : {}),
            ...enrichment,
          }),
          { failFast },
        )
      } else if (sessionId) {
        const enrichment: Record<string, unknown> = {}
        const event = buildEvent("tool.completed", runId, sessionId, toolCallId, {
          tool: input.tool,
          findingsCount,
          success: completedSuccess,
          ...(completionError ? { error: completionError } : {}),
          ...enrichment,
        })
        bufferOrphanEvent(sessionId, {
          event,
          failFast: input.tool === "argus_record_finding",
          bufferedAt: Date.now(),
        })
        logger.warn(
          `Buffered orphan tool.completed event for ${input.tool} from session ${sessionId} (run_id=${runId}, findings=${findingsCount})`,
        )
      }
    }
  }

  hookFn.getLastDiagnostics = (): DropDiagnostic[] => lastDiagnostics

  hookFn.flushOrphanEvents = async (sessionId: string, sink: EventSink): Promise<number> => {
    const entries = orphanBuffer.get(sessionId)
    if (!entries || entries.length === 0) {
      return 0
    }

    orphanBuffer.delete(sessionId)
    const now = Date.now()
    const fresh = entries.filter((e) => now - e.bufferedAt < ORPHAN_BUFFER_TTL_MS)

    if (fresh.length < entries.length) {
      logger.debug(
        `Discarded ${entries.length - fresh.length} stale orphan events for session ${sessionId}`,
      )
    }

    let flushed = 0
    for (const entry of fresh) {
      await emitToSink(sink, entry.event, { failFast: entry.failFast })
      flushed++
    }

    if (flushed > 0) {
      logger.info(`Flushed ${flushed} orphan events for session ${sessionId} to sink ${sink.runId}`)
    }

    return flushed
  }

  return hookFn
}
