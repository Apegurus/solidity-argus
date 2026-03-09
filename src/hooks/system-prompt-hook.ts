import type { AuditState, FindingSeverity } from "../state/types"

const DEFAULT_TOKEN_BUDGET = 2000
const TOKENS_PER_CHAR = 4

const TOOL_SHORT_NAMES: Record<string, string> = {
  argus_slither_analyze: "slither",
  argus_forge_test: "forge-test",
  argus_check_patterns: "patterns",
  argus_solodit_search: "solodit",
  argus_analyze_contract: "analyzer",
}
const KEY_TOOLS = ["slither", "forge-test", "patterns", "solodit", "analyzer"]

/** Maps unavailable-tool short names to their KEY_TOOLS counterpart */
const UNAVAILABLE_TO_KEY_TOOL: Record<string, string> = {
  slither: "slither",
  forge: "forge-test",
  solodit: "solodit",
}

export interface SystemPromptHookDeps {
  getAuditState: () => AuditState | null
  getAgentForSession: (sessionID: string) => string | undefined
  isArgusAgent: (sessionID: string) => boolean
  getContextPressure?: (systemText: string) => number
  getTokenBudget?: (agent: string, contextPressure: number) => number
  getEnforcerReminder?: (state: AuditState) => string | null
  getReconBlock?: () => string | null
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

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKENS_PER_CHAR)
}

export function buildDynamicContext(
  auditState: AuditState,
  agent: string,
  tokenBudget: number = DEFAULT_TOKEN_BUDGET,
): string {
  const severityCounts: Record<FindingSeverity, number> = {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
    Informational: 0,
  }

  for (const finding of auditState.findings) {
    severityCounts[finding.severity]++
  }

  const executedToolNames = new Set(
    auditState.toolsExecuted.map((t) => TOOL_SHORT_NAMES[t.tool] ?? t.tool),
  )
  const tools = auditState.toolsExecuted.map((tool) => tool.tool).join(", ") || "none"
  const taskStatus = KEY_TOOLS.map(
    (t) => `${t}=${executedToolNames.has(t) ? "done" : "pending"}`,
  ).join(" ")
  const unavailable = auditState.unavailableTools ?? []
  const excusedTools = new Set(unavailable.map((t) => UNAVAILABLE_TO_KEY_TOOL[t]).filter(Boolean))
  const pendingKeyTools = KEY_TOOLS.filter((t) => !executedToolNames.has(t) && !excusedTools.has(t))
  const gateStatus =
    pendingKeyTools.length > 0
      ? `REPORTING GATE: BLOCKED \u2014 key tools pending: ${pendingKeyTools.join(", ")}`
      : "REPORTING GATE: ALLOWED"
  const lines: string[] = [
    `<argus-context agent="${agent}">`,
    gateStatus,
    `Phase: ${auditState.currentPhase}`,
    `Contracts: ${auditState.contractsReviewed.length} reviewed`,
    `Findings: Critical=${severityCounts.Critical} High=${severityCounts.High} Medium=${severityCounts.Medium} Low=${severityCounts.Low} Info=${severityCounts.Informational}`,
    `Tools: ${tools}`,
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

    const auditState = deps.getAuditState()
    if (!auditState) {
      return
    }

    const agent = deps.getAgentForSession(input.sessionID)
    if (!agent) {
      return
    }

    const currentSystem = output.system.join("\n")
    const pressure = deps.getContextPressure?.(currentSystem) ?? 0
    const budget = deps.getTokenBudget?.(agent, pressure) ?? DEFAULT_TOKEN_BUDGET

    output.system.push(buildDynamicContext(auditState, agent, budget))

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
