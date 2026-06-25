import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, extname, isAbsolute, resolve } from "node:path"
import { type ToolContext, tool } from "@opencode-ai/plugin"
import { loadArgusConfig } from "../config/loader"
import type { ArgusConfig } from "../config/types"
import {
  loadIndex,
  type ScvdIndex,
  type ScvdIndexEntry,
  searchIndex,
} from "../knowledge/scvd-index"
import { getScvdIndexPath } from "../shared/cache-paths"
import { createLogger } from "../shared/logger"
import { normalizeFilePath } from "../shared/path-utils"
import { resolveProjectDir } from "../shared/project-utils"
import { resolveArgusSkills } from "../skills/argus-skill-resolver"
import { extractDetectionRulesFromResolvedSkills } from "./pattern-loader"
import type { PatternDefinition } from "./pattern-schema"

const logger = createLogger()
const DEFAULT_MAX_MATCHES = 100
const DEFAULT_MAX_MATCHES_PER_SOURCE = 50
const DEFAULT_MAX_TEXT_LENGTH = 500

export type PatternSource = "skill"

export interface Match {
  pattern: string
  severity: "Critical" | "High" | "Medium" | "Low" | "Informational"
  file: string
  lines: [number, number]
  description: string
  exploitReference?: string
  patternSource?: PatternSource
  category?: string
}

export interface MatchSource {
  source: string
  matches: Match[]
}

export interface PatternCheckResult {
  success: boolean
  error?: string
  matches: Match[]
  summary: {
    total: number
    bySeverity: Record<string, number>
    byCategory: Record<string, number>
  }
  sources: MatchSource[]
  patternsChecked: number
  executionTime: number
  target: string
  patternVersion?: string
  compact?: boolean
  truncatedMatches?: number
  matchCountsByPattern?: Record<string, number>
}

type PatternCheckArgs = {
  target: string
  patterns?: string[]
  include_scvd?: boolean
  full_detail?: boolean
}

type PatternCheckDependencies = {
  loadConfig?: typeof loadArgusConfig
  resolveSkills?: typeof resolveArgusSkills
  loadIndexFn?: (filePath: string) => Promise<ScvdIndex | null>
  searchIndexFn?: (
    index: ScvdIndex,
    query: { swc?: string; severity?: string; keyword?: string; limit?: number },
  ) => ScvdIndexEntry[]
}

type ScvdPatternCheckDependencies = Required<
  Pick<PatternCheckDependencies, "loadIndexFn" | "searchIndexFn">
>

function loadConfigSafely(
  projectDir: string,
  loadConfig: typeof loadArgusConfig,
): ArgusConfig | undefined {
  try {
    return loadConfig(projectDir)
  } catch {
    return undefined
  }
}

export type LoadedPattern = {
  name: string
  category: string
  severity: Match["severity"]
  regex: RegExp
  description: string
  exploitReference?: string
  source?: PatternSource
  confidence?: "High" | "Medium" | "Low"
  applies_to?: string[]
  exclude_if?: string[]
}

export const PATTERN_PACK_VERSION = "1.0.0"

const CATEGORY_TO_SWC: Record<string, string[]> = {
  reentrancy: ["SWC-107"],
  "access-control": ["SWC-105", "SWC-106"],
  "oracle-manipulation": ["SWC-116"],
  delegatecall: ["SWC-112"],
  "signature-replay": ["SWC-121"],
  "integer-overflow": ["SWC-101"],
  governance: ["SWC-105", "SWC-106"],
  "front-running": ["SWC-114"],
  "logic-error": ["SWC-101", "SWC-116"],
  "gas-optimization": ["SWC-128"],
  dos: ["SWC-128"],
}

function normalizeSeverity(value: string): Match["severity"] {
  if (value === "Critical") return "Critical"
  if (value === "High") return "High"
  if (value === "Medium") return "Medium"
  if (value === "Low") return "Low"
  return "Informational"
}

function normalizePatternDefinitions(
  patterns: PatternDefinition[],
  source: PatternSource,
): LoadedPattern[] {
  return patterns.map((patternDef) => ({
    name: patternDef.name,
    category: patternDef.category,
    severity: patternDef.severity,
    regex: new RegExp(patternDef.regex),
    description: patternDef.description,
    ...(patternDef.exploit_ref ? { exploitReference: patternDef.exploit_ref } : {}),
    ...(patternDef.confidence ? { confidence: patternDef.confidence } : {}),
    ...(patternDef.applies_to ? { applies_to: patternDef.applies_to } : {}),
    ...(patternDef.exclude_if ? { exclude_if: patternDef.exclude_if } : {}),
    source,
  }))
}

function uniqueScvdEntries(entries: ScvdIndexEntry[]): ScvdIndexEntry[] {
  const deduped = new Map<string, ScvdIndexEntry>()
  for (const entry of entries) {
    deduped.set(entry.id, entry)
  }
  return Array.from(deduped.values())
}

async function collectScvdMatches(
  matches: Match[],
  dependencies: ScvdPatternCheckDependencies,
): Promise<Match[]> {
  const detectedCategories = new Set<string>()
  for (const match of matches) {
    const category = match.category
    if (category) {
      detectedCategories.add(category)
    }
  }

  if (detectedCategories.size === 0) {
    return []
  }

  const swcCodes = new Set<string>()
  for (const category of detectedCategories) {
    const mappedSwcs = CATEGORY_TO_SWC[category] ?? []
    for (const swcCode of mappedSwcs) {
      swcCodes.add(swcCode)
    }
  }

  if (swcCodes.size === 0) {
    return []
  }

  const indexPath = getScvdIndexPath()
  const index = await dependencies.loadIndexFn(indexPath)

  if (!index) {
    return []
  }

  const entries: ScvdIndexEntry[] = []
  for (const swcCode of swcCodes) {
    entries.push(...dependencies.searchIndexFn(index, { swc: swcCode }))
  }

  return uniqueScvdEntries(entries).map((entry) => ({
    pattern: entry.id,
    severity: normalizeSeverity(entry.severity),
    file: entry.repoUrl,
    lines: [1, 1],
    description: entry.title,
    exploitReference: entry.repoUrl,
  }))
}

function collectSolidityFiles(target: string, maxDepth = 8): string[] {
  const absoluteTarget = resolve(target)
  let stats: ReturnType<typeof statSync>

  try {
    stats = statSync(absoluteTarget)
  } catch {
    return []
  }

  if (stats.isFile()) {
    return extname(absoluteTarget) === ".sol" ? [absoluteTarget] : []
  }

  if (!stats.isDirectory()) {
    return []
  }

  const discovered: string[] = []
  const stack: Array<{ path: string; depth: number }> = [{ path: absoluteTarget, depth: 0 }]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || current.depth > maxDepth) {
      continue
    }

    const entries = readdirSync(current.path, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = resolve(current.path, entry.name)
      if (entry.isDirectory()) {
        stack.push({ path: fullPath, depth: current.depth + 1 })
        continue
      }

      if (entry.isFile() && extname(entry.name) === ".sol") {
        discovered.push(fullPath)
      }
    }
  }

  return discovered
}

function lineNumberAt(content: string, index: number): number {
  if (index <= 0) {
    return 1
  }

  let line = 1
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content[i] === "\n") {
      line += 1
    }
  }
  return line
}

function lineWindow(content: string, index: number): [number, number] {
  const linesCount = content.split("\n").length
  const line = lineNumberAt(content, index)
  const start = Math.max(1, line - 5)
  const end = Math.min(linesCount, line + 5)
  return [start, end]
}

function isExcludedMatch(content: string, index: number, pattern: LoadedPattern): boolean {
  if (!pattern.exclude_if || pattern.exclude_if.length === 0) return false

  const window = content.slice(Math.max(0, index - 400), index + 400)
  return pattern.exclude_if.some((exclude) => new RegExp(exclude).test(window))
}

export function findMatches(file: string, patterns: LoadedPattern[], projectDir?: string): Match[] {
  const content = readFileSync(file, "utf8")
  const normalizedFile = projectDir ? normalizeFilePath(file, projectDir) : file
  const matches: Match[] = []

  // Strip comments and string literals to reduce false positives.
  // Single-pass approach: match whichever construct appears first so that
  // a "//" inside a string (e.g. URLs) is NOT treated as a comment.
  const stripped = content.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,
    (m) => {
      if (m.startsWith("/*")) return m.replace(/[^\n]/g, " ")
      if (m.startsWith("//")) return " ".repeat(m.length)
      // String literal — preserve quotes, blank interior
      const quote = m[0]
      return `${quote}${" ".repeat(Math.max(0, m.length - 2))}${quote}`
    },
  )

  for (const pattern of patterns) {
    const regex = new RegExp(
      pattern.regex.source,
      pattern.regex.flags.includes("g") ? pattern.regex.flags : `${pattern.regex.flags}g`,
    )
    for (const found of stripped.matchAll(regex)) {
      const index = found.index ?? 0
      if (isExcludedMatch(stripped, index, pattern)) continue
      matches.push({
        pattern: pattern.name,
        severity: pattern.severity,
        file: normalizedFile,
        lines: lineWindow(content, index),
        description: pattern.description,
        exploitReference: pattern.exploitReference,
        patternSource: pattern.source ?? "skill",
        category: pattern.category,
      })
    }
  }

  return matches
}

function selectPatterns(
  availablePatterns: LoadedPattern[],
  categories?: string[],
): LoadedPattern[] {
  if (!categories || categories.length === 0) {
    return availablePatterns
  }

  const set = new Set(categories)
  return availablePatterns.filter((pattern) => set.has(pattern.category))
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined || value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}…`
}

function compactMatch(match: Match): Match {
  return {
    ...match,
    description: truncateText(match.description, DEFAULT_MAX_TEXT_LENGTH) ?? "",
    ...(match.exploitReference
      ? { exploitReference: truncateText(match.exploitReference, DEFAULT_MAX_TEXT_LENGTH) }
      : {}),
  }
}

function countByPattern(matches: Match[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const match of matches) {
    counts[match.pattern] = (counts[match.pattern] ?? 0) + 1
  }
  return counts
}

function compactSources(sources: MatchSource[]): {
  sources: MatchSource[]
  matches: Match[]
  truncatedMatches: number
} {
  let remaining = DEFAULT_MAX_MATCHES
  let truncatedMatches = 0
  const compactedSources: MatchSource[] = []

  for (const source of sources) {
    const sourceLimit = Math.min(DEFAULT_MAX_MATCHES_PER_SOURCE, Math.max(0, remaining))
    const kept = source.matches.slice(0, sourceLimit).map(compactMatch)
    truncatedMatches += Math.max(0, source.matches.length - kept.length)
    remaining -= kept.length
    compactedSources.push({ ...source, matches: kept })
  }

  const matches = compactedSources.flatMap((source) => source.matches)
  return { sources: compactedSources, matches, truncatedMatches }
}

export async function executePatternCheck(
  args: PatternCheckArgs,
  context: ToolContext,
  deps: PatternCheckDependencies = {},
): Promise<PatternCheckResult> {
  const scvdDependencies: ScvdPatternCheckDependencies = {
    loadIndexFn: loadIndex,
    searchIndexFn: searchIndex,
    ...(deps.loadIndexFn ? { loadIndexFn: deps.loadIndexFn } : {}),
    ...(deps.searchIndexFn ? { searchIndexFn: deps.searchIndexFn } : {}),
  }

  const startedAt = Date.now()
  context.metadata({ title: `Pattern check: ${args.target}` })

  const baseProjectDir = resolveProjectDir(context)
  const loadConfig = deps.loadConfig ?? loadArgusConfig
  const resolveSkills = deps.resolveSkills ?? resolveArgusSkills
  const config = loadConfigSafely(baseProjectDir, loadConfig)
  const skills = resolveSkills(baseProjectDir, config)
  const { patterns: skillDetectionRules, errors: loaderErrors } =
    extractDetectionRulesFromResolvedSkills(skills.values())
  if (loaderErrors.length > 0) {
    for (const err of loaderErrors) {
      logger.warn(`Pattern loader: ${err}`)
    }
  }

  const allPatterns: LoadedPattern[] = [
    ...normalizePatternDefinitions(skillDetectionRules, "skill"),
  ]

  const selectedPatterns = selectPatterns(allPatterns, args.patterns)
  const resolvedTarget = isAbsolute(args.target)
    ? args.target
    : resolve(baseProjectDir, args.target)
  const solidityFiles = collectSolidityFiles(resolvedTarget)
  if (solidityFiles.length === 0) {
    return {
      success: false,
      error: `No Solidity files found for target: ${args.target}`,
      matches: [],
      summary: { total: 0, bySeverity: {}, byCategory: {} },
      sources: [],
      patternsChecked: selectedPatterns.length,
      executionTime: Date.now() - startedAt,
      target: args.target,
      patternVersion: PATTERN_PACK_VERSION,
    }
  }

  const absoluteTarget = resolvedTarget
  let targetStat: ReturnType<typeof statSync> | undefined
  try {
    targetStat = statSync(absoluteTarget)
  } catch {}
  const normalizedProjectDir = targetStat?.isFile() ? dirname(absoluteTarget) : absoluteTarget
  const sourceMatches: Match[] = []
  for (const solidityFile of solidityFiles) {
    if (context.abort.aborted) {
      throw new Error("pattern check aborted")
    }
    sourceMatches.push(...findMatches(solidityFile, selectedPatterns, normalizedProjectDir))
  }

  const sources: MatchSource[] = [
    {
      source: "pattern-db",
      matches: sourceMatches,
    },
  ]

  if (args.include_scvd === true) {
    try {
      const scvdMatches = await collectScvdMatches(sourceMatches, scvdDependencies)
      if (scvdMatches.length > 0) {
        sources.push({
          source: "scvd",
          matches: scvdMatches,
        })
      }
    } catch (_e) {
      logger.debug("SCVD enrichment failed, continuing without SCVD matches")
    }
  }

  const allMatches = sources.flatMap((s) => s.matches)
  const matchCountsByPattern = countByPattern(allMatches)
  const bySeverity: Record<string, number> = {}
  const byCategory: Record<string, number> = {}
  for (const m of allMatches) {
    bySeverity[m.severity] = (bySeverity[m.severity] ?? 0) + 1
    if (m.category) {
      byCategory[m.category] = (byCategory[m.category] ?? 0) + 1
    }
  }

  const compacted = args.full_detail === true ? null : compactSources(sources)

  return {
    success: true,
    matches: compacted?.matches ?? allMatches,
    summary: { total: allMatches.length, bySeverity, byCategory },
    sources: compacted?.sources ?? sources,
    patternsChecked: selectedPatterns.length,
    executionTime: Date.now() - startedAt,
    target: args.target,
    patternVersion: PATTERN_PACK_VERSION,
    compact: args.full_detail !== true,
    truncatedMatches: compacted?.truncatedMatches ?? 0,
    matchCountsByPattern,
  }
}

export const patternCheckerTool = tool({
  description: "Check Solidity files against deterministic vulnerability regex patterns.",
  args: {
    target: tool.schema.string(),
    patterns: tool.schema.array(tool.schema.string()).optional(),
    include_scvd: tool.schema.boolean().default(true),
    full_detail: tool.schema.boolean().default(false),
  },
  async execute(args, context) {
    const result = await executePatternCheck(args, context)
    return JSON.stringify(result)
  },
})
