import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, extname, join, resolve } from "node:path"
import type { ArgusConfig } from "../config/types"
import { getTrailOfBitsCacheDir } from "../shared/cache-paths"
import { createLogger } from "../shared/logger"
import { parseFrontmatter, validateSkillFrontmatter } from "./skill-schema"

export type ResolvedSkill = {
  name: string
  description: string
  filePath: string
  source: "bundled" | "custom" | "trailofbits" | "opencode" | "claude"
  content: string
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

function parseSkillNameFromFrontmatter(content: string): string | null {
  const match = content.match(/^name:\s*(.+)$/m)
  if (!match) return null
  return match[1]?.trim().replace(/^"|"$/g, "") ?? null
}

function parseSkillDescriptionFromFrontmatter(content: string): string {
  const match = content.match(/^description:\s*(.+)$/m)
  if (!match) return ""
  const raw = match[1]?.trim() ?? ""
  if (raw === ">" || raw === ">-") return ""
  return raw.replace(/^"|"$/g, "")
}

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

export function resolveArgusSkills(
  projectDir: string,
  argusConfig?: ArgusConfig,
): Map<string, ResolvedSkill> {
  const resolved = new Map<string, ResolvedSkill>()
  const roots = resolveSkillRoots(projectDir, argusConfig)
  const logger = createLogger()

  for (const root of roots) {
    const markdownFiles = collectMarkdownFiles(root.path)
    for (const markdownFile of markdownFiles) {
      let content: string
      try {
        content = readFileSync(markdownFile, "utf8")
      } catch {
        continue
      }

      const frontmatter = parseFrontmatter(content)
      if (frontmatter) {
        const validation = validateSkillFrontmatter(frontmatter)
        if (!validation.success) {
          logger.warn(
            `Skipping skill with invalid frontmatter: ${markdownFile} — ${validation.errors.join(", ")}`,
          )
          continue
        }
      }

      const parsedName = parseSkillNameFromFrontmatter(content)
      const rawName = parsedName || inferSkillNameFromPath(markdownFile)
      const normalizedName = normalizeSkillName(rawName)
      if (!normalizedName) continue
      if (resolved.has(normalizedName)) continue

      const skill: ResolvedSkill = {
        name: normalizedName,
        description: parseSkillDescriptionFromFrontmatter(content),
        filePath: markdownFile,
        source: root.source,
        content,
      }

      if (frontmatter) {
        if (typeof frontmatter.source_url === "string") skill.source_url = frontmatter.source_url
        if (typeof frontmatter.source_license === "string")
          skill.source_license = frontmatter.source_license
        if (typeof frontmatter.imported_at === "string") skill.imported_at = frontmatter.imported_at
        if (typeof frontmatter.source_hash === "string") skill.source_hash = frontmatter.source_hash
      }

      resolved.set(normalizedName, skill)
    }
  }

  return resolved
}

export function getRequiredAuditSkills(): string[] {
  return ["reentrancy", "oracle-manipulation", "amm-dex"]
}
