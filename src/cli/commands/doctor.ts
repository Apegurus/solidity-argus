import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, extname, join, resolve } from "node:path"
import { loadArgusConfig } from "../../config/loader"
import type { ArgusConfig } from "../../config/types"
import {
  assertScvdApiUrlAllowed,
  ScvdApiError,
  ScvdClient,
  ScvdNetworkError,
} from "../../knowledge/scvd-client"
import { createLogger } from "../../shared/logger"
import { buildSafeEnv, ProcessRunnerError } from "../../shared/process-runner"
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
import { inspectSlitherPythonRuntime } from "./slither-runtime"

const logger = createLogger()

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const RESET = "\x1b[0m"

const REGISTRY_URL = "https://registry.npmjs.org/solidity-argus/latest"
const DEFAULT_TIMEOUT_MS = 3_000
const MAX_REGISTRY_BODY_BYTES = 64 * 1024

// Strict semver (major.minor.patch + optional prerelease/build), fully anchored so
// any embedded ANSI/control character fails the match. Gates version strings before
// they are compared or printed to the terminal (blocks registry-sourced terminal
// injection).
const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?(?:\+[0-9A-Za-z][0-9A-Za-z.-]*)?$/

export type VersionCheckResult =
  | { status: "up-to-date"; remoteVersion: string; localVersion: string }
  | { status: "outdated"; remoteVersion: string; localVersion: string }
  | { status: "ahead"; remoteVersion: string; localVersion: string }
  | { status: "skipped"; reason: string }

function parseSemver(
  value: string,
): { release: [number, number, number]; prerelease: string[] } | null {
  const m = SEMVER_REGEX.exec(value)
  if (!m) return null
  return {
    release: [Number(m[1]), Number(m[2]), Number(m[3])],
    prerelease: m[4] ? m[4].split(".") : [],
  }
}

// Semver prerelease precedence: numeric identifiers compare by value, numeric ranks
// below alphanumeric, alphanumeric compares lexically; a release WITH a prerelease
// (1.0.0-beta) ranks below the same release WITHOUT one (1.0.0).
function comparePrerelease(a: string[], b: string[]): -1 | 0 | 1 {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? ""
    const bi = b[i] ?? ""
    const aNum = /^\d+$/.test(ai)
    const bNum = /^\d+$/.test(bi)
    if (aNum && bNum) {
      const d = Number(ai) - Number(bi)
      if (d !== 0) return d < 0 ? -1 : 1
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1
    } else {
      const d = ai.localeCompare(bi)
      if (d !== 0) return d < 0 ? -1 : 1
    }
  }
  if (a.length !== b.length) return a.length < b.length ? -1 : 1
  return 0
}

function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    const x = pa.release[i] ?? 0
    const y = pb.release[i] ?? 0
    if (x < y) return -1
    if (x > y) return 1
  }
  return comparePrerelease(pa.prerelease, pb.prerelease)
}

// Bounds the registry response so a misbehaving registry/proxy cannot OOM the
// doctor command: rejects an oversized declared Content-Length up front, then
// streams with a hard byte cap (covering responses that omit Content-Length).
export async function readJsonCapped(res: Response, capBytes: number): Promise<unknown> {
  const declared = Number(res.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > capBytes) {
    throw new Error(`registry response too large (${declared} bytes)`)
  }
  const reader = res.body?.getReader()
  if (!reader) {
    throw new Error("registry response has no readable body to bound")
  }
  const chunks: Uint8Array[] = []
  let total = 0
  let chunk = await reader.read()
  while (!chunk.done) {
    if (chunk.value) {
      total += chunk.value.byteLength
      if (total > capBytes) {
        await reader.cancel()
        throw new Error("registry response exceeded size cap")
      }
      chunks.push(chunk.value)
    }
    chunk = await reader.read()
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  return JSON.parse(new TextDecoder().decode(merged))
}

export async function checkRemoteVersion(opts: {
  localVersion: string
  timeoutMs?: number
}): Promise<VersionCheckResult> {
  const { localVersion, timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  if (!parseSemver(localVersion)) {
    return { status: "skipped", reason: "local version is not valid semver" }
  }
  const ctrl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort()
        reject(new Error("version check timed out"))
      }, timeoutMs)
    })
    const res = await Promise.race([fetch(REGISTRY_URL, { signal: ctrl.signal }), timeout])
    if (!res.ok) {
      return { status: "skipped", reason: `non-200 status: ${res.status}` }
    }
    const body = (await readJsonCapped(res, MAX_REGISTRY_BODY_BYTES)) as { version?: unknown }
    if (typeof body.version !== "string") {
      return { status: "skipped", reason: "malformed registry response (no version field)" }
    }
    if (!parseSemver(body.version)) {
      return { status: "skipped", reason: "malformed registry response (invalid version)" }
    }
    const cmp = compareSemver(localVersion, body.version)
    if (cmp === 0) return { status: "up-to-date", remoteVersion: body.version, localVersion }
    if (cmp < 0) return { status: "outdated", remoteVersion: body.version, localVersion }
    return { status: "ahead", remoteVersion: body.version, localVersion }
  } catch (err) {
    return { status: "skipped", reason: err instanceof Error ? err.message : "unknown error" }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function checkBinary(
  name: string,
  versionArgs: string[] = ["--version"],
): { found: boolean; version: string | null } {
  try {
    const result = Bun.spawnSync([name, ...versionArgs], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
      env: buildSafeEnv(),
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

// ─────────────────────────────────────────────────────────────────────────────
// Install-drift detection
//
// OpenCode's plugin resolver walks up the filesystem looking up `node_modules`
// directories. A stale copy of solidity-argus hoisted to a higher-precedence
// location (typically `~/.cache/opencode/node_modules/solidity-argus`) will
// SHADOW the canonical install under `~/.cache/opencode/packages/...`. The
// shadowing install is loaded silently, leading to confusing failures like
// `undefined is not an object (evaluating 'result.toLowerCase')` on every MCP
// call (older versions lacked defensive guards in `tool.execute.after`).
//
// This check enumerates known install locations and flags drift.
// ─────────────────────────────────────────────────────────────────────────────

export type ArgusInstallSource =
  | "current"
  | "hoisted-cache"
  | "package-cache"
  | "user-config"
  | "project-local"

export type ArgusInstall = {
  source: ArgusInstallSource
  path: string
  version: string | null
}

export type InstallDriftReport = {
  current: ArgusInstall | null
  installs: ArgusInstall[]
  errors: string[]
  warnings: string[]
}

function readPackageVersion(packageRoot: string): string | null {
  try {
    const raw = readFileSync(join(packageRoot, "package.json"), "utf8")
    const parsed = JSON.parse(raw) as { version?: unknown }
    return typeof parsed.version === "string" ? parsed.version : null
  } catch {
    return null
  }
}

function getCurrentArgusInstall(): ArgusInstall | null {
  // doctor.ts lives at <packageRoot>/src/cli/commands/doctor.ts
  const packageRoot = resolve(import.meta.dir, "../../..")
  if (!existsSync(join(packageRoot, "package.json"))) return null
  const version = readPackageVersion(packageRoot)
  return { source: "current", path: packageRoot, version }
}

export function enumerateArgusInstallCandidates(
  cwd: string,
  home: string,
): Array<{ source: ArgusInstallSource; path: string }> {
  return [
    {
      source: "hoisted-cache",
      path: join(home, ".cache", "opencode", "node_modules", "solidity-argus"),
    },
    {
      source: "package-cache",
      path: join(
        home,
        ".cache",
        "opencode",
        "packages",
        "solidity-argus@latest",
        "node_modules",
        "solidity-argus",
      ),
    },
    {
      source: "user-config",
      path: join(home, ".config", "opencode", "node_modules", "solidity-argus"),
    },
    {
      source: "project-local",
      path: join(cwd, "node_modules", "solidity-argus"),
    },
  ]
}

function findArgusInstalls(cwd: string, home: string): ArgusInstall[] {
  const installs: ArgusInstall[] = []
  for (const { source, path } of enumerateArgusInstallCandidates(cwd, home)) {
    if (existsSync(path)) {
      installs.push({ source, path, version: readPackageVersion(path) })
    }
  }
  return installs
}

export function detectInstallDrift(
  current: ArgusInstall | null,
  installs: ArgusInstall[],
): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  const hoisted = installs.find((i) => i.source === "hoisted-cache")
  const pkgCache = installs.find((i) => i.source === "package-cache")

  // Highest-confidence error: hoisted cache shadows the canonical cache with a
  // DIFFERENT version. OpenCode will load the wrong one.
  if (hoisted && pkgCache && hoisted.version !== pkgCache.version) {
    errors.push(
      `Stale install shadowing canonical version:\n` +
        `    ${hoisted.path} (v${hoisted.version ?? "unknown"})\n` +
        `    shadows ${pkgCache.path} (v${pkgCache.version ?? "unknown"}).\n` +
        `    OpenCode will load v${hoisted.version ?? "unknown"} instead of v${pkgCache.version ?? "unknown"}.\n` +
        `    Fix: rm -rf "${hoisted.path}"`,
    )
    return { errors, warnings }
  }

  // Lower-confidence: hoisted install drifts from the version the doctor CLI
  // is itself running as (typical when the user upgraded via bunx/opencode).
  if (hoisted && current?.version && hoisted.version && hoisted.version !== current.version) {
    warnings.push(
      `Possible stale install (drift from running version):\n` +
        `    ${hoisted.path} (v${hoisted.version}) differs from current (v${current.version}).\n` +
        `    Fix: rm -rf "${hoisted.path}"`,
    )
  }

  return { errors, warnings }
}

export function buildInstallDriftReport(cwd: string, home: string): InstallDriftReport {
  const current = getCurrentArgusInstall()
  const installs = findArgusInstalls(cwd, home)
  const { errors, warnings } = detectInstallDrift(current, installs)
  return { current, installs, errors, warnings }
}

const NON_SKILL_FILENAMES = new Set(["README.md", "INVENTORY.md", "CHANGELOG.md", "LICENSE.md"])

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
        } else if (
          entry.isFile() &&
          extname(entry.name).toLowerCase() === ".md" &&
          !NON_SKILL_FILENAMES.has(entry.name)
        ) {
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
      const runtime = inspectSlitherPythonRuntime("slither", cwd)
      if (runtime.status === "compatibility-warning") {
        cliOutput.log(
          `${YELLOW}⚠${RESET} Slither: installed (${slither.version}, Python ${runtime.version}); Python 3.14 compatibility varies by Slither release — Python 3.13 is recommended`,
        )
      } else if (runtime.status === "supported") {
        cliOutput.log(
          `${GREEN}✓${RESET} Slither: installed (${slither.version}, Python ${runtime.version})`,
        )
      } else {
        cliOutput.log(
          `${YELLOW}⚠${RESET} Slither: installed (${slither.version}); Python runtime could not be verified`,
        )
      }
    } else {
      cliOutput.log(
        `${RED}✗${RESET} Slither: not found — pipx install --python python3.13 slither-analyzer`,
      )
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
        `${YELLOW}⚠${RESET} solc-select: not found — required only for the Slither flatten fallback`,
      )
    }

    const projectType = checkSolidityProject(cwd)
    if (projectType) {
      cliOutput.log(`${GREEN}✓${RESET} Project: ${projectType} detected`)
    } else {
      cliOutput.log(`${YELLOW}⚠${RESET} Project: no Solidity project detected`)
    }

    const driftReport = buildInstallDriftReport(cwd, homedir())
    if (driftReport.errors.length === 0 && driftReport.warnings.length === 0) {
      const versionStr = driftReport.current?.version
        ? ` (current: v${driftReport.current.version})`
        : ""
      cliOutput.log(`${GREEN}✓${RESET} Install drift: none detected${versionStr}`)
    } else {
      for (const err of driftReport.errors) {
        cliOutput.log(`${RED}✗${RESET} Install drift: ${err}`)
        hasFailure = true
      }
      for (const warn of driftReport.warnings) {
        cliOutput.log(`${YELLOW}⚠${RESET} Install drift: ${warn}`)
      }
    }

    const installedVersion = driftReport.current?.version
    if (installedVersion) {
      const versionCheck = await checkRemoteVersion({ localVersion: installedVersion })
      switch (versionCheck.status) {
        case "up-to-date":
          cliOutput.log(`${GREEN}✓${RESET} argus is up to date (v${installedVersion})`)
          break
        case "outdated":
          cliOutput.log(
            `${YELLOW}⚠${RESET} argus v${installedVersion} installed — latest is v${versionCheck.remoteVersion}. Upgrade: \`bun add solidity-argus@latest\``,
          )
          break
        case "ahead":
          cliOutput.log(
            `· argus v${installedVersion} (ahead of registry v${versionCheck.remoteVersion}, e.g. local dev build)`,
          )
          break
        case "skipped":
          cliOutput.log(
            `· version check skipped (${versionCheck.reason.replace(/[^\x20-\x7e]/g, " ")})`,
          )
          break
      }
    } else {
      cliOutput.log("· version check skipped (local version not detected)")
    }

    if (projectType === "foundry" && detectViaIr(cwd)) {
      cliOutput.log(
        `${GREEN}✓${RESET} via_ir: enabled in foundry.toml — Slither will use Foundry compilation`,
      )
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
      // Parse the stats body via the client (not just response.ok) so an API schema drift
      // surfaces as a real problem instead of a false "reachable"; 10s covers cold starts.
      const scvdApiUrl = config?.knowledge?.scvd?.apiUrl ?? "https://api.scvd.dev"
      assertScvdApiUrlAllowed(scvdApiUrl)
      const stats = await new ScvdClient(scvdApiUrl, AbortSignal.timeout(10_000)).fetchStats()
      cliOutput.log(`${GREEN}✓${RESET} SCVD API: reachable (${stats.total} findings)`)
    } catch (error) {
      if (error instanceof ProcessRunnerError) {
        cliOutput.log(`${YELLOW}⚠${RESET} SCVD API: apiUrl not allowed — ${error.message}`)
      } else if (error instanceof ScvdNetworkError) {
        cliOutput.log(`${YELLOW}⚠${RESET} SCVD API: unreachable`)
      } else if (error instanceof ScvdApiError) {
        cliOutput.log(`${YELLOW}⚠${RESET} SCVD API: returned HTTP ${error.httpStatus}`)
      } else {
        cliOutput.log(
          `${YELLOW}⚠${RESET} SCVD API: reachable but response schema unrecognized — update the SCVD client or run argus_sync_knowledge`,
        )
      }
    }

    const soloditEnabled = config?.solodit?.enabled !== false
    if (soloditEnabled) {
      cliOutput.log(`${GREEN}✓${RESET} Solodit: enabled (direct tRPC search)`)
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
