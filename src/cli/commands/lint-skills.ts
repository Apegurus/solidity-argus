import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { CliCommand } from "../types"
import { createLogger } from "../../shared/logger"

const logger = createLogger()
import { resolveSkillRoots } from "../../skills/argus-skill-resolver"
import { parseFrontmatter, validateSkillFrontmatter } from "../../skills/skill-schema"
import { loadArgusConfig } from "../../config/loader"
import { cliOutput } from "../cli-output"

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const RESET = "\x1b[0m"

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

export interface LintResult {
  valid: number
  invalid: number
  skipped: number
  errors: Array<{ file: string; errors: string[] }>
}

export function lintSkillFiles(skillFiles: Array<{ path: string; content: string }>): LintResult {
  let valid = 0
  let invalid = 0
  let skipped = 0
  const errors: Array<{ file: string; errors: string[] }> = []

  for (const { path, content } of skillFiles) {
    const fm = parseFrontmatter(content)
    if (!fm) {
      skipped++
      continue
    }

    const result = validateSkillFrontmatter(fm)
    if (result.success) {
      valid++
    } else {
      invalid++
      errors.push({ file: path, errors: result.errors })
    }
  }

  return { valid, invalid, skipped, errors }
}

export const lintSkillsCommand: CliCommand = {
  name: "lint-skills",
  description: "Validate all SKILL.md files against schema",
  async execute(): Promise<number> {
    const cwd = process.cwd()
    let config: ReturnType<typeof loadArgusConfig> | undefined
    try {
      config = loadArgusConfig(cwd)
    } catch {
      logger.debug("Config load failed, using defaults")
    }

    const roots = resolveSkillRoots(cwd, config)
    const skillFiles: Array<{ path: string; content: string }> = []

    for (const root of roots) {
      const files = findSkillFiles(root.path)
      for (const file of files) {
        try {
          skillFiles.push({ path: file, content: readFileSync(file, "utf8") })
        } catch {
          logger.debug("Skipping unreadable skill file")
        }
      }
    }

    const result = lintSkillFiles(skillFiles)

    cliOutput.log(`Skill Lint: ${result.valid} valid, ${result.invalid} invalid, ${result.skipped} skipped (no frontmatter)`)

    if (result.errors.length > 0) {
      for (const { file, errors } of result.errors) {
        cliOutput.log(`\n${RED}✗${RESET} ${file}`)
        for (const err of errors) {
          cliOutput.log(`  - ${err}`)
        }
      }
    } else if (result.valid > 0) {
      cliOutput.log(`${GREEN}✓${RESET} All skills pass schema validation`)
    }

    return result.invalid > 0 ? 1 : 0
  },
}
