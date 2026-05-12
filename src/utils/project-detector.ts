import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { type DependencyRisk, scanDependencyRisks } from "./dependency-scanner"

export interface ProjectConfig {
  type: "foundry" | "hardhat" | "mixed" | "unknown"
  srcDir: string
  testDir: string
  solcVersion?: string
  remappings: string[]
  viaIr: boolean
  rootDir: string
  optimizer?: { enabled: boolean; runs?: number }
  evmVersion?: string
  profiles?: string[]
  hasHardhat: boolean
  hasFoundry: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  isUpgradeable: boolean
  outDir?: string
  dependencyRisks: DependencyRisk[]
}

/**
 * Detects the Solidity framework (Foundry/Hardhat) from config files
 * @param dir Directory to scan for config files
 * @returns ProjectConfig with detected framework type and settings
 */
export async function detectProject(dir: string): Promise<ProjectConfig> {
  const rootDir = resolve(dir)
  const foundryTomlPath = join(rootDir, "foundry.toml")
  const hardhatConfigTsPath = join(rootDir, "hardhat.config.ts")
  const hardhatConfigJsPath = join(rootDir, "hardhat.config.js")

  const hasFoundry = existsSync(foundryTomlPath)
  const hasHardhatTs = existsSync(hardhatConfigTsPath)
  const hasHardhatJs = existsSync(hardhatConfigJsPath)
  const hasHardhat = hasHardhatTs || hasHardhatJs

  // Determine project type
  let type: "foundry" | "hardhat" | "mixed" | "unknown"
  if (hasFoundry && hasHardhat) {
    type = "mixed"
  } else if (hasFoundry) {
    type = "foundry"
  } else if (hasHardhat) {
    type = "hardhat"
  } else {
    type = "unknown"
  }

  let srcDir = "src"
  let testDir = "test"
  let solcVersion: string | undefined
  let remappings: string[] = []
  let viaIr = false
  let optimizer: { enabled: boolean; runs?: number } | undefined
  let evmVersion: string | undefined
  let profiles: string[] | undefined
  let outDir: string | undefined

  if (hasFoundry) {
    const foundryConfig = await parseFoundryToml(foundryTomlPath)
    srcDir = foundryConfig.srcDir || srcDir
    testDir = foundryConfig.testDir || testDir
    solcVersion = foundryConfig.solcVersion
    remappings = foundryConfig.remappings
    viaIr = foundryConfig.viaIr
    optimizer = foundryConfig.optimizer
    evmVersion = foundryConfig.evmVersion
    profiles = foundryConfig.profiles
    outDir = foundryConfig.outDir
  }

  const remappingsFromTxt = parseRemappingsTxt(rootDir)
  if (remappingsFromTxt.length > 0 && remappings.length === 0) {
    remappings = remappingsFromTxt
  }

  if (hasHardhat && !hasFoundry) {
    srcDir = "contracts"
  }

  const isUpgradeable = existsSync(join(rootDir, ".openzeppelin"))

  const { dependencies, devDependencies } = await parsePackageJson(rootDir)

  return {
    type,
    srcDir,
    testDir,
    solcVersion,
    remappings,
    viaIr,
    rootDir,
    optimizer,
    evmVersion,
    profiles,
    hasHardhat,
    hasFoundry,
    dependencies,
    devDependencies,
    isUpgradeable,
    outDir,
    dependencyRisks: scanDependencyRisks({ dependencies, devDependencies }),
  }
}

/**
 * Parses foundry.toml file using regex-based parsing
 */
interface FoundryTomlResult {
  srcDir?: string
  testDir?: string
  solcVersion?: string
  remappings: string[]
  viaIr: boolean
  optimizer?: { enabled: boolean; runs?: number }
  evmVersion?: string
  profiles?: string[]
  outDir?: string
}

async function parseFoundryToml(filePath: string): Promise<FoundryTomlResult> {
  const content = await Bun.file(filePath).text()

  const result: FoundryTomlResult = {
    srcDir: undefined,
    testDir: undefined,
    solcVersion: undefined,
    remappings: [],
    viaIr: false,
  }

  const profileNames = Array.from(content.matchAll(/\[profile\.(\w+)\]/g), (m) => m[1]).filter(
    (name): name is string => Boolean(name),
  )
  if (profileNames.length > 0) {
    result.profiles = profileNames
  }

  const profileDefaultMatch = content.match(/\[profile\.default\]([\s\S]*?)(?:\n\[|$)/)
  if (!profileDefaultMatch || !profileDefaultMatch[1]) {
    return result
  }

  const profileSection = profileDefaultMatch[1]

  const srcMatch = profileSection.match(/^\s*src\s*=\s*["']([^"']+)["']/m)
  if (srcMatch?.[1]) {
    result.srcDir = srcMatch[1]
  }

  const testMatch = profileSection.match(/^\s*test\s*=\s*["']([^"']+)["']/m)
  if (testMatch?.[1]) {
    result.testDir = testMatch[1]
  }

  const solcMatch = profileSection.match(/^\s*solc\s*=\s*["']([^"']+)["']/m)
  if (solcMatch?.[1]) {
    result.solcVersion = solcMatch[1]
  }

  const viaIrMatch = profileSection.match(/^\s*via[_-]ir\s*=\s*(true|false)/m)
  if (viaIrMatch?.[1] === "true") {
    result.viaIr = true
  }

  const optimizerMatch = profileSection.match(/^\s*optimizer\s*=\s*(true|false)/m)
  if (optimizerMatch?.[1]) {
    const enabled = optimizerMatch[1] === "true"
    const runsMatch = profileSection.match(/^\s*optimizer_runs\s*=\s*(\d+)/m)
    result.optimizer = {
      enabled,
      runs: runsMatch?.[1] ? parseInt(runsMatch[1], 10) : undefined,
    }
  }

  const evmMatch = profileSection.match(/^\s*evm_version\s*=\s*["']([^"']+)["']/m)
  if (evmMatch?.[1]) {
    result.evmVersion = evmMatch[1]
  }

  const outMatch = profileSection.match(/^\s*out\s*=\s*["']([^"']+)["']/m)
  if (outMatch?.[1]) {
    result.outDir = outMatch[1]
  }

  const remappingsMatch = profileSection.match(/remappings\s*=\s*\[([\s\S]*?)\]/)
  if (remappingsMatch?.[1]) {
    const remappingMatches = remappingsMatch[1].match(/["']([^"']+)["']/g)
    if (remappingMatches) {
      result.remappings = remappingMatches.map((m) => m.slice(1, -1))
    }
  }

  return result
}

async function parsePackageJson(rootDir: string): Promise<{
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}> {
  const pkgPath = join(rootDir, "package.json")
  if (!existsSync(pkgPath)) {
    return {}
  }
  try {
    const content = JSON.parse(await Bun.file(pkgPath).text())
    return {
      dependencies: content.dependencies,
      devDependencies: content.devDependencies,
    }
  } catch {
    return {}
  }
}

function parseRemappingsTxt(rootDir: string): string[] {
  const remappingsPath = join(rootDir, "remappings.txt")
  if (!existsSync(remappingsPath)) {
    return []
  }
  try {
    const content = require("node:fs").readFileSync(remappingsPath, "utf-8")
    return content
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0)
  } catch {
    return []
  }
}
