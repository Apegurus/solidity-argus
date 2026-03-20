import * as parser from "@solidity-parser/parser"
import type { ContractProfile } from "../state/types"

const EXTERNAL_CALL_METHODS = new Set(["call", "transfer", "send", "delegatecall", "staticcall"])

interface ABIFunction {
  type: string
  name: string
  inputs?: Array<{ name: string; type: string }>
  outputs?: Array<{ name: string; type: string }>
  stateMutability?: string
}

interface StorageLayoutItem {
  label: string
  type: string
  slot: string
}

interface StorageLayout {
  storage: StorageLayoutItem[]
  types: Record<string, { label: string }>
}

/**
 * Extract the first JSON value from a string that may contain non-JSON
 * prefix (e.g. forge table-format output, compilation progress).
 * Falls back to the original string if no JSON delimiter is found.
 */
export function extractJson(raw: string, opener: "[" | "{"): string {
  const start = raw.indexOf(opener)
  if (start === -1) return raw

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < raw.length; i++) {
    const ch = raw.charAt(i)

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === "\\") {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === "{" || ch === "[") {
      depth++
    } else if (ch === "}" || ch === "]") {
      depth--
      if (depth === 0) {
        return raw.slice(start, i + 1)
      }
    }
  }

  return raw
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>
  }

  return undefined
}

function extractNodeExpressionName(node: unknown): string | undefined {
  const record = toRecord(node)
  if (!record) return undefined

  const type = typeof record.type === "string" ? record.type : undefined
  if (!type) return undefined

  if (type === "Identifier") {
    return typeof record.name === "string" ? record.name : undefined
  }

  if (type === "ThisExpression") {
    return "this"
  }

  if (type === "MemberAccess") {
    const expressionName = extractNodeExpressionName(record.expression)
    const memberName = typeof record.memberName === "string" ? record.memberName : undefined

    if (expressionName && memberName) {
      return `${expressionName}.${memberName}`
    }

    return expressionName ?? memberName
  }

  if (type === "IndexAccess") {
    return extractNodeExpressionName(record.base)
  }

  if (type === "FunctionCall") {
    return extractNodeExpressionName(record.expression)
  }

  return undefined
}

export function parseExternalCalls(sourceText: string): string[] {
  try {
    const ast = parser.parse(sourceText, { tolerant: true, loc: false, range: false })
    const externalCalls = new Set<string>()

    parser.visit(ast, {
      MemberAccess(node: unknown) {
        const record = toRecord(node)
        if (!record) return

        const memberName = typeof record.memberName === "string" ? record.memberName : undefined
        if (!memberName || !EXTERNAL_CALL_METHODS.has(memberName)) return

        const expressionName = extractNodeExpressionName(record.expression)
        externalCalls.add(expressionName ? `${expressionName}.${memberName}` : memberName)
      },
    })

    return [...externalCalls]
  } catch {
    return []
  }
}

async function spawnForgeInspect(
  contractName: string,
  inspectType: string,
  cwd: string,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["forge", "inspect", contractName, inspectType, "--json"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })

  const timeout = 15_000
  let timerId: ReturnType<typeof setTimeout>
  const timer = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      proc.kill()
      reject(new Error(`forge inspect ${inspectType} timed out after ${timeout}ms`))
    }, timeout)
  })

  try {
    const exitCode = await Promise.race([proc.exited, timer])
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    return { success: exitCode === 0, stdout, stderr }
  } finally {
    clearTimeout(timerId!)
  }
}

/**
 * Extract contract information using forge inspect
 * Runs forge inspect <contractName> abi and storage-layout
 * Parses ABI to extract functions and state variables
 * Detects access control patterns
 */
export async function extractContractInfo(
  contractName: string,
  projectDir: string,
): Promise<ContractProfile> {
  const result: ContractProfile = {
    name: contractName,
    filePath: "",
    functions: [],
    stateVars: [],
    inheritance: [],
    accessControlPattern: "none",
    externalCalls: [],
    riskIndicators: [],
  }

  try {
    // Run both forge inspect commands in parallel (async, non-blocking)
    const [abiResult, storageResult] = await Promise.all([
      spawnForgeInspect(contractName, "abi", projectDir),
      spawnForgeInspect(contractName, "storage-layout", projectDir),
    ])

    if (!abiResult.success) {
      result.error = `Failed to inspect ABI: ${abiResult.stderr}`
      return result
    }

    if (!storageResult.success) {
      result.error = `Failed to inspect storage layout: ${storageResult.stderr}`
      return result
    }

    // Parse ABI
    const abiRaw = abiResult.stdout || "[]"
    const abiOutput = extractJson(abiRaw, "[")
    let abi: ABIFunction[] = []
    try {
      abi = JSON.parse(abiOutput)
    } catch (e) {
      result.error = `Failed to parse ABI JSON: ${e instanceof Error ? e.message : "Unknown error"}`
      return result
    }

    // Parse storage layout
    const storageRaw = storageResult.stdout || "{}"
    const storageOutput = extractJson(storageRaw, "{")
    let storageLayout: StorageLayout = { storage: [], types: {} }
    try {
      storageLayout = JSON.parse(storageOutput)
    } catch (e) {
      result.error = `Failed to parse storage layout JSON: ${e instanceof Error ? e.message : "Unknown error"}`
      return result
    }

    // Extract functions from ABI
    const functions = abi.filter((item) => item.type === "function")
    result.functions = functions.map((func) => ({
      name: func.name || "",
      visibility: mapStateMutabilityToVisibility(func.stateMutability || "nonpayable"),
      mutability: func.stateMutability || "nonpayable",
      modifiers: [],
    }))

    // Extract state variables from storage layout
    result.stateVars = storageLayout.storage.map((item) => {
      const typeInfo = storageLayout.types[item.type]
      const typeLabel = typeInfo?.label || item.type

      return {
        name: item.label,
        type: typeLabel,
        visibility: "internal", // Default visibility for storage vars
      }
    })

    // Detect access control pattern
    result.accessControlPattern = detectAccessControlPattern(result.functions)

    return result
  } catch (e) {
    result.error = `Unexpected error: ${e instanceof Error ? e.message : "Unknown error"}`
    return result
  }
}

/**
 * Map Solidity stateMutability to visibility
 * ABI doesn't directly specify visibility, so we infer from mutability
 */
function mapStateMutabilityToVisibility(stateMutability: string): string {
  switch (stateMutability) {
    case "pure":
    case "view":
      return "view"
    case "payable":
    case "nonpayable":
      return "external"
    default:
      return "external"
  }
}

/**
 * Detect access control pattern from function names and signatures
 */
function detectAccessControlPattern(
  functions: Array<{ name: string; visibility: string; mutability: string; modifiers: string[] }>,
): "ownable" | "access-control" | "custom" | "none" {
  const functionNames = functions.map((f) => f.name.toLowerCase())

  // Check for Ownable pattern
  if (functionNames.includes("owner") || functionNames.includes("transferownership")) {
    return "ownable"
  }

  // Check for AccessControl pattern (OpenZeppelin)
  if (functionNames.includes("hasrole") || functionNames.includes("grantrole")) {
    return "access-control"
  }

  // Check for custom access control patterns
  if (functionNames.some((name) => name.includes("onlyadmin") || name.includes("requireadmin"))) {
    return "custom"
  }

  return "none"
}
