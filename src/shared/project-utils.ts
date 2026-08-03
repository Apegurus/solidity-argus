import { existsSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { isContained } from "./path-safety"

/**
 * Resolve the project directory from tool execution context.
 * Provides a consistent fallback chain: directory → worktree → cwd.
 */
export function resolveProjectDir(context: { directory?: string; worktree?: string }): string {
  return context.directory ?? context.worktree ?? process.cwd()
}

/**
 * Walk up from a file path to find the nearest directory containing foundry.toml.
 * Returns the file's parent directory if no foundry.toml is found.
 */
export function findFoundryProjectDir(fromPath: string, stopAt?: string): string {
  const start =
    existsSync(fromPath) && statSync(fromPath).isDirectory() ? fromPath : dirname(fromPath)
  const boundary = stopAt ? resolve(stopAt) : undefined
  if (boundary && !isContained(start, boundary)) return start
  let current = start

  while (true) {
    if (existsSync(join(current, "foundry.toml"))) {
      return current
    }

    if (current === boundary) return start

    const parent = dirname(current)
    if (parent === current || (boundary && !isContained(parent, boundary))) {
      return start
    }
    current = parent
  }
}
