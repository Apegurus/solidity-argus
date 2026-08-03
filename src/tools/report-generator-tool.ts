import { existsSync, statSync } from "node:fs"
import path from "node:path"
import { type ToolContext, tool } from "@opencode-ai/plugin"
import { loadArgusConfig } from "../config/loader"
import { DEFAULT_CONFIDENCE_THRESHOLD } from "../config/schema"
import type { ArgusConfig } from "../config/types"
import { readEvents } from "../features/persistent-state/event-sink"
import { createAuditArtifactResolver } from "../shared/audit-artifact-resolver"
import type { DropDiagnostic } from "../shared/drop-diagnostics"
import { readTextCapped } from "../shared/file-utils"
import {
  computeFailedKeyTools,
  computeMissingKeyTools,
  KEY_TOOLS,
  TOOL_SHORT_NAMES,
  UNAVAILABLE_TO_KEY_TOOL,
} from "../shared/key-tools"
import { validateFindingLineage } from "../shared/lineage-validator"
import { createLogger } from "../shared/logger"
import { isContained } from "../shared/path-safety"
import { resolveProjectDir } from "../shared/project-utils"
import { resolveReportPath } from "../shared/report-path-resolver"
import { isNonEmptyString } from "../shared/type-guards"
import { reconcileRubricVerdict, SEVERITY_RANK } from "../shared/validation-constants"
import {
  compareIssueFingerprintSets,
  finalizeProjectedFindings,
} from "../state/finding-aggregation"
import { projectFindings, stableHash } from "../state/projectors"
import type { ReportInput } from "../state/schemas"
import type { AuditState, Finding, FindingSeverity } from "../state/types"
import {
  assignStableFindingIds,
  loadFindingIdRegistry,
  persistFindingIdRegistry,
  SEVERITY_ID_PREFIX,
} from "./finding-id-registry"
import {
  buildReportMetadataComment,
  checkDuplicateWrite,
  checkSafeForceOverwrite,
  dedupedContentHash,
  mergeReportEntries,
  readReportManifest,
  scanRunReports,
  upsertReportEntry,
  writeReportManifest,
} from "./report-manifest"
import { checkReportPreflight } from "./report-preflight"

export { extractReportRunId, SINGLE_WRITER_POLICY_VERSION } from "./report-manifest"

import {
  parseReportInputPayload,
  reportInputToAuditState,
  resolveExpectedRunId,
  UNKNOWN_TIMESTAMP_SENTINEL,
} from "./report-input"

export { normalizeRawFinding, parseLocationString } from "./report-input"

type SeverityThreshold = "critical" | "high" | "medium" | "low" | "informational"

type ToolCoveragePolicy = "enforce" | "warn" | "skip"

export type ReportGeneratorArgs = {
  project_name: string
  scope: string[]
  include_executive_summary?: boolean
  severity_threshold?: SeverityThreshold
  quality_gate_policy?: QualityGatePolicy
  report_input?: string
  preflight_policy?: PreflightPolicy
  tool_coverage_policy?: ToolCoveragePolicy
  run_id?: string
  revision?: number
  force?: boolean
}

type FindingsCount = {
  critical: number
  high: number
  medium: number
  low: number
  informational: number
}

export type ReportGenerationResult = {
  success: boolean
  report: string
  /** Findings-tier counts only (confirmed/above-threshold); matches `qualityGates` scope. */
  findingsCount: FindingsCount
  /** Leads-tier counts (demoted/below-threshold). */
  leadsTierCount: FindingsCount
  /** Combined Findings + Leads counts (the executive-summary Total column). */
  totalCount: FindingsCount
  filename: string
  run_id: string
  contentHash: string
  qualityGates: ReportQualityValidation
  contractDiagnostics: DropDiagnostic[]
  filePath?: string
  idempotent?: boolean
  reportStatus?: "written" | "reused"
  reportsManifestFile?: string
  error?: { code: string; message: string }
}

type QualityGatePolicy = "warn" | "strict-fail"

type PreflightPolicy = "warn" | "strict-fail"

type ReportQualityViolation = {
  findingId: string
  code: string
  message: string
}

type ReportQualityValidation = {
  passed: boolean
  violations: ReportQualityViolation[]
}

export type ReportGenerationDependencies = {
  loadConfig?: (projectDir: string) => ArgusConfig
  readEvents?: (
    runId: string,
    projectDir: string,
  ) => Promise<import("../state/schemas").AuditEvent[]>
  resolveCanonicalRunId?: (sessionId: string, projectDir: string) => string | null | undefined
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

const MISSING_IMPACT_TEXT = "Impact details were not provided in the finding payload."
const MISSING_RECOMMENDATION_TEXT =
  "Recommendation details were not provided in the finding payload."

type ReportFindingFields = {
  impact?: string
  recommendation?: string
  proofOfConcept?: string
}

function isForgeAvailable(unavailableTools?: string[]): boolean {
  return !(unavailableTools ?? []).includes("forge")
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

/**
 * Parse a location string like "File.sol:18-22" or "File.sol:18" into { file, lines }.
 * Returns undefined if the string doesn't match a recognized format.
 */
// Strips Markdown/HTML-sensitive chars so LLM-controlled `check` values cannot
// forge sections, links, code spans, or inline HTML in the rendered H3 heading.
const HEADING_DANGEROUS_CHARS = /[\r\n\t`*<>[\]()#\\|]+/g

function normalizeTitle(check: string): string {
  if (!check || typeof check !== "string") return "Unknown Check"
  const sanitized = check.replace(HEADING_DANGEROUS_CHARS, " ")
  return sanitized
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ")
}

// Security: strips CR/LF and Markdown-structural characters from inline values
// (e.g. finding.file) so a tool/LLM-controlled path cannot break out of its line or
// forge report structure when interpolated into Markdown. Legitimate file paths
// never contain these characters.
const INLINE_DANGEROUS_CHARS = /[\r\n\t`*<>[\]#|\\]+/g

function sanitizeInlineField(value: string): string {
  return value.replace(INLINE_DANGEROUS_CHARS, " ").trim()
}

function formatLocation(finding: Finding): string {
  if (!finding.file || !Array.isArray(finding.lines) || finding.lines.length < 2)
    return "unknown location"
  return `${sanitizeInlineField(finding.file)}:${finding.lines[0]}-${finding.lines[1]}`
}

// Security: neutralizes Markdown-structure injection from LLM/tool-controlled body
// text. Normalizes CR/LF, strips leading ATX heading markers ("## Findings"),
// neutralizes Setext heading underlines (a line of only "=" or "-" directly beneath
// a non-blank text line, which promotes it to H1/H2), and appends a closing fence
// for any unbalanced code fence so a body cannot swallow downstream report sections.
// A "---" preceded by a blank line is a thematic break (the rubric-trace separator)
// and is preserved.
function sanitizeBodyMarkdown(text: string): string {
  if (!text) return text
  const out: string[] = []
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.replace(/^(\s*)#{1,6}[ \t]+/, "$1")
    if (/^[ \t]*(=+|-+)[ \t]*$/.test(line)) {
      const prev = out[out.length - 1]
      if (prev !== undefined && prev.trim().length > 0) {
        out.push("")
        continue
      }
    }
    out.push(line)
  }
  if (out.filter((line) => /^ {0,3}`{3,}/.test(line)).length % 2 === 1) out.push("```")
  if (out.filter((line) => /^ {0,3}~{3,}/.test(line)).length % 2 === 1) out.push("~~~")
  return out.join("\n")
}

const MAX_SOURCE_EXCERPT_BYTES = 2 * 1024 * 1024

export function sourceExcerpt(projectDir: string, finding: Finding): string | null {
  if (!finding.file || !Array.isArray(finding.lines) || finding.lines.length < 2) return null
  const start = finding.lines[0]
  const end = finding.lines[1]
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
    return null
  }
  // Security: finding.file is tool/LLM-controlled — only read a file proven to resolve
  // inside projectDir; refuse absolute paths and traversal escapes before any read.
  if (path.isAbsolute(finding.file) || !isContained(finding.file, projectDir)) return null
  const absolutePath = path.join(projectDir, finding.file)
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) return null
  const contents = readTextCapped(absolutePath, MAX_SOURCE_EXCERPT_BYTES).text.split(/\r?\n/)
  const excerpt = contents.slice(start - 1, end).join("\n")
  return excerpt.trim().length > 0 ? excerpt : null
}

function shouldIncludeFinding(finding: Finding, threshold: SeverityThreshold): boolean {
  return FINDING_WEIGHT[finding.severity] >= THRESHOLD_WEIGHT[threshold]
}

type NormalizedPath = {
  value: string
  base: string
  isBare: boolean
  hadTrailingSlash: boolean
}

function normalizePathish(raw: string | undefined): NormalizedPath {
  const original = (raw ?? "").trim()
  const hadTrailingSlash = /[\\/]$/.test(original)
  const value = original
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "")
  const base = value.split("/").pop() ?? ""
  return { value, base, isBare: value !== "" && !value.includes("/"), hadTrailingSlash }
}

function looksLikeDirectoryScope(scoped: NormalizedPath): boolean {
  if (scoped.value === "" || scoped.value === ".") return true
  if (scoped.hadTrailingSlash) return true
  return !scoped.base.includes(".")
}

function sameFilePath(a: string, b: string): boolean {
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`)
}

function isUnderDirectory(file: string, dir: string): boolean {
  return file.startsWith(`${dir}/`) || file.includes(`/${dir}/`)
}

// Conservative scope predicate: a finding is out-of-scope ONLY when its file is
// concrete (not empty/"unknown") and no scope entry can place it in scope under any
// path interpretation — exact/suffix-equivalent file, directory containment, or
// bare-vs-pathed basename ambiguity. Ambiguous cases stay in-scope so a security
// finding is never silently moved out of the actionable tiers (over-inclusion is the
// safe failure mode). Do NOT tighten to strict prefix matching.
export function isFindingInScope(finding: Finding, scope: string[]): boolean {
  if (scope.length === 0) return true
  const file = normalizePathish(finding.file)
  if (file.value === "" || file.value.toLowerCase() === "unknown") return true
  return scope.some((entry) => {
    const scoped = normalizePathish(entry)
    if (scoped.value === "" || scoped.value === ".") return true
    const scopeIsDir = looksLikeDirectoryScope(scoped)
    if (!scopeIsDir && sameFilePath(file.value, scoped.value)) return true
    if (scopeIsDir && isUnderDirectory(file.value, scoped.value)) return true
    if (scopeIsDir && file.isBare && file.base.includes(".")) return true
    if ((file.isBare || scoped.isBare) && file.base === scoped.base) return true
    return false
  })
}

function collectOutOfScopeFindings(findings: Finding[], scope: string[]): Finding[] {
  return findings.filter((finding) => !isFindingInScope(finding, scope))
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

function getExtendedFinding(finding: Finding): Finding & ReportFindingFields {
  return finding as Finding & ReportFindingFields
}

function getFindingImpact(finding: Finding): string {
  const extended = getExtendedFinding(finding)
  if (isNonEmptyString(extended.impact)) {
    return extended.impact.trim()
  }
  return MISSING_IMPACT_TEXT
}

function getFindingRecommendation(finding: Finding): string {
  const extended = getExtendedFinding(finding)
  if (isNonEmptyString(extended.recommendation)) {
    return extended.recommendation.trim()
  }
  if (isNonEmptyString(finding.remediation)) {
    return finding.remediation.trim()
  }
  return MISSING_RECOMMENDATION_TEXT
}

function getPocEvidence(
  finding: Finding,
  options: { allowExploitReference?: boolean } = {},
): string | undefined {
  const extended = getExtendedFinding(finding)
  if (isNonEmptyString(extended.proofOfConcept)) {
    return extended.proofOfConcept.trim()
  }
  if (options.allowExploitReference !== false && isNonEmptyString(finding.exploitReference)) {
    return finding.exploitReference.trim()
  }
  return undefined
}

function hasUnprovenForgeUnavailableNote(finding: Finding): boolean {
  return finding.unproven_forge_unavailable === true
}

function compareFindingsDeterministically(a: Finding, b: Finding): number {
  const severityDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  if (severityDelta !== 0) return severityDelta

  const fileDelta = a.file.localeCompare(b.file)
  if (fileDelta !== 0) return fileDelta

  const lineDelta = (a.lines[0] ?? 0) - (b.lines[0] ?? 0)
  if (lineDelta !== 0) return lineDelta

  return a.id.localeCompare(b.id)
}

function sortFindingsDeterministically(findings: Finding[]): Finding[] {
  return [...findings].sort(compareFindingsDeterministically)
}

function sortFindingsByConfidence(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const aHas = typeof a.confidence_score === "number"
    const bHas = typeof b.confidence_score === "number"
    if (aHas && !bHas) return -1
    if (!aHas && bHas) return 1
    if (aHas && bHas && a.confidence_score !== b.confidence_score) {
      const aScore = a.confidence_score as number
      const bScore = b.confidence_score as number
      return bScore - aScore
    }

    const severityDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (severityDelta !== 0) return severityDelta

    const fileDelta = a.file.localeCompare(b.file)
    if (fileDelta !== 0) return fileDelta

    const lineDelta = (a.lines[0] ?? 0) - (b.lines[0] ?? 0)
    if (lineDelta !== 0) return lineDelta

    return a.id.localeCompare(b.id)
  })
}

// Severity-first (confidence breaks ties) so the report leads with Criticals.
// The Leads tier deliberately uses confidence-first order — do not unify them.
function sortFindingsBySeverityThenConfidence(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const severityDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (severityDelta !== 0) return severityDelta

    const aHas = typeof a.confidence_score === "number"
    const bHas = typeof b.confidence_score === "number"
    if (aHas && !bHas) return -1
    if (!aHas && bHas) return 1
    if (aHas && bHas && a.confidence_score !== b.confidence_score) {
      const aScore = a.confidence_score as number
      const bScore = b.confidence_score as number
      return bScore - aScore
    }

    const fileDelta = a.file.localeCompare(b.file)
    if (fileDelta !== 0) return fileDelta

    const lineDelta = (a.lines[0] ?? 0) - (b.lines[0] ?? 0)
    if (lineDelta !== 0) return lineDelta

    return a.id.localeCompare(b.id)
  })
}

// Tier routing is verdict-first: the rubric's structured `rubric_verdict` is the
// authoritative Findings/Leads signal; `confidence_score` is only a fallback for
// legacy/unscored findings predating the rubric. This stops a malformed or
// partially-normalized DEMOTED/REJECTED_DEMOTED record (missing/invalid score) from
// being promoted into the main Findings section. A CONFIRMED verdict carrying an
// explicit sub-80 score is reconciled to DEMOTED first (CONFIRMED requires >= 80).
function splitFindingsByTier(
  findings: Finding[],
  threshold: number,
): { findings: Finding[]; leads: Finding[] } {
  const findingsTier: Finding[] = []
  const leadsTier: Finding[] = []
  for (const finding of findings) {
    const verdict = reconcileRubricVerdict(finding.rubric_verdict, finding.confidence_score)
    if (verdict === "CONFIRMED") {
      findingsTier.push(finding)
    } else if (verdict === "DEMOTED" || verdict === "REJECTED_DEMOTED") {
      leadsTier.push(finding)
    } else if (
      typeof finding.confidence_score === "number" &&
      finding.confidence_score < threshold
    ) {
      leadsTier.push(finding)
    } else {
      findingsTier.push(finding)
    }
  }
  return { findings: findingsTier, leads: leadsTier }
}

function hasObservationIds(finding: Finding): boolean {
  const observationIds = (finding as { observation_ids?: unknown }).observation_ids
  return Array.isArray(observationIds) && observationIds.length > 0
}

function hasCompleteDedupLineage(
  findings: Finding[],
  droppedObservations?: ReportInput["dropped_observations"],
): boolean {
  if (findings.length > 0) return findings.every(hasObservationIds)
  return Array.isArray(droppedObservations) && droppedObservations.length > 0
}

function hasPartialDedupLineage(findings: Finding[]): boolean {
  const withLineage = findings.some(hasObservationIds)
  const withoutLineage = findings.some((finding) => {
    const observationIds = (finding as { observation_ids?: unknown }).observation_ids
    return !Array.isArray(observationIds) || observationIds.length === 0
  })
  return withLineage && withoutLineage
}

export function validateReportQuality(
  findings: Finding[],
  policy: QualityGatePolicy,
): ReportQualityValidation {
  const violations: ReportQualityViolation[] = []

  for (const finding of findings) {
    const findingId = finding.id
    const impact = getFindingImpact(finding)
    const recommendation = getFindingRecommendation(finding)
    const severity = finding.severity

    if (!finding.id || !finding.check || !finding.file || !Array.isArray(finding.lines)) {
      violations.push({
        findingId,
        code: "schema.missing-required",
        message: "Finding is missing required fields for deterministic report rendering.",
      })
    }

    if (!finding.description || finding.description.trim().length === 0) {
      violations.push({
        findingId,
        code: "completeness.missing-description",
        message: "Finding description must be non-empty.",
      })
    }

    if (!finding.source || finding.source.trim().length === 0) {
      violations.push({
        findingId,
        code: "provenance.missing-source",
        message: "Finding source is required for provenance traceability.",
      })
    }

    if (severity !== "Critical" && severity !== "High") {
      continue
    }

    if (
      impact.length === 0 ||
      impact === MISSING_IMPACT_TEXT ||
      impact === genericImpact(severity)
    ) {
      violations.push({
        findingId,
        code: "severity-justification.missing-impact",
        message: `${severity} findings must include specific non-generic impact details.`,
      })
    }

    if (
      recommendation.length === 0 ||
      recommendation === MISSING_RECOMMENDATION_TEXT ||
      recommendation === genericRecommendation(severity)
    ) {
      violations.push({
        findingId,
        code: "severity-justification.missing-recommendation",
        message: `${severity} findings must include specific non-generic recommendations.`,
      })
    }

    if (hasUnprovenForgeUnavailableNote(finding)) {
      continue
    }

    if (getPocEvidence(finding, { allowExploitReference: false }) == null) {
      violations.push({
        findingId,
        code: "severity-justification.missing-poc",
        message: `${severity} findings must satisfy PoC policy with proofOfConcept evidence.`,
      })
    }
  }

  if (policy === "warn" && violations.length > 0) {
    const logger = createLogger()
    logger.warn(`[report-generator] quality gates failed with ${violations.length} violation(s)`)
    for (const violation of violations) {
      logger.warn(
        `[report-generator] [${violation.code}] finding=${violation.findingId}: ${violation.message}`,
      )
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  }
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

function buildFindingsSection(
  findings: Finding[],
  projectDir: string,
  idAssignments?: ReadonlyMap<string, string>,
): string {
  if (findings.length === 0) {
    return ""
  }

  const lines: string[] = ["## Findings"]
  const severityCounters: Partial<Record<FindingSeverity, number>> = {}

  for (const finding of findings) {
    const recommendation = getFindingRecommendation(finding)
    const impact = getFindingImpact(finding)
    const seq = (severityCounters[finding.severity] ?? 0) + 1
    severityCounters[finding.severity] = seq
    const assigned = idAssignments?.get(finding.id)
    const displayId = assigned
      ? `[${assigned}]`
      : `[${SEVERITY_ID_PREFIX[finding.severity]}-${seq}]`

    lines.push(renderFindingHeader(finding, displayId))
    lines.push(`**Severity**: ${finding.severity}`)
    lines.push(`**Confidence**: ${finding.confidence}`)
    lines.push(`**Location**: ${formatLocation(finding)}`)
    const observations = renderObservationLine(finding)
    if (observations) {
      lines.push(observations)
    }
    const excerpt = sourceExcerpt(projectDir, finding)
    if (excerpt) {
      lines.push("")
      lines.push("**Source Excerpt**:")
      lines.push("")
      lines.push("```solidity")
      lines.push(excerpt)
      lines.push("```")
    }
    lines.push("")
    lines.push(`**Description**: ${renderFindingBody(finding)}`)
    lines.push("")
    lines.push(`**Impact**: ${sanitizeBodyMarkdown(impact)}`)
    lines.push("")
    lines.push(`**Recommendation**: ${sanitizeBodyMarkdown(recommendation)}`)
    const pocEvidence = getPocEvidence(finding)
    if (pocEvidence) {
      lines.push("")
      lines.push(`**PoC / Evidence**: ${sanitizeBodyMarkdown(pocEvidence)}`)
    }
    if (hasUnprovenForgeUnavailableNote(finding)) {
      lines.push("")
      lines.push("**Verification note**: unproven — Foundry unavailable")
    }
    lines.push("")
  }

  return lines.join("\n")
}

function renderFindingHeader(finding: Finding, displayId: string): string {
  const confidence =
    typeof finding.confidence_score === "number" ? ` · confidence: ${finding.confidence_score}` : ""
  return `### ${displayId} ${normalizeTitle(finding.check)} · severity: ${finding.severity}${confidence} · evidence: ${finding.confidence}`
}

const RUBRIC_TRACE_HEADER = "**Rubric Trace**"
const RUBRIC_GATE_LABELS = ["Refutation", "Reachability", "Trigger", "Impact"] as const

// A finding counts as having a rubric trace only when its description carries the
// full documented structure (refutation-rubric SKILL.md): header line with Verdict
// + Confidence, all four gate lines, and a Refutation quote. A bare `**Rubric
// Trace**` prefix is rejected — accepting prefix-only traces let the report
// overclaim a "4-gate trace" for structurally incomplete findings.
function hasRubricTrace(f: Finding): boolean {
  if (typeof f.description !== "string") return false
  const text = f.description.trimStart()
  if (!text.startsWith(RUBRIC_TRACE_HEADER)) return false
  const newlineIdx = text.indexOf("\n")
  const headerLine = newlineIdx === -1 ? text : text.slice(0, newlineIdx)
  if (!/\bVerdict:/.test(headerLine) || !/\bConfidence:/.test(headerLine)) return false
  for (const label of RUBRIC_GATE_LABELS) {
    if (!new RegExp(`^\\s*-\\s*${label}:`, "m").test(text)) return false
  }
  return /\*\*Refutation quote:\*\*/.test(text)
}

function hasValidRubricVerdict(f: Finding): boolean {
  const verdict = f.rubric_verdict
  return verdict === "CONFIRMED" || verdict === "DEMOTED" || verdict === "REJECTED_DEMOTED"
}

function wasRubricAssessed(f: Finding): boolean {
  return hasRubricTrace(f) || hasValidRubricVerdict(f)
}

function renderFindingBody(f: Finding): string {
  const annotation = wasRubricAssessed(f)
    ? ""
    : "⚠️ no rubric trace — this finding was emitted without applying the 4-gate refutation rubric.\n\n"
  return annotation + sanitizeBodyMarkdown(f.description ?? "")
}

function renderAdoptionFooter(findings: Finding[]): string {
  if (findings.length === 0) return ""
  const assessed = findings.filter(wasRubricAssessed).length
  return `\n\n---\n\n_Rubric: ${assessed}/${findings.length} findings assessed via the 4-gate refutation rubric_\n`
}

function buildLeadsSection(
  findings: Finding[],
  idAssignments?: ReadonlyMap<string, string>,
): string {
  if (findings.length === 0) {
    return ""
  }

  const lines: string[] = ["## Leads"]
  let leadSeq = 0

  for (const finding of findings) {
    leadSeq += 1
    const assigned = idAssignments?.get(finding.id)
    const displayId = assigned ? `[${assigned}]` : `[LEAD-${leadSeq}]`
    lines.push(renderFindingHeader(finding, displayId))
    lines.push(`**Location**: ${formatLocation(finding)}`)
    const observations = renderObservationLine(finding)
    if (observations) {
      lines.push(observations)
    }
    lines.push("")
    lines.push(`**Description**: ${renderFindingBody(finding)}`)
    if (hasUnprovenForgeUnavailableNote(finding)) {
      lines.push("")
      lines.push("**Verification note**: unproven — Foundry unavailable")
    }
    lines.push("")
  }

  return lines.join("\n")
}

export function renderObservationLine(finding: Finding): string | null {
  const ids = finding.observation_ids?.filter((id) => id.trim().length > 0)
  if (!ids || ids.length === 0) return null
  return `**Observations (${ids.length}):** ${ids.join(" · ")}`
}

function buildOutOfScopeSection(findings: Finding[]): string {
  if (findings.length === 0) {
    return ""
  }
  const lines: string[] = [
    "## Out-of-Scope Observations",
    "These observations fall outside the audited scope and are awareness-only: they are excluded from the actionable Findings/Leads tiers and from the finding counts.",
  ]
  let seq = 0
  for (const finding of findings) {
    seq += 1
    lines.push(renderFindingHeader(finding, `[OOS-${seq}]`))
    lines.push(`**Location**: ${formatLocation(finding)}`)
    lines.push("")
    lines.push(`**Description**: ${sanitizeBodyMarkdown(finding.description ?? "")}`)
    lines.push("")
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
  reportFindings: Finding[],
): string {
  const lines: string[] = ["## Appendix: Data Provenance"]

  lines.push("- Data source: `report_input` payload")
  lines.push(`- Severity threshold applied: ${threshold}`)
  lines.push(`- Findings included in report: ${reportFindings.length}`)

  if (reportFindings.length > 0) {
    const sourceCounts: Record<string, number> = {}
    for (const f of reportFindings) {
      sourceCounts[f.source] = (sourceCounts[f.source] ?? 0) + 1
    }
    lines.push("")
    lines.push("### Source Breakdown")
    lines.push("")
    lines.push("| Source | Count |")
    lines.push("| --- | ---: |")
    for (const [source, count] of Object.entries(sourceCounts).sort((a, b) => {
      const countDelta = b[1] - a[1]
      if (countDelta !== 0) return countDelta
      return a[0].localeCompare(b[0])
    })) {
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
      const toolName = typeof exec.tool === "string" && exec.tool ? exec.tool : "(unknown tool)"
      const hasTimes =
        typeof exec.startTime === "number" &&
        !Number.isNaN(exec.startTime) &&
        exec.endTime != null &&
        typeof exec.endTime === "number" &&
        !Number.isNaN(exec.endTime)
      const duration = hasTimes ? formatDuration((exec.endTime as number) - exec.startTime) : "N/A"
      const status =
        typeof exec.success === "boolean"
          ? exec.success
            ? "\u2705 success"
            : "\u274C failure"
          : "\u26A0 malformed"
      const findings =
        typeof exec.findingsCount === "number" && !Number.isNaN(exec.findingsCount)
          ? exec.findingsCount
          : "N/A"
      lines.push(`| ${toolName} | ${duration} | ${status} | ${findings} |`)
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
      const syncTime =
        typeof syncExec.startTime === "number" && !Number.isNaN(syncExec.startTime)
          ? new Date(syncExec.startTime).toISOString()
          : "N/A"
      lines.push(`- SCVD last synced: ${syncTime}`)
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

export type RenderReportOptions = {
  threshold?: number
  projectName?: string
  include_executive_summary?: boolean
  severity_threshold?: SeverityThreshold
  scope?: string[]
  preflightWarningSection?: string | null
  runId?: string
  // Stable identity -> bare display id ("CRIT-1") map. When omitted, sections fall
  // back to sequential per-severity numbering.
  idAssignments?: ReadonlyMap<string, string>
}

const METHODOLOGY_TOOL_LABELS: Record<string, string> = {
  slither: "Slither static analysis",
  "forge-test": "Foundry tests",
  patterns: "Pattern analysis",
  solodit: "Solodit research cross-referencing",
  analyzer: "Contract structural analysis",
}

// Derive the "tools used" list from the execution ledger so the Methodology never claims
// a tool ran when it did not (e.g. Slither when the binary is absent).
function buildMethodologyToolLines(
  toolsExecuted: ReportInput["toolsExecuted"],
  unavailableTools: ReportInput["unavailableTools"],
): string[] {
  const executed = new Set(
    (toolsExecuted ?? [])
      .filter((exec) => exec.success === true)
      .map((exec) => TOOL_SHORT_NAMES[exec.tool] ?? exec.tool),
  )
  const lines = KEY_TOOLS.filter((short) => executed.has(short)).map(
    (short) => `- ${METHODOLOGY_TOOL_LABELS[short] ?? short}`,
  )
  lines.push("- Manual review with the 4-gate refutation rubric")
  const unavailable = Array.from(
    new Set(
      (unavailableTools ?? [])
        .map((short) => UNAVAILABLE_TO_KEY_TOOL[short])
        .filter((short): short is string => Boolean(short))
        .map((short) => METHODOLOGY_TOOL_LABELS[short] ?? short),
    ),
  )
  if (unavailable.length > 0) {
    lines.push(`- Not available in this environment (compensated above): ${unavailable.join(", ")}`)
  }
  return lines
}

export function renderReportMarkdown(
  input: ReportInput,
  options: RenderReportOptions = {},
): string {
  const projectName = options.projectName ?? "Unknown Project"
  const includeExecutiveSummary = options.include_executive_summary ?? true
  const threshold = options.severity_threshold ?? "informational"
  const confidenceThreshold = options.threshold ?? DEFAULT_CONFIDENCE_THRESHOLD
  const preflightWarningSection = options.preflightWarningSection ?? null
  const toolsExecuted = input.toolsExecuted ?? []
  const state = reportInputToAuditState({ ...input, toolsExecuted })
  const scope = options.scope ?? input.scope ?? []
  const finalFindings = finalizeProjectedFindings(input.findings, toolsExecuted, {
    forgeAvailable: isForgeAvailable(input.unavailableTools),
  })
  const thresholdedFindings = finalFindings.filter((finding) =>
    shouldIncludeFinding(finding, threshold),
  )
  const inScopeFindings = thresholdedFindings.filter((finding) => isFindingInScope(finding, scope))
  const outOfScopeFindings = sortFindingsDeterministically(
    thresholdedFindings.filter((finding) => !isFindingInScope(finding, scope)),
  )
  const reportFindings = sortFindingsDeterministically(inScopeFindings)
  const tiers = splitFindingsByTier(reportFindings, confidenceThreshold)
  const findings = sortFindingsBySeverityThenConfidence(tiers.findings)
  const leads = sortFindingsByConfidence(tiers.leads)
  // Executive summary, counts, provenance, and the rubric footer reflect in-scope
  // findings only; out-of-scope observations render in a dedicated appendix.
  const counts = calculateCounts(reportFindings)
  const findingsTierCounts = calculateCounts(findings)
  const leadsTierCounts = calculateCounts(leads)
  const runStartTime = toolsExecuted.reduce(
    (earliest, exec) =>
      typeof exec.startTime === "number" &&
      exec.startTime > UNKNOWN_TIMESTAMP_SENTINEL &&
      exec.startTime < earliest
        ? exec.startTime
        : earliest,
    Number.MAX_SAFE_INTEGER,
  )
  const auditDate =
    runStartTime < Number.MAX_SAFE_INTEGER
      ? new Date(runStartTime).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)

  const sections: string[] = [`# Security Audit Report — ${projectName}`]

  if (includeExecutiveSummary) {
    sections.push("## Executive Summary")
    sections.push(
      `This report summarizes security findings identified for ${projectName} based on static analysis, testing, and pattern-based review.`,
    )
    sections.push("")
    sections.push("| Severity | Findings | Leads | Total |")
    sections.push("| --- | ---: | ---: | ---: |")
    sections.push(
      `| Critical | ${findingsTierCounts.critical} | ${leadsTierCounts.critical} | ${counts.critical} |`,
    )
    sections.push(
      `| High | ${findingsTierCounts.high} | ${leadsTierCounts.high} | ${counts.high} |`,
    )
    sections.push(
      `| Medium | ${findingsTierCounts.medium} | ${leadsTierCounts.medium} | ${counts.medium} |`,
    )
    sections.push(`| Low | ${findingsTierCounts.low} | ${leadsTierCounts.low} | ${counts.low} |`)
    sections.push(
      `| Informational | ${findingsTierCounts.informational} | ${leadsTierCounts.informational} | ${counts.informational} |`,
    )
    sections.push("")
    sections.push(`Overall risk assessment: ${overallRiskAssessment(counts)}.`)
  }

  sections.push("## Scope")
  sections.push("Contracts in scope:")
  if (scope.length === 0) {
    sections.push("- None provided")
  } else {
    for (const contract of scope) {
      sections.push(`- ${contract}`)
    }
  }
  sections.push(`Audit date: ${auditDate}`)

  sections.push("## Methodology")
  sections.push("Tools and techniques used:")
  for (const line of buildMethodologyToolLines(input.toolsExecuted, input.unavailableTools)) {
    sections.push(line)
  }
  sections.push(
    "Approach: Findings are normalized, then split into Findings/Leads by rubric verdict (CONFIRMED → Findings; DEMOTED/REJECTED_DEMOTED → Leads), falling back to the confidence threshold for unscored/legacy findings; the Findings tier is ordered severity-first (confidence breaks ties) while the Leads tier is ordered by confidence, both falling back to file/line for determinism, and validated against report quality gates before emission.",
  )

  const findingsSection = buildFindingsSection(findings, input.projectDir, options.idAssignments)
  if (findingsSection.length > 0) {
    sections.push(findingsSection)
  }
  const leadsSection = buildLeadsSection(leads, options.idAssignments)
  if (leadsSection.length > 0) {
    sections.push(leadsSection)
  }

  sections.push("## Recommendations")
  for (const item of buildRecommendations(counts)) {
    sections.push(`- ${item}`)
  }

  const outOfScopeSection = buildOutOfScopeSection(outOfScopeFindings)
  if (outOfScopeSection.length > 0) {
    sections.push(outOfScopeSection)
  }

  if (preflightWarningSection) {
    sections.push(preflightWarningSection)
  }

  const allFindings = [...findings, ...leads]
  // Provenance must cover every rendered finding (Findings + Leads); passing only
  // the confirmed tier undercounts visible Leads in appendix counts/source breakdown.
  sections.push(buildProvenanceAppendix(state, threshold, allFindings))

  const runId = options.runId ?? input.run_id
  if (runId) {
    sections.push(buildReportMetadataComment(runId))
  }

  return sections.join("\n\n") + renderAdoptionFooter(allFindings)
}

export async function executeReportGeneration(
  args: ReportGeneratorArgs,
  context: ToolContext,
  deps: ReportGenerationDependencies = {},
): Promise<ReportGenerationResult> {
  const includeExecutiveSummary = args.include_executive_summary ?? true
  const threshold = args.severity_threshold ?? "informational"
  const qualityGatePolicy = args.quality_gate_policy ?? "warn"
  const toolCoveragePolicy = args.tool_coverage_policy ?? "enforce"
  const expectedRunId = resolveExpectedRunId(args, context, deps)
  let confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD
  let loadedConfig: ArgusConfig | undefined
  let configLoadFailed = false
  const invalidRegenerationOptions =
    args.force === true && args.revision != null
      ? {
          code: "INVALID_REGENERATION_OPTIONS",
          message:
            "force and revision must not both be set. To regenerate a corrected report, call argus_generate_report with revision: 2 and omit force.",
        }
      : args.revision != null && (!Number.isInteger(args.revision) || args.revision < 2)
        ? {
            code: "INVALID_REGENERATION_OPTIONS",
            message:
              "revision must be an integer >= 2 (the base report is revision 1). To publish a corrected report, pass revision: 2.",
          }
        : null

  // Re-project report-input.json from the event stream so completeness/parity never
  // reads a stale projection left by an earlier turn. Idempotent; when there is no
  // event stream (e.g. an inline report_input payload in tests) it throws and we fall
  // back to the existing on-disk artifact or the provided payload.
  if (typeof expectedRunId === "string" && expectedRunId.length > 0) {
    const projectDir = resolveProjectDir(context)
    try {
      const { materializeReportInput } = await import(
        "../features/persistent-state/findings-materializer"
      )
      await materializeReportInput(expectedRunId, projectDir, context.sessionID)
    } catch {
      /* Best-effort: parseReportInputPayload will produce a clear error if the file is still missing */
    }
  }

  const { reportInput, diagnostics } = parseReportInputPayload(args, context, expectedRunId)
  try {
    const loadConfig = deps.loadConfig ?? loadArgusConfig
    const projectDir = resolveProjectDir(context)
    loadedConfig = loadConfig(projectDir)
    confidenceThreshold = loadedConfig.reporting?.confidenceThreshold ?? confidenceThreshold
  } catch {
    configLoadFailed = true
  }

  const preflightPolicy = args.preflight_policy ?? "warn"
  let preflightWarningSection: string | null = null
  const warningBullets: string[] = []
  if (configLoadFailed) {
    warningBullets.push(
      `- Config load failed; using default confidence threshold ${confidenceThreshold} for the Findings/Leads split`,
    )
  }
  const scope = args.scope.length > 0 ? args.scope : reportInput.scope
  const finalFindings = finalizeProjectedFindings(reportInput.findings, reportInput.toolsExecuted, {
    forgeAvailable: isForgeAvailable(reportInput.unavailableTools),
  })
  const outOfScopeFindings = collectOutOfScopeFindings(finalFindings, scope)
  if (outOfScopeFindings.length > 0) {
    const locations = outOfScopeFindings.map(formatLocation).join(", ")
    if (preflightPolicy === "strict-fail") {
      throw new Error(
        `Preflight failed (strict-fail): findings outside audited scope: ${locations}`,
      )
    }
    warningBullets.push(
      `- ${outOfScopeFindings.length} observation(s) outside audited scope moved to the Out-of-Scope Observations appendix: ${locations}`,
    )
  }

  // Hard gate: refuse to generate a report if key audit tools have not been executed
  if (toolCoveragePolicy !== "skip") {
    const missingTools = computeMissingKeyTools(
      reportInput.toolsExecuted,
      reportInput.unavailableTools,
    )
    const failedTools = computeFailedKeyTools(
      reportInput.toolsExecuted,
      reportInput.unavailableTools,
    )
    if (missingTools.length > 0) {
      const toolList = missingTools.join(", ")
      if (toolCoveragePolicy === "enforce") {
        throw new Error(
          `Tool coverage gate failed: the following key audit tools have not been executed: ${toolList}. ` +
            'Run the missing tools before generating a report, or pass tool_coverage_policy: "warn" to override.',
        )
      }
      warningBullets.push(`- Tool coverage incomplete: ${toolList} not executed`)
    }
    if (failedTools.length > 0) {
      warningBullets.push(
        `- Key audit tool attempts failed and were treated as coverage limitations: ${failedTools.join(", ")}`,
      )
    }
  }

  try {
    const readEventsFn = deps.readEvents ?? readEvents
    const events = await readEventsFn(reportInput.run_id, reportInput.projectDir)
    const preflightResult = checkReportPreflight(events, { allowLiveAudit: true })
    if (!preflightResult.passed) {
      if (preflightPolicy === "strict-fail") {
        const parts: string[] = []
        if (preflightResult.orphanedTools.length > 0)
          parts.push(`orphaned tools: ${preflightResult.orphanedTools.join(", ")}`)
        if (preflightResult.missingLifecycle.length > 0)
          parts.push(`missing lifecycle: ${preflightResult.missingLifecycle.join(", ")}`)
        if (preflightResult.missingRequiredTools.length > 0)
          parts.push(`missing required tools: ${preflightResult.missingRequiredTools.join(", ")}`)
        throw new Error(`Preflight failed (strict-fail): ${parts.join("; ")}`)
      }
      if (preflightResult.orphanedTools.length > 0)
        warningBullets.push(`- Orphaned tools: ${preflightResult.orphanedTools.join(", ")}`)
      if (preflightResult.missingLifecycle.length > 0)
        warningBullets.push(`- Missing lifecycle: ${preflightResult.missingLifecycle.join(", ")}`)
      if (preflightResult.missingRequiredTools.length > 0)
        warningBullets.push(
          `- Missing required tools: ${preflightResult.missingRequiredTools.join(", ")}`,
        )
      if (preflightResult.warnings.length > 0)
        warningBullets.push(`- Warnings: ${preflightResult.warnings.join(", ")}`)
    }

    const eventFindings = finalizeProjectedFindings(
      projectFindings(events),
      reportInput.toolsExecuted,
      {
        forgeAvailable: isForgeAvailable(reportInput.unavailableTools),
      },
    )
    const inputFindings = finalizeProjectedFindings(
      reportInput.findings,
      reportInput.toolsExecuted,
      {
        forgeAvailable: isForgeAvailable(reportInput.unavailableTools),
      },
    )
    const hasLineage = hasCompleteDedupLineage(
      reportInput.findings,
      reportInput.dropped_observations,
    )
    const partialLineage = hasPartialDedupLineage(reportInput.findings)
    const shouldCheckParity =
      !partialLineage && (eventFindings.length === inputFindings.length || hasLineage)
    const lineage = hasLineage
      ? validateFindingLineage(
          eventFindings,
          reportInput.findings,
          reportInput.dropped_observations,
        )
      : null
    const parity = shouldCheckParity
      ? lineage
        ? {
            missing: lineage.missing_observation_ids,
            extra: lineage.phantom_observation_ids,
            duplicates: lineage.duplicate_observation_ids,
            countMismatches: lineage.count_mismatches,
            matches: lineage.valid,
          }
        : {
            ...compareIssueFingerprintSets(eventFindings, inputFindings),
            duplicates: [],
            countMismatches: [],
          }
      : { missing: [], extra: [], duplicates: [], countMismatches: [], matches: true }

    if (partialLineage) {
      const partialSummary = `event_findings=${eventFindings.length}, report_findings=${inputFindings.length}`
      if (preflightPolicy === "strict-fail") {
        throw new Error(
          `Preflight failed (strict-fail): finding parity not verifiable (${partialSummary}; partial observation_ids)`,
        )
      }

      warningBullets.push(
        `- Finding parity not verifiable: ${partialSummary}; partial dedup lineage means some findings lack observation_ids`,
      )
    } else if (!shouldCheckParity) {
      const unverifiableSummary = `event_findings=${eventFindings.length}, report_findings=${inputFindings.length}`
      if (preflightPolicy === "strict-fail") {
        throw new Error(
          `Preflight failed (strict-fail): finding parity not verifiable (${unverifiableSummary}; missing observation_ids)`,
        )
      }

      warningBullets.push(
        `- Finding parity not verifiable: ${unverifiableSummary}; deduped findings must include observation_ids to prove merged observations were preserved`,
      )
    }

    if (!parity.matches) {
      const mismatchSummary = `missing=${parity.missing.length}, extra=${parity.extra.length}`
      if (preflightPolicy === "strict-fail") {
        throw new Error(
          `Preflight failed (strict-fail): finding parity mismatch (${mismatchSummary})`,
        )
      }

      warningBullets.push(`- Finding parity mismatch: ${mismatchSummary}`)
      const parityLabel = hasLineage ? "observation IDs" : "issue fingerprints"
      if (parity.missing.length > 0) {
        warningBullets.push(`- Missing ${parityLabel}: ${parity.missing.join(", ")}`)
      }
      if (parity.extra.length > 0) {
        warningBullets.push(`- Extra ${parityLabel}: ${parity.extra.join(", ")}`)
      }
      if (parity.duplicates.length > 0) {
        warningBullets.push(`- Duplicate ${parityLabel}: ${parity.duplicates.join(", ")}`)
      }
      if (parity.countMismatches.length > 0) {
        warningBullets.push(
          `- Observation count mismatches: ${parity.countMismatches.map((item) => item.check).join(", ")}`,
        )
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Preflight failed (strict-fail)")) {
      throw err
    }
    if (preflightPolicy === "strict-fail") {
      throw new Error("Preflight failed: unable to read event stream for completeness check")
    }
    // warn mode: skip preflight when events cannot be read
  }

  if (warningBullets.length > 0) {
    preflightWarningSection = [
      "## \u26A0 Completeness Warning",
      "",
      "This report was generated with incomplete orchestration state.",
      "",
      ...warningBullets,
    ].join("\n")
  }

  const findings = sortFindingsDeterministically(
    finalFindings.filter(
      (finding) => shouldIncludeFinding(finding, threshold) && isFindingInScope(finding, scope),
    ),
  )
  // Quality gates apply to the Findings tier only; Leads are description-only per rubric.
  const { findings: confirmedFindings, leads: leadFindings } = splitFindingsByTier(
    findings,
    confidenceThreshold,
  )
  const qualityGates = validateReportQuality(confirmedFindings, qualityGatePolicy)
  if (!qualityGates.passed && qualityGatePolicy === "strict-fail") {
    throw new Error(
      `Report quality gates failed: ${JSON.stringify({ passed: false, violations: qualityGates.violations })}`,
    )
  }
  // findingsCount is scoped to the Findings tier to agree with qualityGates;
  // leadsTierCount and totalCount expose the Leads and combined sets.
  const findingsCount = calculateCounts(confirmedFindings)
  const leadsTierCount = calculateCounts(leadFindings)
  const totalCount = calculateCounts(findings)
  // Derive audit date from the run's start time for deterministic output.
  // Falls back to the earliest toolsExecuted timestamp, then current date as last resort.
  // Exclude UNKNOWN_TIMESTAMP_SENTINEL (patched-in value for missing timestamps).
  const runStartTime = reportInput.toolsExecuted.reduce(
    (earliest, exec) =>
      typeof exec.startTime === "number" &&
      exec.startTime > UNKNOWN_TIMESTAMP_SENTINEL &&
      exec.startTime < earliest
        ? exec.startTime
        : earliest,
    Number.MAX_SAFE_INTEGER,
  )
  const auditDate =
    runStartTime < Number.MAX_SAFE_INTEGER
      ? new Date(runStartTime).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)

  context.metadata({ title: `Generate audit report: ${args.project_name}` })

  // Embed report metadata for single-writer policy enforcement
  const runId = expectedRunId ?? reportInput.run_id
  if (runId.startsWith("ses_")) {
    throw new Error("Report generation requires canonical run_id; received OpenCode session id")
  }

  // Assign citable IDs from the per-run registry so they stay stable across revisions.
  // New findings are numbered in render order, matching the report's own tier sorting.
  let idAssignments: Map<string, string> | undefined
  if (runId.length > 0) {
    const idProjectDir = resolveProjectDir(context)
    const existingIdMap = await loadFindingIdRegistry(runId, idProjectDir)
    idAssignments = assignStableFindingIds(
      sortFindingsBySeverityThenConfidence(confirmedFindings),
      sortFindingsByConfidence(leadFindings),
      existingIdMap,
    )
  }

  const reportMarkdown = renderReportMarkdown(reportInput, {
    projectName: args.project_name,
    include_executive_summary: includeExecutiveSummary,
    severity_threshold: threshold,
    threshold: confidenceThreshold,
    scope,
    preflightWarningSection,
    runId,
    idAssignments,
  })
  const contentHash = stableHash(reportMarkdown)
  // When the regeneration options are already invalid (e.g. revision < 2) resolve the
  // base path so we return the structured INVALID_REGENERATION_OPTIONS error below rather
  // than throwing an unstructured ReportPathError on the invalid revision.
  const { filename: canonicalFilename } = resolveReportPath({
    contractName: args.project_name,
    date: new Date(auditDate),
    outputDir: loadedConfig?.reporting?.output_dir ?? ".argus/reports/",
    runId: runId || undefined,
    revision: invalidRegenerationOptions ? undefined : args.revision,
  })

  const result: ReportGenerationResult = {
    success: false,
    report: reportMarkdown,
    findingsCount,
    leadsTierCount,
    totalCount,
    filename: canonicalFilename,
    run_id: runId,
    contentHash,
    qualityGates,
    contractDiagnostics: diagnostics,
  }

  if (invalidRegenerationOptions) {
    result.error = invalidRegenerationOptions
    return result
  }

  try {
    const loadConfig = deps.loadConfig ?? loadArgusConfig
    const projectDir = resolveProjectDir(context)
    const config = loadedConfig ?? loadConfig(projectDir)
    const rawOutputDir = config.reporting?.output_dir ?? ".argus/reports/"
    const resolvedOutput = path.resolve(projectDir, rawOutputDir)
    if (!isContained(resolvedOutput, projectDir)) {
      result.error = {
        code: "OUTPUT_DIR_TRAVERSAL",
        message: `output_dir "${rawOutputDir}" resolves outside the project root (or via an escaping symlink). Report not written.`,
      }
      return result
    }
    const { filePath: fullPath } = resolveReportPath({
      contractName: args.project_name,
      date: new Date(auditDate),
      outputDir: resolvedOutput,
      runId: runId || undefined,
      revision: args.revision,
    })
    const manifestPath = createAuditArtifactResolver(runId, projectDir).paths().reportsManifestFile
    const currentDedupedContentHash = dedupedContentHash(reportInput)
    const manifest = readReportManifest(manifestPath, runId)
    manifest.reports = mergeReportEntries(
      manifest.reports,
      scanRunReports(resolvedOutput, runId, currentDedupedContentHash),
    )
    const existingReports = manifest.reports.filter((entry) => existsSync(entry.filePath))
    const reusableReport = existingReports.find(
      (entry) => entry.contentHash === contentHash && isContained(entry.filePath, resolvedOutput),
    )

    if (runId && args.force !== true && reusableReport) {
      result.filePath = reusableReport.filePath
      result.filename = reusableReport.filename
      result.idempotent = true
      result.reportStatus = "reused"
      result.reportsManifestFile = manifestPath
      manifest.reports = upsertReportEntry(manifest.reports, reusableReport)
      await writeReportManifest(manifestPath, manifest)
      result.success = true
      return result
    }

    const hasChangedReportContent = existingReports.some(
      (entry) => entry.contentHash !== contentHash,
    )
    if (runId && args.force !== true && args.revision == null && hasChangedReportContent) {
      result.error = {
        code: "REVISION_REQUIRED",
        message: `Report content changed for run_id "${runId}". Re-persist changed findings if needed, then call argus_generate_report with revision: 2 or the next available revision.`,
      }
      result.reportsManifestFile = manifestPath
      await writeReportManifest(manifestPath, manifest)
      return result
    }

    // Single-writer policy: check for duplicate writes with same run_id
    if (runId) {
      if (args.force === true) {
        const forceError = await checkSafeForceOverwrite(fullPath, runId)
        if (forceError) {
          result.error = forceError
          return result
        }
      } else {
        const duplicateError = await checkDuplicateWrite(fullPath, runId)
        if (duplicateError) {
          result.error = duplicateError
          return result
        }
      }
    }

    if (!isContained(fullPath, projectDir)) {
      result.error = {
        code: "OUTPUT_DIR_TRAVERSAL",
        message: `resolved report path escapes the project root. Report not written.`,
      }
      return result
    }
    await Bun.write(fullPath, reportMarkdown)
    result.filePath = fullPath
    result.filename = path.basename(fullPath)
    result.reportStatus = "written"
    result.reportsManifestFile = manifestPath
    if (runId.length > 0 && idAssignments) {
      await persistFindingIdRegistry(runId, projectDir, idAssignments)
    }
    manifest.reports = upsertReportEntry(manifest.reports, {
      revision: args.revision ?? 1,
      filePath: fullPath,
      filename: path.basename(fullPath),
      contentHash,
      dedupedContentHash: currentDedupedContentHash,
      createdAt: Date.now(),
    })
    await writeReportManifest(manifestPath, manifest)
    result.success = true
  } catch (err: unknown) {
    const logger = createLogger()
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(`Failed to write report to disk: ${message}`)
    result.error = {
      code: "WRITE_FAILED",
      message,
    }
  }

  return result
}

export const reportGeneratorTool = tool({
  description:
    "Generate a professional markdown security audit report. Pass project_name, scope, and run_id — the tool reads the materialized ReportInput artifact from disk automatically.",
  args: {
    project_name: tool.schema.string(),
    scope: tool.schema.array(tool.schema.string()),
    include_executive_summary: tool.schema.boolean().default(true),
    severity_threshold: tool.schema
      .enum(["critical", "high", "medium", "low", "informational"])
      .default("informational"),
    preflight_policy: tool.schema.enum(["warn", "strict-fail"]).optional(),
    quality_gate_policy: tool.schema
      .enum(["warn", "strict-fail"])
      .optional()
      .describe("Controls whether report quality gate violations warn or fail generation."),
    tool_coverage_policy: tool.schema
      .enum(["enforce", "warn", "skip"])
      .optional()
      .describe(
        "Controls whether report generation requires key audit tools to have been executed. " +
          "Defaults to 'enforce'.",
      ),
    run_id: tool.schema
      .string()
      .optional()
      .describe(
        "The canonical run ID from <argus-context>. The tool reads the materialized report-input.json from disk using this ID.",
      ),
    revision: tool.schema
      .number()
      .optional()
      .describe(
        "Caller-supplied report revision. Must be an integer >= 2 and writes a -r{revision} file.",
      ),
    force: tool.schema
      .boolean()
      .optional()
      .describe(
        "Overwrite only the base canonical report path when existing Argus metadata matches the same run_id.",
      ),
  },
  async execute(args, context) {
    let effectiveArgs: ReportGeneratorArgs = args
    if (context.agent === "argus") {
      const runId = args.run_id?.trim()
      if (!runId || runId.startsWith("ses_")) {
        throw new Error("Argus report recovery requires a canonical run_id")
      }
      if (args.force === true || args.revision != null) {
        throw new Error("Argus report recovery cannot force or revise reports")
      }
      const dedupedFile = createAuditArtifactResolver(runId, resolveProjectDir(context)).paths()
        .dedupedFindingsFile
      if (!existsSync(dedupedFile)) {
        throw new Error("Argus report recovery requires persisted deduped findings")
      }
      effectiveArgs = {
        ...args,
        report_input: undefined,
        scope: [],
        severity_threshold: "informational",
        preflight_policy: "strict-fail",
        quality_gate_policy: "strict-fail",
        tool_coverage_policy: "enforce",
      }
    }

    const result = await executeReportGeneration(effectiveArgs, context)
    if (result.error) {
      throw new Error(
        `argus_generate_report failed [${result.error.code}]: ${result.error.message}`,
      )
    }
    // Return a slim payload to avoid OpenCode truncating large tool results.
    // The full markdown is already written to disk at result.filePath.
    // Truncated JSON breaks tool-tracking-hook parsing, which prevents
    // reportGenerated from being set and blocks run finalization.
    const { report, ...slimResult } = result
    return JSON.stringify({
      ...slimResult,
      reportSummary: `Report written to disk (${report.length} bytes, ${report.split("\n").length} lines). See filePath.`,
    })
  },
})
