import { existsSync } from "node:fs"
import { basename } from "node:path"
import { type ToolContext, tool } from "@opencode-ai/plugin"
import { findFoundryProjectDir } from "../shared/project-utils"
import type { ContractProfile } from "../state/types"
import { extractContractInfo, parseExternalCalls } from "../utils/solidity-parser"

type ContractAnalyzerArgs = {
  file_path: string
  project_dir?: string
}

type ExtractContractInfoFn = (contractName: string, projectDir: string) => Promise<ContractProfile>

type ContractAnalyzerDependencies = {
  extractInfo: ExtractContractInfoFn
}

const DEFAULT_DEPENDENCIES: ContractAnalyzerDependencies = {
  extractInfo: extractContractInfo,
}

function createFailureProfile(
  contractName: string,
  filePath: string,
  error: string,
): ContractProfile {
  return {
    name: contractName,
    filePath,
    functions: [],
    stateVars: [],
    inheritance: [],
    accessControlPattern: "none",
    externalCalls: [],
    riskIndicators: [],
    error,
  }
}

function addIndicator(indicators: Set<string>, source: string, indicator: string): void {
  if (source.includes(indicator.split("uses-")[1] ?? "")) {
    indicators.add(indicator)
  }
}

function collectRiskIndicators(source: string, existing: string[]): string[] {
  const indicators = new Set(existing)
  const normalized = source.toLowerCase()

  addIndicator(indicators, normalized, "uses-delegatecall")
  addIndicator(indicators, normalized, "uses-selfdestruct")
  if (/\bassembly\b/.test(normalized)) {
    indicators.add("uses-assembly")
  }
  if (/\btx\.origin\b/.test(normalized)) {
    indicators.add("uses-tx-origin")
  }
  if (/\.call\s*\{\s*value\s*:/.test(normalized)) {
    indicators.add("uses-low-level-value-call")
  }
  if (normalized.includes(".call(")) {
    indicators.add("uses-low-level-call")
  }
  if (normalized.includes("block.timestamp")) {
    indicators.add("uses-block-timestamp")
  }
  if (normalized.includes("block.number")) {
    indicators.add("uses-block-number")
  }
  if (normalized.includes("abi.encodepacked")) {
    indicators.add("uses-abi-encode-packed")
  }
  if (/\becrecover\b/.test(normalized)) {
    indicators.add("uses-ecrecover")
  }

  const importLines = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("import "))
  const importText = importLines.join("\n")

  const ozChecks: Array<{ pattern: RegExp; indicator: string }> = [
    { pattern: /\bReentrancyGuard\b/, indicator: "uses-oz-reentrancy-guard" },
    { pattern: /\bAccessControl\b/, indicator: "uses-oz-access-control" },
    { pattern: /\bOwnable\b/, indicator: "uses-oz-ownable" },
    { pattern: /\bPausable\b/, indicator: "uses-oz-pausable" },
  ]

  for (const check of ozChecks) {
    if (check.pattern.test(importText)) {
      indicators.add(check.indicator)
    }
  }

  return [...indicators]
}

function withAbort<T>(signal: AbortSignal, operation: Promise<T>): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"))
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("Aborted", "AbortError"))
    }

    signal.addEventListener("abort", onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}

export async function executeContractAnalyzer(
  args: ContractAnalyzerArgs,
  context: ToolContext,
  dependencies: ContractAnalyzerDependencies = DEFAULT_DEPENDENCIES,
): Promise<ContractProfile> {
  const filePath = args.file_path
  const contractName = basename(filePath, ".sol")

  context.metadata({ title: `Analyze contract: ${contractName}` })

  if (!existsSync(filePath)) {
    return createFailureProfile(contractName, filePath, `Contract file not found: ${filePath}`)
  }

  const projectDir = args.project_dir ?? findFoundryProjectDir(filePath)

  try {
    const [contractProfile, sourceText] = await withAbort(
      context.abort,
      Promise.all([dependencies.extractInfo(contractName, projectDir), Bun.file(filePath).text()]),
    )

    if (context.abort.aborted) {
      return createFailureProfile(contractName, filePath, "contract analysis aborted")
    }

    const inheritanceRegex = /contract\s+(\w+)\s+is\s+([^{]+)/g
    let sourceInheritance: string[] = []
    let firstMatchParents: string[] | undefined
    let regexMatch: RegExpExecArray | null = null

    regexMatch = inheritanceRegex.exec(sourceText)
    while (regexMatch !== null) {
      const matchedName = regexMatch.at(1) ?? ""
      const parents = (regexMatch.at(2) ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)

      if (!firstMatchParents) {
        firstMatchParents = parents
      }

      if (matchedName === contractName) {
        sourceInheritance = parents
        break
      }

      regexMatch = inheritanceRegex.exec(sourceText)
    }

    if (sourceInheritance.length === 0 && firstMatchParents) {
      sourceInheritance = firstMatchParents
    }

    const mergedInheritance = [...new Set([...contractProfile.inheritance, ...sourceInheritance])]
    const mergedExternalCalls = [
      ...new Set([...contractProfile.externalCalls, ...parseExternalCalls(sourceText)]),
    ]

    // Extract modifiers from source text for each function
    const visibilityKeywords = new Set([
      "external",
      "public",
      "internal",
      "private",
      "view",
      "pure",
      "payable",
      "virtual",
      "override",
      "returns",
    ])
    for (const fn of contractProfile.functions) {
      if (!fn.name) continue
      const escapedName = fn.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const fnPattern = new RegExp(`function\\s+${escapedName}\\s*\\([^)]*\\)\\s*([^{;]*)`)
      const fnMatch = fnPattern.exec(sourceText)
      if (!fnMatch?.[1]) continue

      const afterParams = fnMatch[1]
        .replace(/returns\s*\([^)]*\)/g, "")
        .replace(/\([^)]*\)/g, "")
        .trim()
      const tokens = afterParams.match(/\b\w+\b/g) ?? []
      fn.modifiers = tokens.filter((t) => !visibilityKeywords.has(t))
    }

    return {
      ...contractProfile,
      name: contractProfile.name || contractName,
      filePath,
      inheritance: mergedInheritance,
      externalCalls: mergedExternalCalls,
      riskIndicators: collectRiskIndicators(sourceText, contractProfile.riskIndicators),
    }
  } catch (error) {
    if (context.abort.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      return createFailureProfile(contractName, filePath, "contract analysis aborted")
    }

    const maybeError = error as Error & { code?: string }
    if (maybeError.code === "ENOENT") {
      return createFailureProfile(
        contractName,
        filePath,
        "Foundry not found. Install: curl -L https://foundry.paradigm.xyz | bash",
      )
    }

    const message = maybeError.message || "contract analysis failed"
    return createFailureProfile(contractName, filePath, message)
  }
}

export const contractAnalyzerTool = tool({
  description: "Analyze a Solidity contract and return a normalized ContractProfile.",
  args: {
    file_path: tool.schema.string(),
    project_dir: tool.schema.string().optional(),
  },
  async execute(args, context) {
    const contractProfile = await executeContractAnalyzer(args, context)
    return JSON.stringify(contractProfile)
  },
})
