import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, dirname, extname, join } from "node:path"
import { loadArgusConfig } from "../../config/loader"
import type { ArgusConfig } from "../../config/types"
import { createLogger } from "../../shared/logger"
import {
  getRequiredAuditSkills,
  normalizeSkillName,
  type ResolvedSkill,
  resolveArgusSkills,
  resolveSkillRoots,
} from "../../skills/argus-skill-resolver"
import { parseFrontmatter, validateSkillFrontmatter } from "../../skills/skill-schema"
import { detectViaIr } from "../../tools/slither-tool"
import { cliOutput } from "../cli-output"
import type { CliCommand } from "../types"

const logger = createLogger()

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const RESET = "\x1b[0m"

function checkBinary(name: string): { found: boolean; version: string | null } {
  try {
    const result = Bun.spawnSync([name, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
    })
    if (result.exitCode !== 0) {
      return { found: false, version: null }
    }
    const version = new TextDecoder().decode(result.stdout).trim().split("\n")[0] ?? null
    return { found: true, version }
  } catch {
    return { found: false, version: null }
  }
}

function checkSolidityProject(dir: string): string | null {
  if (existsSync(join(dir, "foundry.toml"))) return "foundry"
  if (existsSync(join(dir, "hardhat.config.js"))) return "hardhat"
  if (existsSync(join(dir, "hardhat.config.ts"))) return "hardhat"
  return null
}

export const ALL_CATEGORIES = [
  "vulnerability-pattern",
  "methodology",
  "protocol-pattern",
  "checklist",
  "reference",
] as const

export const REQUIRED_CATEGORIES: readonly string[] = ["vulnerability-pattern", "methodology"]

export type SkillHealthReport = {
  categoryBreakdown: Record<string, number>
  trustTierBreakdown: Record<string, number>
  duplicates: Array<{ name: string; sources: string[] }>
  schemaValid: number
  schemaInvalid: number
  schemaSkipped: number
  invalidSkills: Array<{ name: string; error: string }>
  missingCategories: string[]
}

export function findDuplicateSkills(
  entries: Array<{ name: string; source: string }>,
): Array<{ name: string; sources: string[] }> {
  const nameToSources = new Map<string, Set<string>>()
  for (const { name, source } of entries) {
    if (!nameToSources.has(name)) nameToSources.set(name, new Set())
    const sources = nameToSources.get(name)
    if (sources) sources.add(source)
  }
  return Array.from(nameToSources)
    .filter(([, sources]) => sources.size > 1)
    .map(([name, sources]) => ({ name, sources: Array.from(sources) }))
}

export function buildSkillHealthReport(
  resolvedSkills: Map<string, ResolvedSkill>,
  duplicateEntries?: Array<{ name: string; source: string }>,
): SkillHealthReport {
  const categoryBreakdown: Record<string, number> = {}
  for (const cat of ALL_CATEGORIES) categoryBreakdown[cat] = 0

  const trustTierBreakdown: Record<string, number> = {}
  let schemaValid = 0
  let schemaInvalid = 0
  let schemaSkipped = 0
  const invalidSkills: Array<{ name: string; error: string }> = []

  for (const [name, skill] of resolvedSkills) {
    trustTierBreakdown[skill.source] = (trustTierBreakdown[skill.source] ?? 0) + 1

    const fm = parseFrontmatter(skill.content)
    if (fm) {
      const validation = validateSkillFrontmatter(fm)
      if (validation.success) {
        schemaValid++
        if (validation.data.category) {
          categoryBreakdown[validation.data.category] =
            (categoryBreakdown[validation.data.category] ?? 0) + 1
        }
      } else {
        schemaInvalid++
        invalidSkills.push({ name, error: validation.errors[0] ?? "unknown error" })
      }
    } else {
      schemaSkipped++
    }
  }

  const duplicates = duplicateEntries ? findDuplicateSkills(duplicateEntries) : []
  const missingCategories = REQUIRED_CATEGORIES.filter((cat) => (categoryBreakdown[cat] ?? 0) === 0)

  return {
    categoryBreakdown,
    trustTierBreakdown,
    duplicates,
    schemaValid,
    schemaInvalid,
    schemaSkipped,
    invalidSkills,
    missingCategories,
  }
}

function scanMarkdownFiles(dir: string, maxDepth = 8): string[] {
  if (!existsSync(dir)) return []
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
        } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
          files.push(fullPath)
        }
      }
    } catch {
      logger.debug("Failed to read directory during skill scan")
    }
  }
  return files
}

function inferSkillName(filePath: string): string {
  if (basename(filePath) === "SKILL.md") {
    return basename(dirname(filePath))
  }
  return basename(filePath, extname(filePath))
}

function collectAllSkillNames(
  projectDir: string,
  argusConfig?: ArgusConfig,
): Array<{ name: string; source: string }> {
  const roots = resolveSkillRoots(projectDir, argusConfig)
  const entries: Array<{ name: string; source: string }> = []
  for (const root of roots) {
    const files = scanMarkdownFiles(root.path)
    for (const file of files) {
      try {
        const content = readFileSync(file, "utf8")
        const fm = parseFrontmatter(content)
        const nameFromFm = typeof fm?.name === "string" ? fm.name : null
        const rawName = nameFromFm || inferSkillName(file)
        const name = normalizeSkillName(rawName)
        if (name) entries.push({ name, source: root.source })
      } catch {
        logger.debug("Failed to parse skill file frontmatter")
      }
    }
  }
  return entries
}

export const doctorCommand: CliCommand = {
  name: "doctor",
  description: "Check tool dependencies and configuration",
  async execute(_args: string[]): Promise<number> {
    const cwd = process.cwd()
    let hasFailure = false

    cliOutput.log("Argus Doctor\n")

    const slither = checkBinary("slither")
    if (slither.found) {
      cliOutput.log(`${GREEN}✓${RESET} Slither: installed (${slither.version})`)
    } else {
      cliOutput.log(`${RED}✗${RESET} Slither: not found — pip install slither-analyzer`)
      hasFailure = true
    }

    const forge = checkBinary("forge")
    if (forge.found) {
      cliOutput.log(`${GREEN}✓${RESET} Forge: installed (${forge.version})`)
    } else {
      cliOutput.log(
        `${RED}✗${RESET} Forge: not found — curl -L https://foundry.paradigm.xyz | bash`,
      )
      hasFailure = true
    }

    const solcSelect = checkBinary("solc-select")
    if (solcSelect.found) {
      cliOutput.log(`${GREEN}✓${RESET} solc-select: installed (${solcSelect.version})`)
    } else {
      cliOutput.log(
        `${YELLOW}⚠${RESET} solc-select: not found — pipx install solc-select (needed for via_ir flatten fallback)`,
      )
    }

    const projectType = checkSolidityProject(cwd)
    if (projectType) {
      cliOutput.log(`${GREEN}✓${RESET} Project: ${projectType} detected`)
    } else {
      cliOutput.log(`${YELLOW}⚠${RESET} Project: no Solidity project detected`)
    }

    if (projectType === "foundry" && detectViaIr(cwd)) {
      cliOutput.log(
        `${YELLOW}⚠${RESET} via_ir: enabled in foundry.toml — Slither will use flatten fallback`,
      )
      if (!forge.found) {
        cliOutput.log(
          `${RED}✗${RESET}   forge is required for via_ir flatten fallback but is missing`,
        )
        hasFailure = true
      }
      if (!solcSelect.found) {
        cliOutput.log(`${YELLOW}⚠${RESET}   solc-select is recommended for via_ir flatten fallback`)
      }
    }

    let config: ReturnType<typeof loadArgusConfig> | undefined
    try {
      config = loadArgusConfig(cwd)
      cliOutput.log(`${GREEN}✓${RESET} Config: valid`)

      const requiredSkills = getRequiredAuditSkills()
      const resolvedSkills = resolveArgusSkills(cwd, config)
      const missingSkills = requiredSkills.filter((skillName) => !resolvedSkills.has(skillName))

      if (missingSkills.length === 0) {
        cliOutput.log(
          `${GREEN}✓${RESET} Skills: required audit skills resolvable (${requiredSkills.join(", ")})`,
        )
      } else {
        cliOutput.log(
          `${RED}✗${RESET} Skills: missing required skills (${missingSkills.join(", ")})`,
        )
        hasFailure = true
      }
    } catch {
      cliOutput.log(`${YELLOW}⚠${RESET} Config: using defaults`)

      const requiredSkills = getRequiredAuditSkills()
      const resolvedSkills = resolveArgusSkills(cwd)
      const missingSkills = requiredSkills.filter((skillName) => !resolvedSkills.has(skillName))

      if (missingSkills.length === 0) {
        cliOutput.log(
          `${GREEN}✓${RESET} Skills: required audit skills resolvable (${requiredSkills.join(", ")})`,
        )
      } else {
        cliOutput.log(
          `${RED}✗${RESET} Skills: missing required skills (${missingSkills.join(", ")})`,
        )
        hasFailure = true
      }
    }

    try {
      const response = await fetch("https://api.scvd.dev/stats", {
        signal: AbortSignal.timeout(5000),
      })
      if (response.ok) {
        cliOutput.log(`${GREEN}✓${RESET} SCVD API: reachable`)
      } else {
        cliOutput.log(`${YELLOW}⚠${RESET} SCVD API: returned ${response.status}`)
      }
    } catch {
      cliOutput.log(`${YELLOW}⚠${RESET} SCVD API: unreachable`)
    }

    const soloditEnabled = config?.solodit?.enabled !== false
    if (soloditEnabled) {
      try {
        const response = await fetch(
          "https://solodit.cyfrin.io/api/trpc/findings.get?batch=1&input=" +
            encodeURIComponent(JSON.stringify({ 0: "[]" })),
          {
            signal: AbortSignal.timeout(5000),
          },
        )
        if (response.ok) {
          cliOutput.log(`${GREEN}✓${RESET} Solodit API: reachable`)
        } else {
          cliOutput.log(`${YELLOW}⚠${RESET} Solodit API: returned ${response.status}`)
        }
      } catch {
        cliOutput.log(`${YELLOW}⚠${RESET} Solodit API: unreachable`)
      }
    } else {
      cliOutput.log(`${YELLOW}⚠${RESET} Solodit: disabled in config`)
    }

    cliOutput.log("\nSkill Health")
    try {
      const healthSkills = resolveArgusSkills(cwd, config)
      const allEntries = collectAllSkillNames(cwd, config)
      const report = buildSkillHealthReport(healthSkills, allEntries)

      const catParts = ALL_CATEGORIES.map((cat) => `${cat}: ${report.categoryBreakdown[cat] ?? 0}`)
      cliOutput.log(`${GREEN}✓${RESET} Categories: ${catParts.join(", ")}`)

      const tierParts = Object.entries(report.trustTierBreakdown).map(
        ([tier, count]) => `${tier}: ${count}`,
      )
      cliOutput.log(`${GREEN}✓${RESET} Trust tiers: ${tierParts.join(", ")}`)

      if (report.schemaInvalid === 0) {
        cliOutput.log(
          `${GREEN}✓${RESET} Schema: ${report.schemaValid} valid, 0 invalid, ${report.schemaSkipped} skipped (no frontmatter)`,
        )
      } else {
        cliOutput.log(
          `${YELLOW}⚠${RESET} Schema: ${report.schemaValid} valid, ${report.schemaInvalid} invalid, ${report.schemaSkipped} skipped (no frontmatter)`,
        )
        for (const inv of report.invalidSkills) {
          cliOutput.log(`  ${RED}✗${RESET} ${inv.name}: ${inv.error}`)
        }
      }

      if (report.duplicates.length > 0) {
        for (const dup of report.duplicates) {
          cliOutput.log(
            `${YELLOW}⚠${RESET} Duplicate skill: "${dup.name}" found in ${dup.sources.join(" and ")}`,
          )
        }
      } else {
        cliOutput.log(`${GREEN}✓${RESET} No duplicate skills detected`)
      }

      for (const cat of report.missingCategories) {
        cliOutput.log(`${YELLOW}⚠${RESET} Required category "${cat}" has 0 skills`)
      }
    } catch {
      cliOutput.log(`${RED}✗${RESET} Could not analyze skill health`)
      hasFailure = true
    }

    return hasFailure ? 1 : 0
  },
}
