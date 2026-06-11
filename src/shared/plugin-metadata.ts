import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

function resolvePluginRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..")
}

function resolvePluginVersion(): string {
  try {
    const packageJsonPath = resolve(resolvePluginRoot(), "package.json")
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      version?: unknown
    }

    if (typeof packageJson.version === "string" && packageJson.version.length > 0) {
      return packageJson.version
    }
  } catch (_error) {
    return "unknown"
  }

  return "unknown"
}

export const ARGUS_PLUGIN_VERSION = resolvePluginVersion()
export const ARGUS_PLUGIN_ROOT = resolvePluginRoot()

export interface BuildProvenance {
  version: string
  root: string
  gitSha?: string
  gitDirty?: boolean
}

function readGit(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return null
  }
}

// Identifies the build that is actually live, for the startup banner. The git
// short-SHA and dirty flag are read from the plugin's own source tree so an operator
// can prove the exact commit — and whether uncommitted edits are loaded — instead of
// trusting an unchanging version string. npm installs have no .git, so git reads fail
// and we fall back to version + root, which still uniquely identify the loaded dir.
export function resolveBuildProvenance(): BuildProvenance {
  const root = ARGUS_PLUGIN_ROOT
  const provenance: BuildProvenance = { version: ARGUS_PLUGIN_VERSION, root }
  const sha = readGit(["rev-parse", "--short", "HEAD"], root)
  if (sha) {
    provenance.gitSha = sha
    provenance.gitDirty = (readGit(["status", "--porcelain"], root)?.length ?? 0) > 0
  }
  return provenance
}

export function formatBuildBanner(provenance: BuildProvenance): string {
  const git = provenance.gitSha
    ? ` (${provenance.gitSha}${provenance.gitDirty ? "+dirty" : ""})`
    : ""
  return `v${provenance.version}${git} loaded from ${provenance.root}`
}
