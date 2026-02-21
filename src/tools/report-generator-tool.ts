import path from "node:path"
import { type ToolContext, tool } from "@opencode-ai/plugin"
import { loadArgusConfig } from "../config/loader"
import type { ArgusConfig } from "../config/types"
import { createLogger } from "../shared/logger"
import { resolveProjectDir } from "../shared/project-utils"
import type { AuditState, Finding, FindingSeverity } from "../state/types"

type SeverityThreshold = "critical" | "high" | "medium" | "low" | "informational"

type ReportGeneratorArgs = {
  project_name: string
  scope: string[]
  include_executive_summary?: boolean
  severity_threshold?: SeverityThreshold
  audit_state: string
}

type FindingsCount = {
  critical: number
  high: number
  medium: number
  low: number
  informational: number
}

export type ReportGenerationResult = {
  report: string
  findingsCount: FindingsCount
  filename: string
  filePath?: string
}

export type ReportGenerationDependencies = {
  loadConfig?: (projectDir: string) => ArgusConfig
}

const SEVERITY_ORDER: FindingSeverity[] = ["Critical", "High", "Medium", "Low", "Informational"]

const SEVERITY_PREFIX: Record<FindingSeverity, string> = {
  Critical: "CRIT",
  High: "HIGH",
  Medium: "MED",
  Low: "LOW",
  Informational: "INFO",
}

const THRESHOLD_WEIGHT: Record<SeverityThreshold, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  informational: 1,
}

const FINDING_WEIGHT: Record<FindingSeverity, number> = {
  Critical: 5,
  High: 4,
  Medium: 3,
  Low: 2,
  Informational: 1,
}

function emptyCounts(): FindingsCount {
  return {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
  }
}

function emptyAuditState(findings: Finding[] = []): AuditState {
  return {
    sessionId: "",
    projectDir: "",
    contractsReviewed: [],
    findings,
    toolsExecuted: [],
    currentPhase: "complete",
    scope: [],
    startTime: 0,
  }
}

/**
 * Parse a location string like "File.sol:18-22" or "File.sol:18" into { file, lines }.
 * Returns undefined if the string doesn't match a recognized format.
 */
export function parseLocationString(
  location: string,
): { file: string; lines: [number, number] } | undefined {
  // "File.sol:18-22" or "File.sol:L18-L22"
  const rangeMatch = location.match(/^(.+?):L?(\d+)\s*-\s*L?(\d+)$/)
  if (rangeMatch) {
    const file = rangeMatch.at(1)
    const start = rangeMatch.at(2)
    const end = rangeMatch.at(3)
    if (file && start && end) {
      return { file, lines: [Number(start), Number(end)] }
    }
  }
  // "File.sol:18"
  const singleMatch = location.match(/^(.+?):L?(\d+)$/)
  if (singleMatch) {
    const file = singleMatch.at(1)
    const lineNum = singleMatch.at(2)
    if (file && lineNum) {
      const n = Number(lineNum)
      return { file, lines: [n, n] }
    }
  }
  return undefined
}

/**
 * Normalize a raw finding object from agent output into the canonical field format.
 * Handles common aliases:
 *   - title/name → check
 *   - location (string) → file + lines
 *   - case-insensitive severity → capitalized
 */
export function normalizeRawFinding(raw: Record<string, unknown>): Record<string, unknown> {
  const result = { ...raw }

  // check: accept title, name as aliases
  if (typeof result.check !== "string" || (result.check as string).length === 0) {
    const alias = result.title ?? result.name
    if (typeof alias === "string" && alias.length > 0) {
      result.check = alias
    }
  }

  // file + lines: accept location string as alias
  if (typeof result.file !== "string" && typeof result.location === "string") {
    const parsed = parseLocationString(result.location as string)
    if (parsed) {
      result.file = parsed.file
      if (!Array.isArray(result.lines) || (result.lines as unknown[]).length !== 2) {
        result.lines = parsed.lines
      }
    }
  }

  // lines: accept [start] as [start, start], accept line_start/line_end
  if (!Array.isArray(result.lines) || (result.lines as unknown[]).length !== 2) {
    if (Array.isArray(result.lines) && (result.lines as unknown[]).length === 1) {
      const n = Number((result.lines as unknown[])[0])
      if (!Number.isNaN(n)) {
        result.lines = [n, n]
      }
    } else if (typeof result.line_start === "number" && typeof result.line_end === "number") {
      result.lines = [result.line_start, result.line_end]
    } else if (typeof result.line === "number") {
      result.lines = [result.line, result.line]
    }
  }

  // severity: case-insensitive normalization
  if (typeof result.severity === "string") {
    const lower = (result.severity as string).toLowerCase()
    const SEVERITY_MAP: Record<string, string> = {
      critical: "Critical",
      high: "High",
      medium: "Medium",
      low: "Low",
      informational: "Informational",
      info: "Informational",
    }
    const mapped = SEVERITY_MAP[lower]
    if (mapped) {
      result.severity = mapped
    }
  }

  // confidence: case-insensitive normalization
  if (typeof result.confidence === "string") {
    const lower = (result.confidence as string).toLowerCase()
    const CONFIDENCE_MAP: Record<string, string> = {
      high: "High",
      medium: "Medium",
      low: "Low",
    }
    const mapped = CONFIDENCE_MAP[lower]
    if (mapped) {
      result.confidence = mapped
    }
  }

  // description: fall back to check if missing
  if (typeof result.description !== "string" && typeof result.check === "string") {
    result.description = result.check
  }

  return result
}

function hasMinimumFindingFields(
  f: unknown,
): f is { check: string; file: string; lines: [number, number] } {
  if (typeof f !== "object" || f === null) return false
  const obj = f as Record<string, unknown>
  return (
    typeof obj.check === "string" &&
    obj.check.length > 0 &&
    typeof obj.file === "string" &&
    Array.isArray(obj.lines) &&
    obj.lines.length === 2
  )
}

const VALID_SEVERITIES: ReadonlySet<string> = new Set([
  "Critical",
  "High",
  "Medium",
  "Low",
  "Informational",
])
const VALID_SOURCES: ReadonlySet<string> = new Set([
  "slither",
  "manual",
  "pattern",
  "scvd",
  "solodit",
  "fuzz",
])

function normalizeFinding(f: Record<string, unknown>): Finding {
  const severity =
    typeof f.severity === "string" && VALID_SEVERITIES.has(f.severity)
      ? (f.severity as Finding["severity"])
      : "Informational"
  const confidence =
    typeof f.confidence === "string" && ["High", "Medium", "Low"].includes(f.confidence)
      ? (f.confidence as Finding["confidence"])
      : "Low"
  const source =
    typeof f.source === "string" && VALID_SOURCES.has(f.source)
      ? (f.source as Finding["source"])
      : "manual"
  const description = typeof f.description === "string" ? f.description : (f.check as string)
  const id = typeof f.id === "string" ? f.id : `${f.check}:${f.file}:${(f.lines as number[])[0]}`
  return {
    id,
    check: f.check as string,
    severity,
    confidence,
    description,
    file: f.file as string,
    lines: f.lines as [number, number],
    source,
    remediation: typeof f.remediation === "string" ? f.remediation : undefined,
    exploitReference: typeof f.exploitReference === "string" ? f.exploitReference : undefined,
  }
}

export function parseAuditState(auditState: string): AuditState {
  let parsed: unknown
  try {
    parsed = JSON.parse(auditState)
  } catch {
    throw new Error(
      "audit_state is not valid JSON — expected an AuditState object or Finding[] array",
    )
  }

  const logger = createLogger()

  if (Array.isArray(parsed)) {
    const rawItems = parsed as unknown[]
    const normalized = rawItems
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => normalizeRawFinding(item))
    const validFindings = normalized
      .filter(hasMinimumFindingFields)
      .map((f) => normalizeFinding(f as Record<string, unknown>))
    const dropped = rawItems.length - validFindings.length
    if (dropped > 0) {
      logger.warn(
        `parseAuditState: ${dropped}/${rawItems.length} findings dropped (missing required fields after normalization)`,
      )
    }
    return emptyAuditState(validFindings)
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as AuditState).findings)
  ) {
    const state = parsed as AuditState
    const rawFindings = state.findings as unknown[]
    const normalized = rawFindings
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => normalizeRawFinding(item))
    const validFindings = normalized
      .filter(hasMinimumFindingFields)
      .map((f) => normalizeFinding(f as Record<string, unknown>))
    const dropped = rawFindings.length - validFindings.length
    if (dropped > 0) {
      logger.warn(
        `parseAuditState: ${dropped}/${rawFindings.length} findings dropped (missing required fields after normalization)`,
      )
    }
    return {
      ...emptyAuditState(),
      ...state,
      findings: validFindings,
    }
  }

  return emptyAuditState()
}

function normalizeTitle(check: string): string {
  if (!check || typeof check !== "string") return "Unknown Check"
  return check
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ")
}

function formatLocation(finding: Finding): string {
  if (!finding.file || !Array.isArray(finding.lines) || finding.lines.length < 2)
    return "unknown location"
  return `${finding.file}:${finding.lines[0]}-${finding.lines[1]}`
}

function shouldIncludeFinding(finding: Finding, threshold: SeverityThreshold): boolean {
  return FINDING_WEIGHT[finding.severity] >= THRESHOLD_WEIGHT[threshold]
}

function calculateCounts(findings: Finding[]): FindingsCount {
  const counts = emptyCounts()

  for (const finding of findings) {
    if (finding.severity === "Critical") counts.critical += 1
    if (finding.severity === "High") counts.high += 1
    if (finding.severity === "Medium") counts.medium += 1
    if (finding.severity === "Low") counts.low += 1
    if (finding.severity === "Informational") counts.informational += 1
  }

  return counts
}

function overallRiskAssessment(counts: FindingsCount): string {
  if (counts.critical > 0) return "Critical risk"
  if (counts.high > 0) return "High risk"
  if (counts.medium > 0) return "Medium risk"
  if (counts.low > 0) return "Low risk"
  if (counts.informational > 0) return "Informational only"
  return "No significant risk identified"
}

function genericImpact(severity: FindingSeverity): string {
  if (severity === "Critical") {
    return "Could lead to immediate and severe compromise of funds or protocol control."
  }
  if (severity === "High") {
    return "Could materially impact protocol security, user funds, or system integrity."
  }
  if (severity === "Medium") {
    return "Could cause operational issues or increase exploitability under specific conditions."
  }
  if (severity === "Low") {
    return "Limited direct impact but should be addressed to improve security posture."
  }
  return "No immediate exploit impact, but useful for hardening and maintainability."
}

function genericRecommendation(severity: FindingSeverity): string {
  if (severity === "Critical" || severity === "High") {
    return "Prioritize remediation before production deployment and validate with focused regression tests."
  }
  if (severity === "Medium") {
    return "Address in the near term and include unit/integration tests to prevent regressions."
  }
  if (severity === "Low") {
    return "Schedule remediation in regular hardening cycles."
  }
  return "Track and resolve during routine code quality and documentation improvements."
}

function buildRecommendations(counts: FindingsCount): string[] {
  const items: string[] = []

  if (counts.critical > 0) {
    items.push(
      "1. Immediately remediate all Critical findings and block release until fixes are verified.",
    )
  }
  if (counts.high > 0) {
    items.push(
      "2. Prioritize High findings in the next patch cycle with dedicated security test coverage.",
    )
  }
  if (counts.medium > 0) {
    items.push("3. Resolve Medium findings to reduce attack surface and improve resilience.")
  }
  if (counts.low > 0 || counts.informational > 0) {
    items.push(
      "4. Address Low/Informational findings as part of ongoing hardening and code quality efforts.",
    )
  }

  if (items.length === 0) {
    items.push(
      "1. Maintain current controls, monitor code changes, and re-audit before major upgrades.",
    )
  }

  return items
}

function buildFindingsSection(findings: Finding[]): string {
  if (findings.length === 0) {
    return "## Findings\nNo findings meet the configured severity threshold."
  }

  const lines: string[] = ["## Findings"]

  for (const severity of SEVERITY_ORDER) {
    const severityFindings = findings.filter((finding) => finding.severity === severity)
    if (severityFindings.length === 0) {
      continue
    }

    lines.push(`### ${severity}`)

    severityFindings.forEach((finding, index) => {
      const prefix = SEVERITY_PREFIX[severity]
      const findingId = `[${prefix}-${index + 1}]`
      const title = normalizeTitle(finding.check)
      const recommendation = finding.remediation ?? genericRecommendation(severity)

      lines.push(`### ${findingId} ${title}`)
      lines.push(`**Severity**: ${finding.severity}`)
      lines.push(`**Confidence**: ${finding.confidence}`)
      lines.push(`**Location**: ${formatLocation(finding)}`)
      lines.push("")
      lines.push(`**Description**: ${finding.description}`)
      lines.push("")
      lines.push(`**Impact**: ${genericImpact(finding.severity)}`)
      lines.push("")
      lines.push(`**Recommendation**: ${recommendation}`)
      lines.push("")
    })
  }

  return lines.join("\n")
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function buildProvenanceAppendix(
  state: AuditState,
  threshold: SeverityThreshold,
  includedCount: number,
): string {
  const lines: string[] = ["## Appendix: Data Provenance"]

  lines.push("- Data source: `audit_state` payload")
  lines.push(`- Severity threshold applied: ${threshold}`)
  lines.push(`- Findings included in report: ${includedCount}`)

  if (state.findings.length > 0) {
    const sourceCounts: Record<string, number> = {}
    for (const f of state.findings) {
      sourceCounts[f.source] = (sourceCounts[f.source] ?? 0) + 1
    }
    lines.push("")
    lines.push("### Source Breakdown")
    lines.push("")
    lines.push("| Source | Count |")
    lines.push("| --- | ---: |")
    for (const [source, count] of Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${source} | ${count} |`)
    }
  }

  if (state.toolsExecuted.length > 0) {
    lines.push("")
    lines.push("### Tool Execution Summary")
    lines.push("")
    lines.push("| Tool | Duration | Status | Findings |")
    lines.push("| --- | --- | --- | ---: |")
    for (const exec of state.toolsExecuted) {
      const duration = exec.endTime != null ? formatDuration(exec.endTime - exec.startTime) : "—"
      const status = exec.success ? "✅ success" : "❌ failure"
      lines.push(`| ${exec.tool} | ${duration} | ${status} | ${exec.findingsCount} |`)
    }
  }

  const syncExec = state.toolsExecuted.find((t) => t.tool === "argus_sync_knowledge")
  if (state.patternVersion || syncExec) {
    lines.push("")
    lines.push("### Data Freshness")
    lines.push("")
    if (state.patternVersion) {
      lines.push(`- Pattern pack version: \`${state.patternVersion}\``)
    }
    if (syncExec) {
      lines.push(`- SCVD last synced: ${new Date(syncExec.startTime).toISOString()}`)
    }
  }

  if (state.soloditResults && state.soloditResults.length > 0) {
    lines.push("")
    lines.push("### Solodit Cross-References")
    lines.push("")
    for (const result of state.soloditResults) {
      lines.push(`**Query**: "${result.query}" — ${result.resultCount} results`)
      if (result.topResults.length > 0) {
        lines.push("")
        lines.push("| Title | Severity | Protocol |")
        lines.push("| --- | --- | --- |")
        for (const top of result.topResults) {
          lines.push(`| ${top.title} | ${top.severity} | ${top.protocol} |`)
        }
      }
      lines.push("")
    }
  }

  if (state.fuzzCounterexamples && state.fuzzCounterexamples.length > 0) {
    lines.push("")
    lines.push("### Fuzz Evidence")
    lines.push("")
    lines.push("| Test | Inputs | Runs | Revert Reason |")
    lines.push("| --- | --- | ---: | --- |")
    for (const cx of state.fuzzCounterexamples) {
      const inputs = cx.inputs.join(", ")
      const reason = cx.revertReason ?? "—"
      lines.push(`| ${cx.testName} | ${inputs} | ${cx.runs} | ${reason} |`)
    }
  }

  if (state.skillsLoaded && state.skillsLoaded.length > 0) {
    lines.push("")
    lines.push("### Knowledge Sources")
    lines.push("")
    lines.push("Skills loaded during this audit:")
    lines.push("")
    for (const skill of state.skillsLoaded) {
      lines.push(`- ${skill}`)
    }
  }

  return lines.join("\n")
}

export async function executeReportGeneration(
  args: ReportGeneratorArgs,
  context: ToolContext,
  deps: ReportGenerationDependencies = {},
): Promise<ReportGenerationResult> {
  const includeExecutiveSummary = args.include_executive_summary ?? true
  const threshold = args.severity_threshold ?? "low"
  const state = parseAuditState(args.audit_state)
  const findings = state.findings.filter((finding) => shouldIncludeFinding(finding, threshold))
  const counts = calculateCounts(findings)
  const auditDate = new Date().toISOString().slice(0, 10)

  context.metadata({ title: `Generate audit report: ${args.project_name}` })

  const sections: string[] = [`# Security Audit Report — ${args.project_name}`]

  if (includeExecutiveSummary) {
    sections.push("## Executive Summary")
    sections.push(
      `This report summarizes security findings identified for ${args.project_name} based on static analysis, testing, and pattern-based review.`,
    )
    sections.push("")
    sections.push("| Severity | Count |")
    sections.push("| --- | ---: |")
    sections.push(`| Critical | ${counts.critical} |`)
    sections.push(`| High | ${counts.high} |`)
    sections.push(`| Medium | ${counts.medium} |`)
    sections.push(`| Low | ${counts.low} |`)
    sections.push(`| Informational | ${counts.informational} |`)
    sections.push("")
    sections.push(`Overall risk assessment: ${overallRiskAssessment(counts)}.`)
  }

  sections.push("## Scope")
  sections.push("Contracts in scope:")
  if (args.scope.length === 0) {
    sections.push("- None provided")
  } else {
    for (const contract of args.scope) {
      sections.push(`- ${contract}`)
    }
  }
  sections.push(`Audit date: ${auditDate}`)

  sections.push("## Methodology")
  sections.push("Tools and techniques used:")
  sections.push("- Slither static analysis")
  sections.push("- Foundry tests and fuzzing")
  sections.push("- Pattern Analysis")
  sections.push("- Solodit research cross-referencing")
  sections.push(
    "Approach: Findings were normalized, deduplicated by detector signature and location, then prioritized by severity and confidence.",
  )

  sections.push(buildFindingsSection(findings))

  sections.push("## Recommendations")
  for (const item of buildRecommendations(counts)) {
    sections.push(`- ${item}`)
  }

  sections.push(buildProvenanceAppendix(state, threshold, findings.length))

  const reportMarkdown = sections.join("\n\n")
  const safeName = args.project_name.replace(/[^a-zA-Z0-9-_]/g, "-")
  const diskFilename = `${safeName}-${Date.now()}.md`

  const result: ReportGenerationResult = {
    report: reportMarkdown,
    findingsCount: counts,
    filename: `${args.project_name}-audit-report-${auditDate}.md`,
  }

  try {
    const loadConfig = deps.loadConfig ?? loadArgusConfig
    const projectDir = resolveProjectDir(context)
    const config = loadConfig(projectDir)
    const outputDir = config.reporting?.output_dir ?? ".opencode/reports/"
    const fullPath = path.join(projectDir, outputDir, diskFilename)
    await Bun.write(fullPath, reportMarkdown)
    result.filePath = fullPath
  } catch (err: unknown) {
    const logger = createLogger()
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(`Failed to write report to disk: ${message}`)
  }

  return result
}

export const reportGeneratorTool = tool({
  description:
    "Generate a professional markdown security audit report from serialized findings and audit context.",
  args: {
    project_name: tool.schema.string(),
    scope: tool.schema.array(tool.schema.string()),
    include_executive_summary: tool.schema.boolean().default(true),
    severity_threshold: tool.schema
      .enum(["critical", "high", "medium", "low", "informational"])
      .default("low"),
    audit_state: tool.schema.string(),
  },
  async execute(args, context) {
    const result = await executeReportGeneration(args, context)
    return JSON.stringify(result)
  },
})
