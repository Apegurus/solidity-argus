import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs"
import { isAbsolute, join, normalize, relative } from "node:path"

const MAX_SUFFIX_SEARCH_FILES = 5_000
const SKIPPED_SUFFIX_SEARCH_DIRS = new Set([
  ".argus",
  ".git",
  ".next",
  "build",
  "cache",
  "dist",
  "node_modules",
  "out",
])

function portablePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "")
}

function uniqueExistingSuffix(relativePath: string, projectDir: string): string | null {
  if (!relativePath || !projectDir) return null

  const normalizedProjectDir = normalize(projectDir)
  const target = portablePath(normalize(relativePath))
  const directPath = join(normalizedProjectDir, target)
  if (existsSync(directPath)) return target

  if (!existsSync(normalizedProjectDir)) return null

  const isBare = !target.includes("/")
  const matches: string[] = []
  const visitedDirectories = new Set<string>()
  let visitedEntries = 0
  let exhausted = false

  const projectRoot = (() => {
    try {
      return realpathSync(normalizedProjectDir)
    } catch {
      return normalizedProjectDir
    }
  })()

  const isInsideProject = (realPath: string): boolean => {
    const rel = relative(projectRoot, realPath)
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
  }

  const visit = (dir: string): void => {
    if (matches.length > 1 || exhausted) return
    const realDir = (() => {
      try {
        return realpathSync(dir)
      } catch {
        return null
      }
    })()
    if (!realDir || !isInsideProject(realDir) || visitedDirectories.has(realDir)) return
    visitedDirectories.add(realDir)

    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      if (SKIPPED_SUFFIX_SEARCH_DIRS.has(entry)) continue
      visitedEntries++
      if (visitedEntries > MAX_SUFFIX_SEARCH_FILES) {
        exhausted = true
        return
      }
      const absolute = join(dir, entry)
      const stats = (() => {
        try {
          return lstatSync(absolute)
        } catch {
          return null
        }
      })()
      if (!stats) continue
      if (stats.isSymbolicLink()) continue
      if (stats.isDirectory()) {
        visit(absolute)
        continue
      }
      if (!stats.isFile()) continue
      const candidate = portablePath(relative(normalizedProjectDir, absolute))
      if (candidate === target || candidate.endsWith(`/${target}`)) {
        matches.push(candidate)
      } else if (isBare && candidate.split("/").pop() === target) {
        matches.push(candidate)
      }
      if (matches.length > 1 || exhausted) return
    }
  }

  visit(normalizedProjectDir)
  const onlyMatch = matches[0]
  return !exhausted && matches.length === 1 && onlyMatch ? onlyMatch : null
}

export function normalizeFilePath(filePath: string, projectDir: string): string {
  if (!filePath) return ""
  const normalized = normalize(filePath)
  if (isAbsolute(normalized)) {
    const rel = relative(projectDir, normalized)
    return rel.startsWith("..") ? normalized : portablePath(rel)
  }
  const relativePath = portablePath(normalized)
  return uniqueExistingSuffix(relativePath, projectDir) ?? relativePath
}
