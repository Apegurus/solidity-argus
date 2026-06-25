import { computeMissingKeyTools, KEY_TOOLS, TOOL_SHORT_NAMES } from "../shared/key-tools"
import { estimateTokens } from "../shared/token-utils"
import { countBySeverity } from "../shared/validation-constants"
import type { AuditState } from "../state/types"

export { estimateTokens }

const DEFAULT_TOKEN_BUDGET = 2000

export type ReportingThresholds = {
  confidenceThreshold: number
  severityThreshold: string
}

export interface SystemPromptHookDeps {
  getAuditState: (sessionId?: string) => AuditState | null
  getAgentForSession: (sessionID: string) => string | undefined
  isArgusAgent: (sessionID: string) => boolean
  getContextPressure?: (systemText: string, sessionId?: string) => number
  getTokenBudget?: (agent: string, contextPressure: number) => number
  getEnforcerReminder?: (state: AuditState) => string | null
  getReconBlock?: () => string | null
  getReportingThresholds?: () => ReportingThresholds | undefined
}

const FALLBACK_DIRECTIVES: Record<string, string> = {
  slither:
    "DO NOT re-attempt argus_slither_analyze. Use `argus_analyze_contract` and `argus_check_patterns` instead. Note limitation in report.",
  forge:
    "DO NOT re-attempt argus_forge_test or argus_forge_fuzz. Verify findings via manual code tracing. Note limitation in report.",
  solodit:
    "DO NOT re-attempt argus_solodit_search. Use `argus_check_patterns` with local rules. Note limitation in report.",
}

export function buildFallbackDirectives(unavailableTools: string[]): string[] {
  const directives: string[] = []
  for (const tool of unavailableTools) {
    const directive = FALLBACK_DIRECTIVES[tool]
    if (directive) directives.push(directive)
  }
  return directives
}

function formatDuration(startTime: number, endTime?: number): string {
  if (typeof endTime !== "number" || endTime < startTime) return "pending"
  return `${endTime - startTime}ms`
}

function buildToolLedgerLine(auditState: AuditState): string {
  const taskTools = auditState.toolsExecuted.filter((tool) => tool.tool === "task")
  const taskDispatches = taskTools.length
  const argusTools = auditState.toolsExecuted.filter((tool) => tool.tool !== "task").slice(-5)
  const entries = argusTools.map((tool) => {
    const status = tool.success ? "ok" : "failed"
    return `${tool.tool}=${status} findings=${tool.findingsCount} duration=${formatDuration(tool.startTime, tool.endTime)}`
  })

  if (taskDispatches > 0) {
    const bySubagent = new Map<string, number>()
    for (const tool of taskTools) {
      const subagent = tool.subagent_type ?? "unknown"
      bySubagent.set(subagent, (bySubagent.get(subagent) ?? 0) + 1)
    }
    const subagentSummary = [...bySubagent.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([subagent, count]) => `${subagent}=${count}`)
      .join(" ")
    entries.push(
      subagentSummary.length > 0
        ? `task dispatches=${taskDispatches} (${subagentSummary})`
        : `task dispatches=${taskDispatches}`,
    )
  }
  return entries.length > 0 ? entries.join("; ") : "none"
}

function buildToolsLine(auditState: AuditState): string {
  const tools = auditState.toolsExecuted
    .filter((tool) => tool.tool !== "task")
    .map((tool) => tool.tool)
  return tools.length > 0 ? tools.join(", ") : "none"
}

function buildFindingCountsLine(auditState: AuditState): string | null {
  const counts = auditState.findingCounts
  if (!counts) return null

  return [
    "Finding Counts:",
    `raw_observations=${counts.rawObservations ?? 0}`,
    `recorded=${counts.recordedFindings ?? 0}`,
    `deduped=${counts.dedupedFindings ?? 0}`,
    `actionable=${counts.actionableFindings ?? 0}`,
    `non_actionable=${counts.nonActionableFindings ?? 0}`,
  ].join(" ")
}

function buildCoverageLine(auditState: AuditState): string {
  const attempt = auditState.coverageAttempt
  if (attempt) {
    return attempt.reason
      ? `Coverage: ${attempt.status} — ${attempt.reason}`
      : `Coverage: ${attempt.status}`
  }
  const unavailable = auditState.unavailableTools ?? []
  return unavailable.includes("forge")
    ? "Coverage: skipped — forge unavailable"
    : "Coverage: pending"
}

export function buildDynamicContext(
  auditState: AuditState,
  agent: string,
  tokenBudget: number = DEFAULT_TOKEN_BUDGET,
  reportingThresholds?: ReportingThresholds,
): string {
  const severityCounts = countBySeverity(auditState.findings)

  const executedToolNames = new Set(
    auditState.toolsExecuted.map((t) => TOOL_SHORT_NAMES[t.tool] ?? t.tool),
  )
  const findingCountsLine = buildFindingCountsLine(auditState)
  const reportingLine = reportingThresholds
    ? `Reporting: confidenceThreshold=${reportingThresholds.confidenceThreshold} severityThreshold=${reportingThresholds.severityThreshold}`
    : null
  const taskStatus = KEY_TOOLS.map(
    (t) => `${t}=${executedToolNames.has(t) ? "done" : "pending"}`,
  ).join(" ")
  const unavailable = auditState.unavailableTools ?? []
  const pendingKeyTools = computeMissingKeyTools(auditState.toolsExecuted, unavailable)
  // The orchestrator's session ledger never records subagent tool runs (those land in the
  // subagent's session), so once subagents are dispatched, missing key tools are delegated,
  // not a hard block; true coverage is enforced run-scoped by the report preflight.
  const dispatchedSubagents = auditState.toolsExecuted.some((exec) => exec.tool === "task")
  const gateStatus =
    pendingKeyTools.length === 0
      ? "REPORTING GATE: ALLOWED"
      : dispatchedSubagents
        ? `REPORTING GATE: DELEGATED \u2014 key tools not observed in this orchestrator session (${pendingKeyTools.join(", ")}); they run in dispatched subagents. Report-time coverage only sees the canonical run's own journal, so confirm delegated tool runs reached the canonical run_id before reporting.`
        : `REPORTING GATE: BLOCKED \u2014 key tools pending: ${pendingKeyTools.join(", ")}`
  const lines: string[] = [
    `<argus-context agent="${agent}">`,
    ...(auditState.sessionId ? [`run_id: ${auditState.sessionId}`] : []),
    gateStatus,
    `Phase: ${auditState.currentPhase}`,
    `Contracts: ${auditState.contractsReviewed.length} reviewed`,
    `Findings: Critical=${severityCounts.Critical} High=${severityCounts.High} Medium=${severityCounts.Medium} Low=${severityCounts.Low} Info=${severityCounts.Informational}`,
    ...(findingCountsLine ? [findingCountsLine] : []),
    ...(reportingLine ? [reportingLine] : []),
    `Tools: ${buildToolsLine(auditState)}`,
    `Tool Ledger: ${buildToolLedgerLine(auditState)}`,
    buildCoverageLine(auditState),
    `Tasks: ${taskStatus}`,
  ]

  if (unavailable.length > 0) {
    lines.push(`Unavailable: ${unavailable.join(", ")}`)
    lines.push(...buildFallbackDirectives(unavailable))
  }

  if (auditState.currentPhase === "reporting" && !auditState.reportGenerated) {
    lines.push(
      "REPORT GENERATION: INCOMPLETE — Scribe was dispatched but argus_generate_report was not called. Re-dispatch Scribe or call argus_generate_report directly.",
    )
  }

  lines.push("</argus-context>")

  let summary = lines.join("\n")

  if (estimateTokens(summary) > tokenBudget) {
    const doneCount = KEY_TOOLS.filter((t) => executedToolNames.has(t)).length
    summary = [
      `<argus-context agent="${agent}">`,
      ...(auditState.sessionId ? [`run_id: ${auditState.sessionId}`] : []),
      gateStatus,
      `Phase: ${auditState.currentPhase} | Findings: ${auditState.findings.length} | Contracts: ${auditState.contractsReviewed.length} | Tasks: ${doneCount}/${KEY_TOOLS.length} done`,
      "</argus-context>",
    ].join("\n")
  }

  return summary
}

export function createSystemPromptHook(deps: SystemPromptHookDeps) {
  return async (
    input: { sessionID?: string; model: unknown },
    output: { system: string[] },
  ): Promise<void> => {
    if (!input.sessionID) {
      return
    }

    if (!deps.isArgusAgent(input.sessionID)) {
      return
    }

    const auditState = deps.getAuditState(input.sessionID)
    if (!auditState) {
      return
    }

    const agent = deps.getAgentForSession(input.sessionID)
    if (!agent) {
      return
    }

    const currentSystem = output.system.join("\n")
    const pressure = deps.getContextPressure?.(currentSystem, input.sessionID) ?? 0
    const budget = deps.getTokenBudget?.(agent, pressure) ?? DEFAULT_TOKEN_BUDGET
    const reportingThresholds = deps.getReportingThresholds?.()

    output.system.push(buildDynamicContext(auditState, agent, budget, reportingThresholds))

    if (deps.getReconBlock) {
      const reconBlock = deps.getReconBlock()
      if (reconBlock && estimateTokens(reconBlock) <= budget) {
        output.system.push(reconBlock)
      }
    }

    if (agent === "argus" && deps.getEnforcerReminder) {
      const reminder = deps.getEnforcerReminder(auditState)
      if (reminder) {
        output.system.push(reminder)
      }
    }
  }
}
