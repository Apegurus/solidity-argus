import type { AuditState, FindingSeverity } from "../state/types"
import type { FindingStore } from "../state/finding-store"

type ToolHookInput = {
  tool: string
  args: unknown
  result: string
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

function recordToolExecution(
  state: AuditState,
  toolName: string,
  findingsCount: number
): void {
  const alreadyRecorded = state.toolsExecuted.some(
    (execution) => execution.tool === toolName
  )
  if (alreadyRecorded) return

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
  auditState: AuditState,
  store: FindingStore
): (input: ToolHookInput) => Promise<void> {
  return async (input: ToolHookInput): Promise<void> => {
    if (!input.tool.startsWith("argus_")) {
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(input.result)
    } catch {
      return
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
      case "argus_forge_test":
      case "argus_forge_fuzz":
        // No findings to extract — counterexamples are informational
        break
    }

    recordToolExecution(auditState, input.tool, findingsCount)
  }
}
