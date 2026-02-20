import type { SkillDoc } from "./normalize"
import type { SimilarityPair, SimilarityScore } from "./similarity"

export type GateLevel = "block" | "warn" | "info" | "pass"

export interface GateVerdict {
  level: GateLevel
  reason: string
}

export interface GateConfig {
  blockThreshold: number
  warnThreshold: number
  infoThreshold: number
  blockExactRegexConflict: boolean
}

export interface SkillReport {
  totalSkills: number
  findings: Array<{
    skillA: string
    skillB: string
    score: SimilarityScore
    verdict: GateVerdict
  }>
  summary: { block: number; warn: number; info: number }
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
  blockThreshold: 0.9,
  warnThreshold: 0.78,
  infoThreshold: 0.65,
  blockExactRegexConflict: true,
}

const LEVEL_ORDER: Record<GateLevel, number> = {
  block: 0,
  warn: 1,
  info: 2,
  pass: 3,
}

function formatScore(score: number): string {
  return score.toFixed(2)
}

function normalizeRegex(rule: string): string {
  return rule.replace(/\s+/g, " ").trim()
}

function pairKey(skillA: string, skillB: string): string {
  return skillA < skillB ? `${skillA}|||${skillB}` : `${skillB}|||${skillA}`
}

function topSignals(score: SimilarityScore): string {
  const signals = [
    { label: "body TF-IDF", value: score.bodyTfidf },
    { label: "body shingles", value: score.bodyShingle },
    { label: "name/description", value: score.nameDesc },
    { label: "detection rules", value: score.detectionRules },
  ]

  signals.sort((left, right) => right.value - left.value)
  return signals
    .slice(0, 2)
    .map((signal) => `${signal.label} ${formatScore(signal.value)}`)
    .join(", ")
}

function scoreForConflict(score: SimilarityScore | undefined): SimilarityScore {
  if (score) return score

  return {
    composite: 1,
    bodyTfidf: 0,
    bodyShingle: 0,
    nameDesc: 0,
    detectionRules: 1,
  }
}

export function evaluatePair(pair: SimilarityPair, config: GateConfig = DEFAULT_GATE_CONFIG): GateVerdict {
  const composite = pair.score.composite
  const signalSummary = topSignals(pair.score)
  const reasonSuffix = `composite ${formatScore(composite)}; top signals: ${signalSummary}`

  if (composite >= config.blockThreshold) {
    return { level: "block", reason: `Duplicate risk: ${reasonSuffix}` }
  }

  if (composite >= config.warnThreshold) {
    return { level: "warn", reason: `Near-duplicate risk: ${reasonSuffix}` }
  }

  if (composite >= config.infoThreshold) {
    return { level: "info", reason: `Related skills: ${reasonSuffix}` }
  }

  return { level: "pass", reason: `Below thresholds: ${reasonSuffix}` }
}

export function checkExactRegexConflicts(
  docs: SkillDoc[],
): Array<{ skillA: string; skillB: string; sharedRegex: string }> {
  const conflicts: Array<{ skillA: string; skillB: string; sharedRegex: string }> = []

  for (let i = 0; i < docs.length; i += 1) {
    const docA = docs[i]
    if (!docA) continue

    const rulesA = new Set(docA.detectionRules.map(normalizeRegex).filter((rule) => rule.length > 0))

    for (let j = i + 1; j < docs.length; j += 1) {
      const docB = docs[j]
      if (!docB) continue
      if (docA.name === docB.name) continue

      const rulesB = new Set(docB.detectionRules.map(normalizeRegex).filter((rule) => rule.length > 0))
      for (const sharedRegex of rulesA) {
        if (!rulesB.has(sharedRegex)) continue
        conflicts.push({
          skillA: docA.name,
          skillB: docB.name,
          sharedRegex,
        })
      }
    }
  }

  return conflicts
}

export function generateReport(
  docs: SkillDoc[],
  pairs: SimilarityPair[],
  config: GateConfig = DEFAULT_GATE_CONFIG,
): SkillReport {
  const findings: SkillReport["findings"] = []
  const pairScores = new Map<string, SimilarityScore>()

  for (const pair of pairs) {
    pairScores.set(pairKey(pair.skillA, pair.skillB), pair.score)

    const verdict = evaluatePair(pair, config)
    if (verdict.level === "pass") continue

    findings.push({
      skillA: pair.skillA,
      skillB: pair.skillB,
      score: pair.score,
      verdict,
    })
  }

  if (config.blockExactRegexConflict) {
    const indexByPairKey = new Map<string, number>()
    findings.forEach((finding, index) => {
      indexByPairKey.set(pairKey(finding.skillA, finding.skillB), index)
    })

    const conflicts = checkExactRegexConflicts(docs)
    for (const conflict of conflicts) {
      const key = pairKey(conflict.skillA, conflict.skillB)
      const existingIndex = indexByPairKey.get(key)
      const conflictReason = `Exact detection rule conflict: ${conflict.sharedRegex}`

      if (existingIndex !== undefined) {
        const existing = findings[existingIndex]
        if (!existing) continue
        existing.verdict = { level: "block", reason: conflictReason }
        continue
      }

      findings.push({
        skillA: conflict.skillA,
        skillB: conflict.skillB,
        score: scoreForConflict(pairScores.get(key)),
        verdict: { level: "block", reason: conflictReason },
      })
      indexByPairKey.set(key, findings.length - 1)
    }
  }

  findings.sort((left, right) => {
    const levelDelta = LEVEL_ORDER[left.verdict.level] - LEVEL_ORDER[right.verdict.level]
    if (levelDelta !== 0) return levelDelta
    return right.score.composite - left.score.composite
  })

  const summary = { block: 0, warn: 0, info: 0 }
  for (const finding of findings) {
    if (finding.verdict.level === "block") summary.block += 1
    if (finding.verdict.level === "warn") summary.warn += 1
    if (finding.verdict.level === "info") summary.info += 1
  }

  return {
    totalSkills: docs.length,
    findings,
    summary,
  }
}

export function formatReportText(report: SkillReport): string {
  const lines = [
    `Skills: ${report.totalSkills} | Blocks: ${report.summary.block} | Warnings: ${report.summary.warn} | Info: ${report.summary.info}`,
  ]

  for (const finding of report.findings) {
    lines.push(
      `[${finding.verdict.level.toUpperCase()}] ${finding.skillA} ↔ ${finding.skillB} (${formatScore(finding.score.composite)}) — ${finding.verdict.reason}`,
    )
  }

  return lines.join("\n")
}

export function formatReportJson(report: SkillReport): string {
  return JSON.stringify(report, null, 2)
}
