import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { CliCommand } from "../types"
import { resolveSkillRoots } from "../../skills/argus-skill-resolver"
import { loadArgusConfig } from "../../config/loader"
import { cliOutput } from "../cli-output"
import { normalizeSkill, type SkillDoc } from "../../skills/analysis/normalize"
import { buildTfidfCorpus, computeAllPairs } from "../../skills/analysis/similarity"
import {
  generateReport,
  formatReportText,
  formatReportJson,
  DEFAULT_GATE_CONFIG,
  type GateConfig,
  type SkillReport,
} from "../../skills/analysis/gates"

function findSkillFiles(dir: string, maxDepth = 8): string[] {
  const files: string[] = []
  const stack: Array<{ path: string; depth: number }> = [{ path: dir, depth: 0 }]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || current.depth > maxDepth) continue

    try {
      const entries = readdirSync(current.path, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(current.path, entry.name)
        if (entry.isDirectory()) {
          stack.push({ path: fullPath, depth: current.depth + 1 })
        } else if (entry.isFile() && entry.name.toUpperCase() === "SKILL.MD") {
          files.push(fullPath)
        }
      }
    } catch {
      continue
    }
  }

  return files
}

function parseFormatArg(args: string[]): "text" | "json" {
  const formatIdx = args.indexOf("--format")
  if (formatIdx !== -1 && args[formatIdx + 1] === "json") {
    return "json"
  }
  return "text"
}

function parseThresholdArg(args: string[], flag: string, fallback: number): number {
  const idx = args.indexOf(flag)
  if (idx === -1) return fallback
  const raw = args[idx + 1]
  if (!raw) return fallback
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback
}

export function loadAndNormalizeSkills(cwd: string): SkillDoc[] {
  let config: ReturnType<typeof loadArgusConfig> | undefined
  try {
    config = loadArgusConfig(cwd)
  } catch {
    // fallback to undefined
  }

  const roots = resolveSkillRoots(cwd, config)
  const docs: SkillDoc[] = []

  for (const root of roots) {
    const files = findSkillFiles(root.path)
    for (const file of files) {
      try {
        const content = readFileSync(file, "utf8")
        const doc = normalizeSkill(content)
        if (doc) {
          docs.push(doc)
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  return docs
}

export function runAnalysis(docs: SkillDoc[], config: GateConfig): SkillReport {
  const corpus = buildTfidfCorpus(docs)
  const pairs = computeAllPairs(docs, corpus)
  return generateReport(docs, pairs, config)
}

export const checkSkillsCommand: CliCommand = {
  name: "check-skills",
  description: "Analyze SKILL.md files for duplicates, near-duplicates, and detection rule conflicts",
  async execute(args: string[]): Promise<number> {
    const cwd = process.cwd()
    const format = parseFormatArg(args)

    const gateConfig: GateConfig = {
      blockThreshold: parseThresholdArg(args, "--block-threshold", DEFAULT_GATE_CONFIG.blockThreshold),
      warnThreshold: parseThresholdArg(args, "--warn-threshold", DEFAULT_GATE_CONFIG.warnThreshold),
      infoThreshold: parseThresholdArg(args, "--info-threshold", DEFAULT_GATE_CONFIG.infoThreshold),
      blockExactRegexConflict: !args.includes("--no-regex-conflict"),
    }

    const docs = loadAndNormalizeSkills(cwd)

    if (docs.length === 0) {
      cliOutput.log("No SKILL.md files found.")
      return 0
    }

    cliOutput.log(`Analyzing ${docs.length} skills...`)

    const report = runAnalysis(docs, gateConfig)

    if (format === "json") {
      cliOutput.log(formatReportJson(report))
    } else {
      cliOutput.log(formatReportText(report))
    }

    return report.summary.block > 0 ? 1 : 0
  },
}
