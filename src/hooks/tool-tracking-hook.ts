import type { AuditState, FindingSeverity, FuzzCounterexample, SoloditResult } from "../state/types"
import type { FindingStore } from "../state/finding-store"
import { createFindingStore } from "../state/finding-store"

type ToolHookInput = {
  tool: string
  args: unknown
  result: string
}

type ToolExecutionMetadata = {
  tool: string
  findingsCount: number
}

const VALID_SEVERITIES: ReadonlySet<string> = new Set([
  "Critical",
  "High",
  "Medium",
  "Low",
  "Informational",
])

const VALID_CONFIDENCES: ReadonlySet<string> = new Set([
  "High",
  "Medium",
  "Low",
])

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

function processSlitherResult(
  parsed: Record<string, unknown>,
  store: FindingStore
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
  store: FindingStore
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

function processContractAnalyzerResult(
  parsed: Record<string, unknown>,
  state: AuditState
): void {
  // Handle direct ContractProfile format (actual tool output)
  if (typeof parsed.filePath === "string") {
    if (!state.contractsReviewed.includes(parsed.filePath)) {
      state.contractsReviewed.push(parsed.filePath)
    }
    return
  }

  // Handle wrapped { contractProfile: { filePath } } format
  const profile = toRecord(parsed.contractProfile)
  if (profile && typeof profile.filePath === "string") {
    if (!state.contractsReviewed.includes(profile.filePath)) {
      state.contractsReviewed.push(profile.filePath)
    }
  }
}

function processFuzzResult(
  parsed: Record<string, unknown>,
  state: AuditState
): void {
  const counterexamples = parsed.counterexamples
  if (!Array.isArray(counterexamples) || counterexamples.length === 0) return

  const totalRuns =
    typeof parsed.totalRuns === "number" ? parsed.totalRuns : 0

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

function processSoloditResult(
  parsed: Record<string, unknown>,
  state: AuditState
): void {
  const query = typeof parsed.query === "string" ? parsed.query : ""
  const results = Array.isArray(parsed.results) ? parsed.results : []
  const totalFound =
    typeof parsed.totalFound === "number" ? parsed.totalFound : results.length

  const topResults: SoloditResult["topResults"] = results
    .slice(0, 5)
    .map((raw) => {
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

/**
 * Records a tool execution in the audit state.
 *
 * Multiple entries per tool name are allowed — if the same tool runs multiple times
 * (e.g., argus_slither_analyze on different targets), each execution is recorded
 * with its own findingsCount.
 *
 * Timing limitation: startTime and endTime are both set to Date.now() because this
 * hook fires in the tool.execute.after phase, after execution has already completed.
 * We cannot capture the actual start time. This is a known limitation of the hook
 * architecture. For accurate timing, the hook would need to fire in tool.execute.before
 * and tool.execute.after phases separately.
 */
function recordToolExecution(
  state: AuditState,
  toolName: string,
  findingsCount: number
): void {
  const now = Date.now()
  state.toolsExecuted.push({
    tool: toolName,
    startTime: now,
    endTime: now,
    success: true,
    findingsCount,
  })
}

/**
 * Creates a tool tracking hook that intercepts argus_* tool results
 * and updates audit state with extracted findings.
 *
 * Non-argus tools are ignored. Malformed JSON results are silently skipped.
 * Findings are deduplicated via the FindingStore (by check+file+lines).
 */
export function createToolTrackingHook(
  getAuditState: () => AuditState | null,
  onStateChanged?: (metadata: ToolExecutionMetadata) => void
): (input: ToolHookInput) => Promise<void> {
  const storesByState = new WeakMap<AuditState, FindingStore>()

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

  return async (input: ToolHookInput): Promise<void> => {
    if (!input.tool.startsWith("argus_")) {
      return
    }

    const resolved = resolveStateAndStore()
    if (!resolved) return

    const { state: auditState, store } = resolved

    // Handle argus_skill_load first — it returns markdown, not JSON
    if (input.tool === "argus_skill_load") {
      // Extract skill name from markdown header: "## Argus Skill: {name} [Source: ...]"
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
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(input.result)
    } catch {
      return // non-JSON tool output — nothing to track
    }

    const record = toRecord(parsed)
    if (!record) return

    let findingsCount = 0

    switch (input.tool) {
      case "argus_slither_analyze":
        findingsCount = processSlitherResult(record, store)
        break
      case "argus_check_patterns":
        findingsCount = processPatternResult(record, store)
        break
      case "argus_analyze_contract":
        processContractAnalyzerResult(record, auditState)
        break
      case "argus_solodit_search":
        processSoloditResult(record, auditState)
        break
      case "argus_forge_test":
        break
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
            files: files.filter((f): f is Record<string, unknown> => !!f && typeof f === "object").map(f => ({
              path: typeof f.path === "string" ? f.path : "unknown",
              linesPct: typeof f.linesPct === "number" ? f.linesPct : 0,
              branchesPct: typeof f.branchesPct === "number" ? f.branchesPct : 0,
              functionsPct: typeof f.functionsPct === "number" ? f.functionsPct : 0,
            }))
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
            indicators: Array.isArray(record.indicators) ? record.indicators.filter((i): i is string => typeof i === "string") : [],
          })
        }
        break
      }
      case "argus_gas_analysis": {
        const hotspots = record.hotspots
        if (Array.isArray(hotspots)) {
          auditState.gasHotspots = hotspots.filter((h): h is Record<string, unknown> => !!h && typeof h === "object").map(h => ({
            contract: typeof h.contract === "string" ? h.contract : "unknown",
            function: typeof h.function === "string" ? h.function : "unknown",
            avgGas: typeof h.avgGas === "number" ? h.avgGas : 0,
          }))
        }
        break
      }
    }

    recordToolExecution(auditState, input.tool, findingsCount)
    onStateChanged?.({ tool: input.tool, findingsCount })
  }
}
