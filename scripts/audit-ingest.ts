import {
  buildTfidfCorpus,
  clusterFindings,
  computeSimilarity,
  DEFAULT_CLUSTER_CONFIG,
  normalizeSkill,
  tokenJaccard,
  type ClusterFinding,
  type FindingCluster,
  type SkillDoc,
  type TfidfCorpus,
} from "../src/skills/analysis"
import type { ExtractedFinding } from "./audit-pdf-extract-lib"

const FINDINGS_FILE = "scripts/audit-pdf-output/findings.json"
const OUTPUT_DIR = "scripts/audit-ingest-output"
const CANDIDATES_DIR = `${OUTPUT_DIR}/candidates`
const SKILL_GLOB = "skills/**/SKILL.md"
const CROSS_CATEGORY_THRESHOLD = 0.78
const COVERED_THRESHOLD = 0.82
const MAYBE_COVERED_THRESHOLD = 0.74
const MAX_SLUG_LENGTH = 60

type CoverageStatus = "covered" | "maybe-covered" | "new"

type CoverageMatch = { clusterId: number; slug: string; bestMatch: string; similarity: number }
type CoverageNew = { clusterId: number; slug: string; size: number; topTokens: string[] }
type IngestReport = {
  timestamp: string
  input: { findingsFile: string; totalFindings: number }
  clustering: { totalClusters: number; totalSingletons: number; mergedCrossCategory: number }
  coverage: { covered: CoverageMatch[]; maybeCovered: CoverageMatch[]; new: CoverageNew[] }
  candidatesGenerated: number
  outputDir: string
}
type ClusterCoverage = { cluster: FindingCluster; slug: string; status: CoverageStatus }

function normalizeOneLine(input: string): string {
  return input.replace(/\s+/g, " ").trim()
}
function tokenizeLightweight(input: string): string[] {
  return normalizeOneLine(input)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3)
}
function escapeTableCell(input: string): string {
  return normalizeOneLine(input).replace(/\|/g, "\\|")
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isExtractedFinding(value: unknown): value is ExtractedFinding {
  if (!isRecord(value)) return false
  return (
    typeof value.title === "string" &&
    typeof value.severity === "string" &&
    typeof value.description === "string" &&
    typeof value.recommendation === "string" &&
    typeof value.category === "string" &&
    typeof value.source_pdf === "string" &&
    typeof value.page === "number"
  )
}

function inferSourceName(sourcePdf: string): string {
  const [head] = sourcePdf.split(" - ")
  const sourceName = normalizeOneLine(head ?? "")
  return sourceName || sourcePdf
}

function toClusterFinding(finding: ExtractedFinding): ClusterFinding {
  return {
    title: finding.title,
    severity: finding.severity,
    description: finding.description,
    category: finding.category,
    source_pdf: finding.source_pdf,
    source_name: inferSourceName(finding.source_pdf),
  }
}

function scoreClusterPair(a: FindingCluster, b: FindingCluster): number {
  const left = `${a.medoid.title} ${a.medoid.description}`
  const right = `${b.medoid.title} ${b.medoid.description}`
  return tokenJaccard(tokenizeLightweight(left), tokenizeLightweight(right))
}

function nextUniqueSlug(baseSlug: string, usedSlugs: Set<string>): string {
  if (!usedSlugs.has(baseSlug)) {
    usedSlugs.add(baseSlug)
    return baseSlug
  }

  for (let index = 2; index < 10_000; index += 1) {
    const suffix = `-${index}`
    const trimmed = baseSlug
      .slice(0, Math.max(1, MAX_SLUG_LENGTH - suffix.length))
      .replace(/-+$/g, "")
    const candidate = `${trimmed}${suffix}`
    if (!usedSlugs.has(candidate)) {
      usedSlugs.add(candidate)
      return candidate
    }
  }

  const fallback = `${baseSlug.slice(0, Math.max(1, MAX_SLUG_LENGTH - 8))}-overflow`.slice(0, MAX_SLUG_LENGTH)
  usedSlugs.add(fallback)
  return fallback
}

function assignClusterSlugs(clusters: FindingCluster[]): Map<number, string> {
  const usedSlugs = new Set<string>()
  const slugById = new Map<number, string>()
  for (const cluster of [...clusters].sort((a, b) => a.id - b.id)) {
    slugById.set(cluster.id, nextUniqueSlug(toSlug(cluster.medoid.title), usedSlugs))
  }
  return slugById
}

function bestSimilarity(candidate: SkillDoc, existingSkills: SkillDoc[], corpus: TfidfCorpus): { bestMatch: string; similarity: number } {
  let bestMatch = ""
  let maxSimilarity = 0
  for (const existing of existingSkills) {
    const similarity = computeSimilarity(candidate, existing, corpus).composite
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity
      bestMatch = existing.name
    }
  }
  return { bestMatch, similarity: maxSimilarity }
}

async function loadFindings(filePath: string): Promise<ExtractedFinding[] | null> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    console.error(`Error: findings file not found at ${filePath}`)
    process.exitCode = 1
    return null
  }
  let payload: unknown
  try {
    payload = await file.json()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`Error: failed to parse findings JSON at ${filePath}: ${reason}`)
    process.exitCode = 1
    return null
  }
  if (!Array.isArray(payload)) {
    console.error(`Error: expected findings array in ${filePath}`)
    process.exitCode = 1
    return null
  }
  const validFindings = payload.filter(isExtractedFinding)
  if (validFindings.length !== payload.length) {
    console.warn(`Warning: ignored ${payload.length - validFindings.length} malformed finding entries`)
  }
  return validFindings
}

async function loadExistingSkills(): Promise<SkillDoc[]> {
  const skillPaths: string[] = []
  for await (const path of new Bun.Glob(SKILL_GLOB).scan(".")) {
    skillPaths.push(path)
  }
  skillPaths.sort((a, b) => a.localeCompare(b))
  const docs: SkillDoc[] = []
  for (const path of skillPaths) {
    const skill = normalizeSkill(await Bun.file(path).text())
    if (skill) {
      docs.push(skill)
    }
  }
  return docs
}

export function toSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+/g, "")
    .replace(/-+$/g, "")
  return slug || "untitled"
}

export function classifyCoverage(maxSimilarity: number): CoverageStatus {
  if (maxSimilarity >= COVERED_THRESHOLD) return "covered"
  if (maxSimilarity >= MAYBE_COVERED_THRESHOLD) return "maybe-covered"
  return "new"
}

export function renderCandidateSkill(cluster: FindingCluster, slug: string, status: string): string {
  const title = normalizeOneLine(cluster.medoid.title)
  const overview = normalizeOneLine(cluster.medoid.description)
  const indicators = cluster.topTokens.slice(0, 10)
  const indicatorList = indicators.length > 0 ? indicators.map((token) => `- ${token}`).join("\n") : "- none identified"
  const sourceRows = cluster.members
    .map((member) => {
      const rowTitle = escapeTableCell(member.title)
      const rowSeverity = escapeTableCell(member.severity)
      const rowSource = escapeTableCell(member.source_pdf)
      return `| ${rowTitle} | ${rowSeverity} | ${rowSource} |`
    })
    .join("\n")
  return `---
name: ${slug}
description: ${JSON.stringify(title)}
category: vulnerability-pattern
source_url: ""
source_license: ""
imported_at: "${new Date().toISOString()}"
detection_rules: []
---

# ${title}

## Overview

${overview}

## Common Indicators

${indicatorList}

## Source Findings

| title | severity | source_pdf |
| --- | --- | --- |
${sourceRows}

<!-- TODO: Add detection_rules with regex patterns -->
<!-- TODO: Review and refine description -->
<!-- Generated by audit-ingest pipeline -->
<!-- Coverage status: ${status} -->
`
}

export function crossCategoryDedup(
  clusters: FindingCluster[],
  threshold: number = CROSS_CATEGORY_THRESHOLD,
): { kept: FindingCluster[]; merged: number } {
  const ordered = [...clusters].sort((a, b) => a.id - b.id)
  const mergedIds = new Set<number>()
  let merged = 0
  for (let i = 0; i < ordered.length; i += 1) {
    const left = ordered[i]
    if (!left || mergedIds.has(left.id)) continue
    for (let j = i + 1; j < ordered.length; j += 1) {
      const right = ordered[j]
      if (!right || mergedIds.has(right.id)) continue
      if (left.category === right.category) continue
      if (scoreClusterPair(left, right) < threshold) continue
      const keepLeft = left.size > right.size || (left.size === right.size && left.id < right.id)
      mergedIds.add(keepLeft ? right.id : left.id)
      merged += 1
      if (!keepLeft) break
    }
  }
  return {
    kept: ordered.filter((cluster) => !mergedIds.has(cluster.id)),
    merged,
  }
}

export async function main(): Promise<void> {
  const startedAt = Date.now()
  const extractedFindings = await loadFindings(FINDINGS_FILE)
  if (!extractedFindings) return
  const findings = extractedFindings.map(toClusterFinding)
  const categoryCount = new Set(findings.map((finding) => finding.category)).size
  console.log(`Loaded ${findings.length} findings from ${categoryCount} categories`)

  const clustered = clusterFindings(findings, DEFAULT_CLUSTER_CONFIG)
  console.log(`Clustered into ${clustered.clusters.length} clusters + ${clustered.singletons.length} singletons`)
  const deduped = crossCategoryDedup(clustered.clusters)
  console.log(`Merged ${deduped.merged} cross-category duplicate clusters`)

  const existingSkills = await loadExistingSkills()
  const corpus = buildTfidfCorpus(existingSkills)
  const slugById = assignClusterSlugs(deduped.kept)
  const coverageRows: ClusterCoverage[] = []
  const covered: IngestReport["coverage"]["covered"] = []
  const maybeCovered: IngestReport["coverage"]["maybeCovered"] = []
  const discoveredNew: IngestReport["coverage"]["new"] = []
  for (const cluster of deduped.kept) {
    const slug = slugById.get(cluster.id) ?? `cluster-${cluster.id}`
    const candidate = normalizeSkill(renderCandidateSkill(cluster, slug, "new"))
    const similarityResult =
      candidate && existingSkills.length > 0 ? bestSimilarity(candidate, existingSkills, corpus) : { bestMatch: "", similarity: 0 }
    const status = classifyCoverage(similarityResult.similarity)
    const similarity = Number(similarityResult.similarity.toFixed(4))
    coverageRows.push({ cluster, slug, status })

    if (status === "covered") {
      covered.push({ clusterId: cluster.id, slug, bestMatch: similarityResult.bestMatch, similarity })
      continue
    }
    if (status === "maybe-covered") {
      maybeCovered.push({ clusterId: cluster.id, slug, bestMatch: similarityResult.bestMatch, similarity })
      continue
    }
    discoveredNew.push({ clusterId: cluster.id, slug, size: cluster.size, topTokens: cluster.topTokens.slice(0, 10) })
  }
  console.log(`Coverage: ${covered.length} covered, ${maybeCovered.length} maybe-covered, ${discoveredNew.length} new`)
  await Bun.$`mkdir -p ${OUTPUT_DIR} ${CANDIDATES_DIR}`.quiet()
  let candidatesGenerated = 0
  for (const row of coverageRows) {
    if (row.status === "covered") continue
    const candidateDir = `${CANDIDATES_DIR}/${row.slug}`
    await Bun.$`mkdir -p ${candidateDir}`.quiet()
    await Bun.write(`${candidateDir}/SKILL.md`, renderCandidateSkill(row.cluster, row.slug, row.status))
    candidatesGenerated += 1
  }
  const report: IngestReport = {
    timestamp: new Date().toISOString(),
    input: { findingsFile: FINDINGS_FILE, totalFindings: findings.length },
    clustering: {
      totalClusters: clustered.clusters.length,
      totalSingletons: clustered.singletons.length,
      mergedCrossCategory: deduped.merged,
    },
    coverage: { covered, maybeCovered, new: discoveredNew },
    candidatesGenerated,
    outputDir: OUTPUT_DIR,
  }
  await Bun.write(`${OUTPUT_DIR}/report.json`, JSON.stringify(report, null, 2))
  console.log(`Generated ${candidatesGenerated} candidate SKILL.md files`)
  console.log(`Wrote report to ${OUTPUT_DIR}/report.json`)
  console.log(`Completed audit ingest in ${Date.now() - startedAt}ms`)
}

if (import.meta.main) {
  await main()
}
