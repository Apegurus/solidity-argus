import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, extname, join, resolve } from "node:path"
import type { ArgusConfig } from "../config/types"
import { getTrailOfBitsCacheDir } from "../shared/cache-paths"
import { createLogger } from "../shared/logger"
import { parseFrontmatter, type SkillFrontmatter, validateSkillFrontmatter } from "./skill-schema"

export type ResolvedSkill = {
  name: string
  description: string
  filePath: string
  source: "bundled" | "custom" | "trailofbits" | "opencode" | "claude"
  content: string
  category?: SkillFrontmatter["category"]
  pattern_category?: SkillFrontmatter["pattern_category"]
  detection_rules?: SkillFrontmatter["detection_rules"]
  source_url?: string
  source_license?: string
  imported_at?: string
  source_hash?: string
}

const OMO_PROJECT_SKILLS_DIR = [".opencode", "skills"]
const OMO_GLOBAL_SKILLS_DIR = [".config", "opencode", "skills"]
const CLAUDE_PROJECT_SKILLS_DIR = [".claude", "skills"]
const CLAUDE_GLOBAL_SKILLS_DIR = [".claude", "skills"]
const SKILL_NAME_ALIASES: Record<string, string> = {
  "vulnerability-patterns/reentrancy": "reentrancy",
  "vulnerability-patterns/oracle-manipulation": "oracle-manipulation",
  "vulnerability-patterns/access-control": "access-control",
  "protocol-patterns/amm-dex": "amm-dex",
  "protocol-patterns/lending-borrowing": "lending-borrowing",
  "checklists/cyfrin-best-practices-upgrades": "cyfrin-best-practices-upgrades",
  "references/exploit-reference": "exploit-reference",
  "building-secure-contracts/token-integration-analyzer": "token-integration-analyzer",
}

function inferSkillNameFromPath(filePath: string): string {
  if (basename(filePath) === "SKILL.md") {
    return basename(resolve(filePath, ".."))
  }
  return basename(filePath, extname(filePath))
}

/** Filenames that are never skills — exclude from resolution and health checks. */
const NON_SKILL_FILENAMES = new Set(["README.md", "INVENTORY.md", "CHANGELOG.md", "LICENSE.md"])

function collectMarkdownFiles(root: string, maxDepth = 8): string[] {
  if (!existsSync(root)) return []

  const files: string[] = []
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    const { dir, depth } = current

    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < maxDepth) stack.push({ dir: fullPath, depth: depth + 1 })
        continue
      }

      if (!entry.isFile()) continue
      if (extname(entry.name).toLowerCase() !== ".md") continue
      if (NON_SKILL_FILENAMES.has(entry.name)) continue
      files.push(fullPath)
    }
  }

  return files
}

function getTrailOfBitsRoots(): string[] {
  const pluginsDir = join(getTrailOfBitsCacheDir(), "plugins")
  if (!existsSync(pluginsDir)) return []

  let entries: Dirent[]
  try {
    entries = readdirSync(pluginsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const roots: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillsDir = join(pluginsDir, entry.name, "skills")
    if (existsSync(skillsDir)) roots.push(skillsDir)
  }
  return roots
}

export function normalizeSkillName(input: string): string {
  const trimmed = input.trim()
  const alias = SKILL_NAME_ALIASES[trimmed]
  if (alias) return alias
  if (trimmed.includes("/")) {
    const last = trimmed.split("/").at(-1)
    if (last) return last
  }
  return trimmed
}

type SkillRoot = {
  path: string
  source: ResolvedSkill["source"]
}

function resolveCustomSkillsRoot(projectDir: string, argusConfig?: ArgusConfig): string | null {
  const customSkillsDir = argusConfig?.knowledge?.customSkillsDir
  if (!customSkillsDir) return null
  const resolvedCustom = customSkillsDir.startsWith("/")
    ? customSkillsDir
    : resolve(projectDir, customSkillsDir)
  return existsSync(resolvedCustom) ? resolvedCustom : null
}

export function resolveSkillRoots(projectDir: string, argusConfig?: ArgusConfig): SkillRoot[] {
  const precedence = argusConfig?.knowledge?.skillPrecedence ?? "bundled-first"

  const bundledRoot: SkillRoot = {
    path: resolve(import.meta.dir, "../../skills"),
    source: "bundled",
  }
  const customRoot = resolveCustomSkillsRoot(projectDir, argusConfig)
  const customSkillRoot: SkillRoot | null = customRoot
    ? { path: customRoot, source: "custom" }
    : null

  const roots: SkillRoot[] = []

  if (precedence === "custom-first") {
    if (customSkillRoot) roots.push(customSkillRoot)
    roots.push(bundledRoot)
  } else {
    roots.push(bundledRoot)
    if (customSkillRoot) roots.push(customSkillRoot)
  }

  for (const tobRoot of getTrailOfBitsRoots()) {
    roots.push({ path: tobRoot, source: "trailofbits" })
  }

  roots.push({ path: join(projectDir, ...OMO_PROJECT_SKILLS_DIR), source: "opencode" })
  roots.push({ path: join(homedir(), ...OMO_GLOBAL_SKILLS_DIR), source: "opencode" })
  roots.push({ path: join(projectDir, ...CLAUDE_PROJECT_SKILLS_DIR), source: "claude" })
  roots.push({ path: join(homedir(), ...CLAUDE_GLOBAL_SKILLS_DIR), source: "claude" })

  const seen = new Set<string>()
  return roots.filter((root) => {
    if (!existsSync(root.path)) return false
    if (seen.has(root.path)) return false
    seen.add(root.path)
    return true
  })
}

export function discoverArgusSkills(
  projectDir: string,
  argusConfig?: ArgusConfig,
): ResolvedSkill[] {
  const discovered: ResolvedSkill[] = []
  const roots = resolveSkillRoots(projectDir, argusConfig)
  const logger = createLogger()

  for (const root of roots) {
    const markdownFiles = collectMarkdownFiles(root.path).sort((a, b) => a.localeCompare(b))
    for (const markdownFile of markdownFiles) {
      let content: string
      try {
        content = readFileSync(markdownFile, "utf8")
      } catch {
        continue
      }

      const frontmatter = parseFrontmatter(content)
      if (!frontmatter && basename(markdownFile) !== "SKILL.md") continue

      let validatedFrontmatter: SkillFrontmatter | null = null
      if (frontmatter) {
        const validation = validateSkillFrontmatter(frontmatter)
        if (!validation.success) {
          logger.warn(
            `Skipping skill with invalid frontmatter: ${markdownFile} — ${validation.errors.join(", ")}`,
          )
          continue
        }
        validatedFrontmatter = validation.data
      }

      const rawName = validatedFrontmatter?.name ?? inferSkillNameFromPath(markdownFile)
      const normalizedName = normalizeSkillName(rawName)
      if (!normalizedName) continue

      const skill: ResolvedSkill = {
        name: normalizedName,
        description: validatedFrontmatter?.description ?? "",
        filePath: markdownFile,
        source: root.source,
        content,
      }

      if (frontmatter) {
        if (validatedFrontmatter?.category) skill.category = validatedFrontmatter.category
        if (validatedFrontmatter?.pattern_category)
          skill.pattern_category = validatedFrontmatter.pattern_category
        if (
          validatedFrontmatter?.detection_rules &&
          validatedFrontmatter.detection_rules.length > 0
        ) {
          skill.detection_rules = validatedFrontmatter.detection_rules
        }
        if (validatedFrontmatter?.source_url) skill.source_url = validatedFrontmatter.source_url
        if (validatedFrontmatter?.source_license)
          skill.source_license = validatedFrontmatter.source_license
        if (validatedFrontmatter?.imported_at) skill.imported_at = validatedFrontmatter.imported_at
        if (validatedFrontmatter?.source_hash) skill.source_hash = validatedFrontmatter.source_hash
      }

      discovered.push(skill)
    }
  }

  return discovered
}

export function resolveArgusSkills(
  projectDir: string,
  argusConfig?: ArgusConfig,
): Map<string, ResolvedSkill> {
  const resolved = new Map<string, ResolvedSkill>()
  for (const skill of discoverArgusSkills(projectDir, argusConfig)) {
    if (!resolved.has(skill.name)) resolved.set(skill.name, skill)
  }
  return resolved
}

export function getRequiredAuditSkills(): string[] {
  // Intentionally universal-only: protocol-specific skills (amm-dex,
  // oracle-manipulation, …) are surfaced per-target by argus_recommend_skills,
  // not forced here, so the baseline never skews every audit toward an AMM/DeFi shape.
  return ["reentrancy", "access-control"]
}
