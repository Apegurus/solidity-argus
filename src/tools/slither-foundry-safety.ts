import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { assertContained, PathSafetyError } from "../shared/path-safety"

export type FoundryCompilerConfigValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizedKey(key: string): string {
  return key.toLowerCase().replaceAll("_", "").replaceAll("-", "")
}

function validateCompilerSelections(value: unknown): FoundryCompilerConfigValidation {
  if (!isRecord(value)) return { ok: true }
  for (const [key, nested] of Object.entries(value)) {
    const normalized = normalizedKey(key)
    if (normalized === "extends") {
      return { ok: false, message: "Foundry config indirection is not supported" }
    }
    if (normalized === "solc" || normalized === "solcversion") {
      if (typeof nested !== "string" || !/^\d+\.\d+\.\d+$/.test(nested)) {
        return { ok: false, message: "Foundry config must select a version-pinned compiler" }
      }
    }
    if (
      normalized === "vyper" &&
      isRecord(nested) &&
      Object.entries(nested).some(
        ([nestedKey, nestedValue]) =>
          normalizedKey(nestedKey) === "path" && typeof nestedValue === "string",
      )
    ) {
      return { ok: false, message: "Foundry config may not select a Vyper executable path" }
    }
    const validation = validateCompilerSelections(nested)
    if (!validation.ok) return validation
  }
  return { ok: true }
}

function readContained(path: string, root: string): string {
  return readFileSync(assertContained(path, root), "utf8")
}

export function validateFoundryCompilerConfig(
  foundryRoot: string,
): FoundryCompilerConfigValidation {
  try {
    const configPath = join(foundryRoot, "foundry.toml")
    if (existsSync(configPath)) {
      const validation = validateCompilerSelections(
        Bun.TOML.parse(readContained(configPath, foundryRoot)),
      )
      if (!validation.ok) return validation
    }

    const envPath = join(foundryRoot, ".env")
    if (existsSync(envPath)) {
      for (const line of readContained(envPath, foundryRoot).split(/\r?\n/)) {
        const match =
          /^\s*(?:export\s+)?(FOUNDRY_CONFIG|FOUNDRY_SOLC_VERSION|FOUNDRY_SOLC|DAPP_SOLC_VERSION|DAPP_SOLC|FOUNDRY_VYPER_PATH|FOUNDRY_SRC|FOUNDRY_TEST|FOUNDRY_SCRIPT|FOUNDRY_LIBS|FOUNDRY_REMAPPINGS|FOUNDRY_ALLOW_PATHS|FOUNDRY_INCLUDE_PATHS|DAPP_SRC|DAPP_TEST|DAPP_LIBRARIES|DAPP_REMAPPINGS)\s*=\s*(.+?)\s*$/.exec(
            line,
          )
        if (!match?.[1] || !match[2]) continue
        if (
          !["FOUNDRY_SOLC_VERSION", "FOUNDRY_SOLC", "DAPP_SOLC_VERSION", "DAPP_SOLC"].includes(
            match[1],
          )
        ) {
          return { ok: false, message: "Foundry environment path overrides are not supported" }
        }
        const selection = match[2].replace(/^['"]|['"]$/g, "")
        if (!/^\d+\.\d+\.\d+$/.test(selection)) {
          return { ok: false, message: "Foundry config must select a version-pinned compiler" }
        }
      }
    }
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof PathSafetyError
          ? "Foundry compiler configuration resolves outside the project"
          : "Foundry compiler configuration could not be verified",
    }
  }
}

function addConfiguredPath(roots: Set<string>, path: string): void {
  if (path.includes("$")) throw new Error("Foundry path interpolation is not supported")
  roots.add(path)
}

function addRemapping(roots: Set<string>, remapping: string): void {
  const separator = remapping.indexOf("=")
  if (separator < 0) return
  const path = remapping.slice(separator + 1).trim()
  if (path.length > 0) addConfiguredPath(roots, path)
}

function configuredRoots(parsed: unknown, foundryRoot: string, remappings: string): string[] {
  const roots = new Set(["src", "test", "script", "lib"])
  if (isRecord(parsed) && isRecord(parsed.profile)) {
    for (const profile of Object.values(parsed.profile)) {
      if (!isRecord(profile)) continue
      for (const [key, value] of Object.entries(profile)) {
        const normalized = normalizedKey(key)
        if (["src", "test", "script"].includes(normalized) && typeof value === "string") {
          addConfiguredPath(roots, value)
        }
        if (["libs", "includepaths", "allowpaths"].includes(normalized) && Array.isArray(value)) {
          for (const path of value) if (typeof path === "string") addConfiguredPath(roots, path)
        }
        if (normalized === "remappings" && Array.isArray(value)) {
          for (const remapping of value) {
            if (typeof remapping === "string") addRemapping(roots, remapping)
          }
        }
      }
    }
  }
  for (const line of remappings.split(/\r?\n/)) {
    const value = line.trim()
    if (value.length > 0 && !value.startsWith("#")) addRemapping(roots, value)
  }
  return [...roots].map((path) => resolve(foundryRoot, path))
}

export function validateFoundrySourceClosure(
  foundryRoot: string,
  projectDir: string,
): FoundryCompilerConfigValidation {
  try {
    const configPath = join(foundryRoot, "foundry.toml")
    const parsed = existsSync(configPath)
      ? Bun.TOML.parse(readContained(configPath, foundryRoot))
      : undefined
    const remappingsPath = join(foundryRoot, "remappings.txt")
    const remappings = existsSync(remappingsPath) ? readContained(remappingsPath, foundryRoot) : ""
    const pending = configuredRoots(parsed, foundryRoot, remappings)
      .map((path) => assertContained(path, projectDir))
      .filter((path) => existsSync(path))
    const visited = new Set<string>()
    while (pending.length > 0) {
      const current = pending.pop()
      if (!current || visited.has(current)) continue
      visited.add(current)
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const candidate = join(current, entry.name)
        if (entry.isSymbolicLink()) {
          const canonical = assertContained(candidate, projectDir)
          if (statSync(canonical).isDirectory()) pending.push(canonical)
        } else if (entry.isDirectory()) {
          pending.push(candidate)
        }
      }
    }
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof PathSafetyError
          ? "Foundry source tree resolves outside the active project"
          : "Foundry source tree could not be verified",
    }
  }
}
