import { type ToolContext, tool } from "@opencode-ai/plugin"
import { classifyForgeError } from "../shared/forge-errors"
import { runForgeCommand } from "../shared/forge-runner"
import { resolveProjectDir } from "../shared/project-utils"

type GasAnalysisArgs = {
  target?: string
  threshold?: number
}

type NormalizedGasAnalysisArgs = {
  target: string
  threshold: number
}

type ContractFunctionGas = {
  name: string
  min: number
  avg: number
  median: number
  max: number
  calls: number
}

type ContractGasReport = {
  name: string
  deploymentCost: number
  deploymentSize: number
  functions: ContractFunctionGas[]
}

type GasHotspot = {
  contract: string
  function: string
  avgGas: number
}

type GasAnalysisResult = {
  success: boolean
  contracts: ContractGasReport[]
  hotspots: GasHotspot[]
  executionTime: number
  error?: string
}

export type ForgeCommandRunner = (
  command: string[],
  options: { signal?: AbortSignal; cwd?: string; env?: Record<string, string> },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>

function toNumber(value: string): number {
  const normalized = value.replace(/[,_\s]/g, "").trim()
  if (normalized.length === 0) {
    return 0
  }
  const parsed = Number.parseInt(normalized, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseCells(line: string): string[] {
  return line
    .split(/[│┆|]/)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0)
}

function normalizeContractName(raw: string): string {
  return raw.replace(/\s+(contract|library|interface)$/i, "").trim()
}

function parseGasReport(stdout: string): ContractGasReport[] {
  const lines = stdout.split(/\r?\n/)
  const contracts: ContractGasReport[] = []
  let currentContract: ContractGasReport | undefined
  let expectingDeploymentValues = false
  let inFunctionSection = false

  for (const line of lines) {
    if (!line.includes("│") && !line.includes("┆") && !line.includes("|")) {
      continue
    }

    const cells = parseCells(line)
    if (cells.length === 0) {
      continue
    }

    const first = cells[0] ?? ""
    if (first.length === 0) {
      continue
    }

    const isContractLine = /\s(contract|library|interface)$/i.test(first)
    if (isContractLine) {
      currentContract = {
        name: normalizeContractName(first),
        deploymentCost: 0,
        deploymentSize: 0,
        functions: [],
      }
      contracts.push(currentContract)
      expectingDeploymentValues = false
      inFunctionSection = false
      continue
    }

    if (!currentContract) {
      continue
    }

    if (first === "Deployment Cost") {
      expectingDeploymentValues = true
      inFunctionSection = false
      continue
    }

    if (expectingDeploymentValues && /^\d[\d,\s_]*$/.test(first)) {
      currentContract.deploymentCost = toNumber(first)
      currentContract.deploymentSize = toNumber(cells[1] ?? "0")
      expectingDeploymentValues = false
      continue
    }

    if (first === "Function Name") {
      inFunctionSection = true
      continue
    }

    if (!inFunctionSection || cells.length < 6) {
      continue
    }

    if (first === "min" || first === "avg" || first === "median" || first === "max") {
      continue
    }

    const [name, min, avg, median, max, calls] = cells
    if (!/^\d/.test(min ?? "") || !/^\d/.test(avg ?? "")) {
      continue
    }

    currentContract.functions.push({
      name: name ?? "unknown",
      min: toNumber(min ?? "0"),
      avg: toNumber(avg ?? "0"),
      median: toNumber(median ?? "0"),
      max: toNumber(max ?? "0"),
      calls: toNumber(calls ?? "0"),
    })
  }

  return contracts
}

function normalizeArgs(args: GasAnalysisArgs, context: ToolContext): NormalizedGasAnalysisArgs {
  return {
    target: args.target ?? resolveProjectDir(context),
    threshold:
      typeof args.threshold === "number" && Number.isFinite(args.threshold)
        ? args.threshold
        : 100000,
  }
}

export async function executeGasAnalysis(
  args: GasAnalysisArgs,
  context: ToolContext,
  runCommand: ForgeCommandRunner = runForgeCommand,
): Promise<GasAnalysisResult> {
  const startedAt = Date.now()
  const normalizedArgs = normalizeArgs(args, context)
  context.metadata({ title: `Run forge gas report: ${normalizedArgs.target}` })

  const fail = (error: string): GasAnalysisResult => ({
    success: false,
    contracts: [],
    hotspots: [],
    executionTime: Date.now() - startedAt,
    error,
  })

  try {
    const forgeResult = await runCommand(["forge", "test", "--gas-report"], {
      signal: context.abort,
      cwd: normalizedArgs.target,
    })

    const contracts = parseGasReport(forgeResult.stdout)
    const hotspots = contracts
      .flatMap((contract) =>
        contract.functions.map((fn) => ({
          contract: contract.name,
          function: fn.name,
          avgGas: fn.avg,
        })),
      )
      .filter((hotspot) => hotspot.avgGas > normalizedArgs.threshold)
      .sort((a, b) => b.avgGas - a.avgGas)

    const success = forgeResult.exitCode === 0
    const output: GasAnalysisResult = {
      success,
      contracts,
      hotspots,
      executionTime: Date.now() - startedAt,
    }

    if (!success) {
      output.error =
        forgeResult.stderr.trim() ||
        `forge test --gas-report exited with code ${forgeResult.exitCode}`
    }

    return output
  } catch (error) {
    const classified = classifyForgeError(error, context, "forge gas analysis")
    if (classified) return fail(classified)

    const maybeError = error as Error
    return fail(maybeError.message || "forge gas analysis failed")
  }
}

export const gasAnalysisTool = tool({
  description:
    "Run forge test --gas-report, parse per-function gas metrics, and identify hotspots.",
  args: {
    target: tool.schema.string().optional(),
    threshold: tool.schema.number().default(100000),
  },
  async execute(args, context) {
    const result = await executeGasAnalysis(args, context)
    return JSON.stringify(result)
  },
})
