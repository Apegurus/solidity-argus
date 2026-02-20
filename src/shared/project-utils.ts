import { dirname, join } from "node:path"
import { existsSync } from "node:fs"

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
export function findFoundryProjectDir(fromPath: string): string {
  let current = dirname(fromPath)

  while (true) {
    if (existsSync(join(current, "foundry.toml"))) {
      return current
    }

    const parent = dirname(current)
    if (parent === current) {
      return dirname(fromPath)
    }
    current = parent
  }
}
