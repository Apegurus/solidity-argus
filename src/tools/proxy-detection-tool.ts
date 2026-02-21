import { isAbsolute, join } from "node:path"
import { type ToolContext, tool } from "@opencode-ai/plugin"

type ProxyDetectionArgs = {
  file_path: string
  project_dir?: string
}

type ProxyType = "diamond" | "uups" | "beacon" | "transparent" | "erc1967"

type Confidence = "high" | "medium" | "low"

export type ProxyDetectionResult = {
  file: string
  isProxy: boolean
  proxyType: ProxyType | null
  indicators: string[]
  confidence: Confidence
  error?: string
}

export type ReadFileFn = (path: string) => Promise<string>

const ERC1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
const ERC1967_ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103"
const ERC1967_BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50"

const readWithBunFile: ReadFileFn = async (path) => Bun.file(path).text()

function hasMatch(source: string, pattern: RegExp): boolean {
  return pattern.test(source)
}

function computeConfidence(indicatorCount: number): Confidence {
  if (indicatorCount >= 3) {
    return "high"
  }
  if (indicatorCount === 2) {
    return "medium"
  }
  return "low"
}

function collectIndicators(source: string): Set<string> {
  const indicators = new Set<string>()
  const lower = source.toLowerCase()

  if (lower.includes(ERC1967_IMPLEMENTATION_SLOT)) {
    indicators.add("erc1967-implementation-slot")
  }
  if (lower.includes(ERC1967_ADMIN_SLOT)) {
    indicators.add("erc1967-admin-slot")
  }
  if (lower.includes(ERC1967_BEACON_SLOT)) {
    indicators.add("erc1967-beacon-slot")
  }

  if (hasMatch(source, /\b_implementation\s*\(/i)) {
    indicators.add("transparent-implementation-getter")
  }
  if (hasMatch(source, /\b_admin\s*\(/i) || hasMatch(source, /\b_admin\b/i)) {
    indicators.add("transparent-admin-getter")
  }
  if (hasMatch(source, /\b_setImplementation\s*\(/i)) {
    indicators.add("transparent-set-implementation")
  }

  if (hasMatch(source, /\b_authorizeUpgrade\s*\(/i)) {
    indicators.add("uups-authorize-upgrade")
  }
  if (hasMatch(source, /\bupgradeToAndCall\s*\(/i)) {
    indicators.add("uups-upgrade-to-and-call")
  }
  if (hasMatch(source, /\bUUPSUpgradeable\b/)) {
    indicators.add("uups-upgradeable")
  }

  if (hasMatch(source, /\bIBeacon\b/)) {
    indicators.add("beacon-interface")
  }
  if (hasMatch(source, /\bBeaconProxy\b/)) {
    indicators.add("beacon-proxy")
  }
  if (hasMatch(source, /\bUpgradeableBeacon\b/)) {
    indicators.add("upgradeable-beacon")
  }

  if (hasMatch(source, /\bDiamondCut\b/)) {
    indicators.add("diamond-cut")
  }
  if (hasMatch(source, /\bIDiamondCut\b/)) {
    indicators.add("diamond-cut-interface")
  }
  if (hasMatch(source, /\bfacetAddress\s*\(/i)) {
    indicators.add("facet-address")
  }
  if (hasMatch(source, /\bIDiamondLoupe\b/)) {
    indicators.add("diamond-loupe")
  }

  if (hasMatch(source, /\bdelegatecall\b/)) {
    indicators.add("delegatecall")
  }
  if (hasMatch(source, /\bfallback\s*\(/i)) {
    indicators.add("fallback-function")
  }
  if (hasMatch(source, /\bProxy\b/)) {
    indicators.add("proxy-keyword")
  }
  if (hasMatch(source, /\bERC1967\b/)) {
    indicators.add("erc1967-keyword")
  }

  return indicators
}

function hasAny(indicators: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => indicators.has(candidate))
}

function classifyProxyType(indicators: Set<string>): ProxyType | null {
  if (
    hasAny(indicators, ["diamond-cut", "diamond-cut-interface", "facet-address", "diamond-loupe"])
  ) {
    return "diamond"
  }

  if (
    hasAny(indicators, ["uups-authorize-upgrade", "uups-upgrade-to-and-call", "uups-upgradeable"])
  ) {
    return "uups"
  }

  if (hasAny(indicators, ["beacon-interface", "beacon-proxy", "upgradeable-beacon"])) {
    return "beacon"
  }

  if (
    hasAny(indicators, [
      "transparent-implementation-getter",
      "transparent-admin-getter",
      "transparent-set-implementation",
    ])
  ) {
    return "transparent"
  }

  if (
    hasAny(indicators, [
      "erc1967-implementation-slot",
      "erc1967-admin-slot",
      "erc1967-beacon-slot",
      "delegatecall",
    ])
  ) {
    return "erc1967"
  }

  return null
}

export async function executeProxyDetection(
  args: ProxyDetectionArgs,
  context: ToolContext,
  readFile: ReadFileFn = readWithBunFile,
): Promise<ProxyDetectionResult> {
  context.metadata({ title: `Detect proxy patterns: ${args.file_path}` })

  const fileToRead =
    args.project_dir && !isAbsolute(args.file_path)
      ? join(args.project_dir, args.file_path)
      : args.file_path

  try {
    const source = await readFile(fileToRead)
    const indicators = collectIndicators(source)
    const proxyType = classifyProxyType(indicators)
    const indicatorList = [...indicators]
    const isProxy = proxyType !== null

    return {
      file: args.file_path,
      isProxy,
      proxyType,
      indicators: isProxy ? indicatorList : [],
      confidence: computeConfidence(isProxy ? indicatorList.length : 0),
    }
  } catch (error) {
    const maybeError = error as Error & { code?: string }
    if (maybeError.code === "ENOENT") {
      return {
        file: args.file_path,
        isProxy: false,
        proxyType: null,
        indicators: [],
        confidence: "low",
        error: `File not found: ${args.file_path}`,
      }
    }

    return {
      file: args.file_path,
      isProxy: false,
      proxyType: null,
      indicators: [],
      confidence: "low",
      error: maybeError.message || "proxy detection failed",
    }
  }
}

export const proxyDetectionTool = tool({
  description:
    "Detects proxy patterns in Solidity contracts (ERC1967, UUPS, transparent, beacon, diamond) with confidence scoring.",
  args: {
    file_path: tool.schema.string(),
    project_dir: tool.schema.string().optional(),
  },
  async execute(args, context) {
    const result = await executeProxyDetection(args, context)
    return JSON.stringify(result)
  },
})
