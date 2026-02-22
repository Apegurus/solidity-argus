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
import type { AuditState, FindingSeverity, FuzzCounterexample, SoloditResult } from "../state/types"

const logger = createLogger()

type ToolHookInput = {
  tool: string
  args: unknown
  result: string
}

type ToolExecutionMetadata = {
  tool: string
  findingsCount: number
}

export type ToolTrackingOptions = {
  getEventSink?: () => EventSink | null
  getSessionId?: () => string
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

async function emitToSink(sink: EventSink, event: AuditEvent): Promise<void> {
  try {
    await sink.append(event)
  } catch (error) {
    logger.error(
      `Failed to emit ${event.type} event to sink: ${error instanceof Error ? error.message : String(error)}`,
    )
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
    const match = result.match(/"session_id"\s*:\s*"([^"]+)"/)
    if (match?.[1]) {
      return match[1]
    }
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

function processSlitherResult(
  parsed: Record<string, unknown>,
  store: FindingStore,
  diag: DropDiagnosticsCollector,
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
    })
    count++
  }

  return count
}

function processPatternResult(
  parsed: Record<string, unknown>,
  store: FindingStore,
  diag: DropDiagnosticsCollector,
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
      })
      count++
    }
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

export type ToolTrackingHook = {
  (input: ToolHookInput): Promise<void>
  getLastDiagnostics(): DropDiagnostic[]
}

export function createToolTrackingHook(
  getAuditState: () => AuditState | null,
  onStateChanged?: (metadata: ToolExecutionMetadata) => void,
  options?: ToolTrackingOptions,
): ToolTrackingHook {
  const storesByState = new WeakMap<AuditState, FindingStore>()
  let lastDiagnostics: DropDiagnostic[] = []

  function resolveStateAndStore(): { state: AuditState; store: FindingStore } | null {
    const state = getAuditState()
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
      const resolved = resolveStateAndStore()
      const sink = options?.getEventSink?.()
      const sessionId = options?.getSessionId?.() ?? ""
      const toolCallId = randomUUID()

      if (childSessionId) {
        options?.onChildSessionDetected?.(sessionId, childSessionId)
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

    const resolved = resolveStateAndStore()
    if (!resolved) {
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
    const sink = options?.getEventSink?.()
    const runId = auditState.sessionId
    const sessionId = options?.getSessionId?.() ?? ""
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
      )
    }

    const findingsCountBefore = auditState.findings.length

    if (input.tool === "argus_skill_load") {
      const nameMatch = input.result.match(/^##\s+Argus Skill:\s+(.+?)(?:\s+\[|$)/m)
      const skillName = nameMatch?.[1]?.trim()
      if (skillName) {
        auditState.skillsLoaded ??= []
        if (!auditState.skillsLoaded.includes(skillName)) {
          auditState.skillsLoaded.push(skillName)
        }
      }
      recordToolExecution(auditState, input.tool, 0)
      onStateChanged?.({ tool: input.tool, findingsCount: 0 })

      if (sink) {
        await emitToSink(
          sink,
          buildEvent("tool.completed", runId, sessionId, toolCallId, {
            tool: input.tool,
            findingsCount: 0,
            success: true,
          }),
        )
      }

      lastDiagnostics = diag.getDiagnostics()
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(input.result)
    } catch {
      diag.error("MALFORMED_JSON", `Failed to parse JSON result from ${input.tool}`)
      lastDiagnostics = diag.getDiagnostics()
      diag.throwIfStrict()
      return
    }

    const record = toRecord(parsed)
    if (!record) {
      lastDiagnostics = diag.getDiagnostics()
      return
    }

    let findingsCount = 0

    switch (input.tool) {
      case "argus_slither_analyze":
        findingsCount = processSlitherResult(record, store, diag)
        break
      case "argus_check_patterns":
        findingsCount = processPatternResult(record, store, diag)
        break
      case "argus_analyze_contract":
        processContractAnalyzerResult(record, auditState)
        break
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

    lastDiagnostics = diag.getDiagnostics()
    diag.throwIfStrict()

    recordToolExecution(auditState, input.tool, findingsCount)
    onStateChanged?.({ tool: input.tool, findingsCount })

    if (sink) {
      const newFindings = auditState.findings.slice(findingsCountBefore)
      for (const finding of newFindings) {
        const { data: canonical } = normalizeToCanonicalFinding(finding, runId, 0)
        await emitToSink(sink, buildEvent("finding.added", runId, sessionId, toolCallId, canonical))
      }

      await emitToSink(
        sink,
        buildEvent("tool.completed", runId, sessionId, toolCallId, {
          tool: input.tool,
          findingsCount,
          success: true,
        }),
      )
    }
  }

  hookFn.getLastDiagnostics = (): DropDiagnostic[] => lastDiagnostics

  return hookFn
}
