import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

function resolvePluginVersion(): string {
  try {
    const currentDir = dirname(fileURLToPath(import.meta.url))
    const packageJsonPath = resolve(currentDir, "../../package.json")
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
