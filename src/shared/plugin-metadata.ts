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

export type BuildProvenanceSource = "stamp" | "git" | "version-only"

export interface BuildProvenance {
  version: string
  root: string
  gitSha?: string
  gitDirty?: boolean
  source?: BuildProvenanceSource
}

export interface ProvenanceReaders {
  stamp: () => { commit: string; dirty: boolean } | null
  gitShortSha: () => string | null
  gitDirty: () => boolean
}

function readGit(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim()
  } catch {
    return null
  }
}

// build-info.json is the only provenance that survives into a published npm install,
// which has no .git directory to query at runtime.
function readBuildStamp(root: string): { commit: string; dirty: boolean } | null {
  try {
    const parsed = JSON.parse(readFileSync(resolve(root, "build-info.json"), "utf8")) as {
      commit?: unknown
      dirty?: unknown
    }
    if (typeof parsed.commit === "string" && /^[0-9a-f]{7,40}$/.test(parsed.commit)) {
      return { commit: parsed.commit, dirty: parsed.dirty === true }
    }
  } catch {
    // absent in a development worktree; caller falls back to runtime git
  }
  return null
}

export function computeBuildProvenance(
  version: string,
  root: string,
  readers: ProvenanceReaders,
): BuildProvenance {
  const stamp = readers.stamp()
  if (stamp) {
    return { version, root, gitSha: stamp.commit, gitDirty: stamp.dirty, source: "stamp" }
  }
  const sha = readers.gitShortSha()
  if (sha) {
    return { version, root, gitSha: sha, gitDirty: readers.gitDirty(), source: "git" }
  }
  return { version, root, source: "version-only" }
}

export function resolveBuildProvenance(): BuildProvenance {
  const root = ARGUS_PLUGIN_ROOT
  return computeBuildProvenance(ARGUS_PLUGIN_VERSION, root, {
    stamp: () => readBuildStamp(root),
    gitShortSha: () => readGit(["rev-parse", "--short", "HEAD"], root),
    gitDirty: () => (readGit(["status", "--porcelain"], root)?.length ?? 0) > 0,
  })
}

// Everything after `+` is semver build metadata, so the descriptor stays a parseable version.
export function formatBuildId(provenance: BuildProvenance): string {
  if (!provenance.gitSha) {
    return provenance.version
  }
  const short = provenance.gitSha.slice(0, 12)
  return `${provenance.version}+g${short}${provenance.gitDirty ? ".dirty" : ""}`
}

export function formatBuildBanner(provenance: BuildProvenance): string {
  const git = provenance.gitSha
    ? ` (${provenance.gitSha.slice(0, 12)}${provenance.gitDirty ? "+dirty" : ""})`
    : ""
  return `v${provenance.version}${git} loaded from ${provenance.root}`
}

export const ARGUS_BUILD_PROVENANCE = resolveBuildProvenance()
export const ARGUS_PLUGIN_BUILD = formatBuildId(ARGUS_BUILD_PROVENANCE)
