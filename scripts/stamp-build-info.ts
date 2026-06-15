// Writes build-info.json at pack time so published installs (no .git) can report their
// commit. Wired as the package.json "prepack" script; never throws, so it cannot block a pack.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 5000 }).trim()
  } catch {
    return ""
  }
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      version?: unknown
    }
    return typeof pkg.version === "string" ? pkg.version : "unknown"
  } catch {
    return "unknown"
  }
}

const commit = git(["rev-parse", "HEAD"])
const dirty = git(["status", "--porcelain"]).length > 0
const stamp = { version: readVersion(), commit, dirty, builtAt: new Date().toISOString() }

try {
  writeFileSync(resolve(root, "build-info.json"), `${JSON.stringify(stamp, null, 2)}\n`)
  console.error(
    `[stamp-build-info] build-info.json <- ${commit || "(no git commit)"}${dirty ? " +dirty" : ""}`,
  )
} catch (error) {
  console.error(
    `[stamp-build-info] failed: ${error instanceof Error ? error.message : String(error)}`,
  )
}
