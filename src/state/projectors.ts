import { createHash } from "node:crypto"
import { isRecord } from "../shared/type-guards"
import { SEVERITY_RANK } from "../shared/validation-constants"
import {
  type AuditEvent,
  type CanonicalFinding,
  type CanonicalToolExecution,
  type ReportInput,
  SCHEMA_VERSION,
  validateCanonicalFinding,
} from "./schemas"
import type {
  AuditPhase,
  AuditState,
  CoverageAttemptState,
  Finding,
  FindingCounts,
  FuzzCounterexample,
  SoloditResult,
  ToolExecution,
} from "./types"

type ProjectorErrorCode = "OUT_OF_ORDER" | "DUPLICATE_SEQ" | "INVALID_EVENT"

type CoverageReport = NonNullable<AuditState["coverageReport"]>
type GasHotspot = NonNullable<AuditState["gasHotspots"]>[number]
type ProxyContract = NonNullable<AuditState["proxyContracts"]>[number]

export class ProjectorError extends Error {
  readonly code: ProjectorErrorCode

  constructor(code: ProjectorErrorCode, message: string) {
    super(message)
    this.name = "ProjectorError"
    this.code = code
  }
}

function extractScope(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.scope)) return []
  return payload.scope.filter((entry): entry is string => typeof entry === "string")
}

const VALID_PHASES = new Set<string>([
  "reconnaissance",
  "scanning",
  "manual-review",
  "attack-surface",
  "research",
  "testing",
  "reporting",
  "complete",
])

function isAuditPhase(value: string): value is AuditPhase {
  return VALID_PHASES.has(value)
}

function extractPhase(payload: unknown): AuditPhase | undefined {
  if (typeof payload === "string") {
    return isAuditPhase(payload) ? payload : undefined
  }

  if (!isRecord(payload)) return undefined

  if (typeof payload.phase === "string" && isAuditPhase(payload.phase)) {
    return payload.phase
  }

  if (typeof payload.currentPhase === "string" && isAuditPhase(payload.currentPhase)) {
    return payload.currentPhase
  }

  return undefined
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}

function getPayloadRecord(event: AuditEvent): Record<string, unknown> {
  if (!isRecord(event.payload)) {
    throw new ProjectorError("INVALID_EVENT", `event seq ${event.seq} payload must be an object`)
  }
  return event.payload
}

function resolveToolName(event: AuditEvent, payload: Record<string, unknown>): string {
  if (typeof payload.tool === "string" && payload.tool.length > 0) {
    return payload.tool
  }
  return event.source
}

function resolveFindingsCount(payload: Record<string, unknown>): number {
  const count = typeof payload.findingsCount === "number" ? payload.findingsCount : 0
  return Number.isFinite(count) ? Math.max(0, count) : 0
}

function resolveToolSuccess(payload: Record<string, unknown>): boolean {
  return payload.success !== false
}

const FINDING_COUNT_FIELDS = [
  "rawObservations",
  "recordedFindings",
  "dedupedFindings",
  "actionableFindings",
  "nonActionableFindings",
] as const

function asFindingCounts(value: unknown): FindingCounts | undefined {
  if (!isRecord(value)) return undefined
  const counts: FindingCounts = {}
  for (const field of FINDING_COUNT_FIELDS) {
    const count = value[field]
    if (
      typeof count === "number" &&
      Number.isFinite(count) &&
      Number.isInteger(count) &&
      count >= 0
    ) {
      counts[field] = count
    }
  }
  return Object.keys(counts).length > 0 ? counts : undefined
}

function asCoverageAttempt(value: unknown): CoverageAttemptState | undefined {
  if (!isRecord(value)) return undefined
  if (
    value.status !== "pending" &&
    value.status !== "run" &&
    value.status !== "skipped" &&
    value.status !== "failed"
  ) {
    return undefined
  }
  return {
    status: value.status,
    attemptedAt: typeof value.attemptedAt === "number" ? value.attemptedAt : undefined,
    reason: typeof value.reason === "string" ? value.reason : undefined,
  }
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string")
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function asPassedTests(value: unknown): string[] | undefined {
  const tests = asStringArray(value)
  return tests && tests.length > 0 ? tests : undefined
}

function asSoloditResults(value: unknown): SoloditResult[] | undefined {
  if (!Array.isArray(value)) return undefined

  const results: SoloditResult[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    if (typeof raw.query !== "string" || typeof raw.timestamp !== "number") continue
    if (typeof raw.resultCount !== "number" || !Array.isArray(raw.topResults)) continue
    const topResults = raw.topResults
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry) => ({
        title: typeof entry.title === "string" ? entry.title : "",
        severity: typeof entry.severity === "string" ? entry.severity : "",
        url: typeof entry.url === "string" ? entry.url : "",
        protocol: typeof entry.protocol === "string" ? entry.protocol : "",
      }))

    results.push({
      query: raw.query,
      timestamp: raw.timestamp,
      resultCount: raw.resultCount,
      topResults,
    })
  }

  return results
}

function asFuzzCounterexamples(value: unknown): FuzzCounterexample[] | undefined {
  if (!Array.isArray(value)) return undefined

  const results: FuzzCounterexample[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    if (typeof raw.testName !== "string" || typeof raw.runs !== "number") continue
    if (typeof raw.timestamp !== "number") continue

    const inputs = asStringArray(raw.inputs) ?? []
    results.push({
      testName: raw.testName,
      inputs,
      runs: raw.runs,
      seed: typeof raw.seed === "number" ? raw.seed : undefined,
      revertReason: typeof raw.revertReason === "string" ? raw.revertReason : undefined,
      timestamp: raw.timestamp,
    })
  }

  return results
}

function asCoverageReport(value: unknown): CoverageReport | undefined {
  if (!isRecord(value) || !Array.isArray(value.files)) return undefined

  const files = value.files
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => ({
      path: typeof entry.path === "string" ? entry.path : "",
      linesPct: typeof entry.linesPct === "number" ? entry.linesPct : 0,
      statementsPct: typeof entry.statementsPct === "number" ? entry.statementsPct : 0,
      branchesPct: typeof entry.branchesPct === "number" ? entry.branchesPct : 0,
      functionsPct: typeof entry.functionsPct === "number" ? entry.functionsPct : 0,
    }))

  return { files }
}

function asGasHotspots(value: unknown): GasHotspot[] | undefined {
  if (!Array.isArray(value)) return undefined

  return value
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => ({
      contract: typeof entry.contract === "string" ? entry.contract : "",
      function: typeof entry.function === "string" ? entry.function : "",
      avgGas: typeof entry.avgGas === "number" ? entry.avgGas : 0,
    }))
}

function asProxyContracts(value: unknown): ProxyContract[] | undefined {
  if (!Array.isArray(value)) return undefined

  return value
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => ({
      file: typeof entry.file === "string" ? entry.file : "",
      proxyType: typeof entry.proxyType === "string" ? entry.proxyType : "",
      indicators: asStringArray(entry.indicators) ?? [],
    }))
}

function extractLatestFromPayload<T>(
  events: AuditEvent[],
  key: string,
  parser: (value: unknown) => T | undefined,
): T | undefined {
  let latest: T | undefined

  for (const event of events) {
    if (!isRecord(event.payload)) continue
    if (!(key in event.payload)) continue

    const parsed = parser(event.payload[key])
    if (parsed !== undefined) {
      latest = parsed
    }
  }

  return latest
}

export function validateEventSequence(events: AuditEvent[]): void {
  if (events.length === 0) return

  const seen = new Set<number>()

  for (const event of events) {
    if (!Number.isInteger(event.seq) || event.seq <= 0) {
      throw new ProjectorError("INVALID_EVENT", `invalid seq ${event.seq}`)
    }

    if (seen.has(event.seq)) {
      throw new ProjectorError("DUPLICATE_SEQ", `duplicate seq ${event.seq}`)
    }

    seen.add(event.seq)
  }

  for (let i = 0; i < events.length; i++) {
    const expectedSeq = i + 1
    const actualSeq = events[i]?.seq
    if (actualSeq !== expectedSeq) {
      throw new ProjectorError(
        "OUT_OF_ORDER",
        `expected seq ${expectedSeq} at index ${i}, got ${String(actualSeq)}`,
      )
    }
  }
}

export function projectFindings(events: AuditEvent[]): CanonicalFinding[] {
  validateEventSequence(events)

  const findings: CanonicalFinding[] = []

  for (const event of events) {
    if (event.type !== "finding.added") continue

    const validation = validateCanonicalFinding(event.payload)
    if (!validation.success) {
      throw new ProjectorError(
        "INVALID_EVENT",
        `invalid finding payload at seq ${event.seq}: ${validation.errors.map((e) => e.field).join(",")}`,
      )
    }

    findings.push({
      ...validation.data,
      seq: event.seq,
      run_id: event.run_id,
    })
  }

  return findings.sort((left, right) => {
    const bySeverity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    if (bySeverity !== 0) return bySeverity

    const byFile = left.file.localeCompare(right.file)
    if (byFile !== 0) return byFile

    const byLine = left.lines[0] - right.lines[0]
    if (byLine !== 0) return byLine

    const byIssue = left.issue_fingerprint.localeCompare(right.issue_fingerprint)
    if (byIssue !== 0) return byIssue

    const byObservation = left.observation_fingerprint.localeCompare(right.observation_fingerprint)
    if (byObservation !== 0) return byObservation

    const byId = left.id.localeCompare(right.id)
    if (byId !== 0) return byId

    return left.seq - right.seq
  })
}

export function projectToolExecutions(events: AuditEvent[]): CanonicalToolExecution[] {
  validateEventSequence(events)

  const executionsByCallId = new Map<string, CanonicalToolExecution>()

  for (const event of events) {
    if (event.type !== "tool.started" && event.type !== "tool.completed") continue
    if (typeof event.tool_call_id !== "string" || event.tool_call_id.length === 0) {
      throw new ProjectorError(
        "INVALID_EVENT",
        `${event.type} at seq ${event.seq} missing tool_call_id`,
      )
    }

    const payload = getPayloadRecord(event)
    const existing = executionsByCallId.get(event.tool_call_id)

    if (event.type === "tool.started") {
      executionsByCallId.set(event.tool_call_id, {
        run_id: event.run_id,
        schema_version: event.schema_version,
        tool: resolveToolName(event, payload),
        startTime: event.timestamp,
        endTime: existing?.endTime,
        success: existing?.success ?? false,
        findingsCount: existing?.findingsCount ?? 0,
        findingCounts: existing?.findingCounts,
        passed_tests: existing?.passed_tests,
      })
      continue
    }

    const base: CanonicalToolExecution = existing ?? {
      run_id: event.run_id,
      schema_version: event.schema_version,
      tool: resolveToolName(event, payload),
      startTime: event.timestamp,
      success: false,
      findingsCount: 0,
    }

    executionsByCallId.set(event.tool_call_id, {
      ...base,
      tool: resolveToolName(event, payload),
      endTime: event.timestamp,
      success: resolveToolSuccess(payload),
      findingsCount: resolveFindingsCount(payload),
      findingCounts: asFindingCounts(payload.findingCounts),
      passed_tests: asPassedTests(payload.passed_tests) ?? base.passed_tests,
      run_id: event.run_id,
      schema_version: event.schema_version,
    })
  }

  return Array.from(executionsByCallId.values()).sort((left, right) => {
    if (left.startTime !== right.startTime) {
      return left.startTime - right.startTime
    }
    return left.tool.localeCompare(right.tool)
  })
}

export function projectAuditState(events: AuditEvent[], projectDir: string): AuditState {
  validateEventSequence(events)

  const sessionCreated = events.find((event) => event.type === "session.created")
  const scope = sessionCreated ? extractScope(sessionCreated.payload) : []

  const findings = projectFindings(events)
  const toolsExecuted = projectToolExecutions(events)

  const contractsReviewed = sortedUnique(
    findings.map((finding) => finding.file).filter((file) => file.length > 0),
  )

  let currentPhase: AuditPhase = "reconnaissance"
  for (const event of events) {
    if (event.type !== "phase.changed") continue
    const phase = extractPhase(event.payload)
    if (phase) {
      currentPhase = phase
    }
  }

  return {
    sessionId: sessionCreated?.session_id ?? events[0]?.session_id ?? "",
    projectDir,
    contractsReviewed,
    findings: findings as Finding[],
    toolsExecuted: toolsExecuted as ToolExecution[],
    currentPhase,
    scope,
    startTime: events[0]?.timestamp ?? 0,
  }
}

export function projectReportInput(
  events: AuditEvent[],
  runId: string,
  projectDir: string,
): ReportInput {
  validateEventSequence(events)

  const sessionCreated = events.find((event) => event.type === "session.created")
  const latestFinalized = [...events].reverse().find((event) => event.type === "run.finalized")

  const findings = projectFindings(events)
  const toolsExecuted = projectToolExecutions(events)

  const scope = sessionCreated ? extractScope(sessionCreated.payload) : []
  const soloditResults = extractLatestFromPayload(events, "soloditResults", asSoloditResults)
  const fuzzCounterexamples = extractLatestFromPayload(
    events,
    "fuzzCounterexamples",
    asFuzzCounterexamples,
  )
  const coverageReport = extractLatestFromPayload(events, "coverageReport", asCoverageReport)
  const coverageAttempt = extractLatestFromPayload(events, "coverageAttempt", asCoverageAttempt)
  const findingCounts = extractLatestFromPayload(events, "findingCounts", asFindingCounts)
  const gasHotspots = extractLatestFromPayload(events, "gasHotspots", asGasHotspots)
  const proxyContracts = extractLatestFromPayload(events, "proxyContracts", asProxyContracts)
  const patternVersion = extractLatestFromPayload(events, "patternVersion", asString)
  const skillsLoaded = extractLatestFromPayload(events, "skillsLoaded", asStringArray)
  const unavailableTools = extractLatestFromPayload(events, "unavailableTools", asStringArray)

  return {
    run_id: runId,
    seq: events.at(-1)?.seq ?? 0,
    session_id: sessionCreated?.session_id ?? events[0]?.session_id ?? "",
    tool_call_id: latestFinalized?.tool_call_id ?? "pending-finalization",
    source: latestFinalized?.source ?? events[0]?.source ?? "projector",
    schema_version: latestFinalized?.schema_version ?? events[0]?.schema_version ?? SCHEMA_VERSION,
    projectDir,
    findings,
    toolsExecuted,
    findingCounts,
    scope,
    soloditResults,
    fuzzCounterexamples,
    coverageReport,
    coverageAttempt,
    gasHotspots,
    proxyContracts,
    patternVersion,
    skillsLoaded,
    unavailableTools,
  }
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortForStableStringify(item))
  }

  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
      out[key] = sortForStableStringify(value[key])
    }
    return out
  }

  return value
}

export function stableHash(obj: unknown): string {
  const stable = sortForStableStringify(obj)
  const json = JSON.stringify(stable)
  return createHash("sha256").update(json).digest("hex")
}
