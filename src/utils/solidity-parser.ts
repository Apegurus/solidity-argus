import type { ContractProfile } from "../state/types"

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
  const _closer = opener === "[" ? "]" : "}"
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
    // Run forge inspect abi
    const abiResult = Bun.spawnSync(["forge", "inspect", contractName, "abi", "--json"], {
      cwd: projectDir,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    })

    if (!abiResult.success) {
      const errorMsg = abiResult.stderr?.toString() || "Unknown error"
      result.error = `Failed to inspect ABI: ${errorMsg}`
      return result
    }

    // Run forge inspect storage-layout
    const storageResult = Bun.spawnSync(
      ["forge", "inspect", contractName, "storage-layout", "--json"],
      {
        cwd: projectDir,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 15_000,
      },
    )

    if (!storageResult.success) {
      const errorMsg = storageResult.stderr?.toString() || "Unknown error"
      result.error = `Failed to inspect storage layout: ${errorMsg}`
      return result
    }

    // Parse ABI
    const abiRaw = abiResult.stdout?.toString() || "[]"
    const abiOutput = extractJson(abiRaw, "[")
    let abi: ABIFunction[] = []
    try {
      abi = JSON.parse(abiOutput)
    } catch (e) {
      result.error = `Failed to parse ABI JSON: ${e instanceof Error ? e.message : "Unknown error"}`
      return result
    }

    // Parse storage layout
    const storageRaw = storageResult.stdout?.toString() || "{}"
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
