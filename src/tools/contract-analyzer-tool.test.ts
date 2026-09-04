import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import type { ContractProfile } from "../state/types"
import { contractAnalyzerTool, executeContractAnalyzer } from "./contract-analyzer-tool"

function createContext(
  abortController = new AbortController(),
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "argus",
    directory: tmpdir(),
    worktree: tmpdir(),
    abort: abortController.signal,
    metadata() {
      return
    },
    async ask() {
      return
    },
    ...overrides,
  }
}

function createBaseProfile(): ContractProfile {
  return {
    name: "Vault",
    filePath: "",
    functions: [],
    stateVars: [],
    inheritance: [],
    accessControlPattern: "none",
    externalCalls: [],
    riskIndicators: [],
  }
}

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tempDirs.length = 0
})

test("contractAnalyzerTool uses tool() helper contract", () => {
  expect(contractAnalyzerTool.description.length).toBeGreaterThan(0)
  expect(contractAnalyzerTool.args).toBeDefined()
  expect(typeof contractAnalyzerTool.execute).toBe("function")
})

test("executeContractAnalyzer calls extractContractInfo using basename contract name", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "argus-contract-analyzer-")))
  tempDirs.push(root)

  const contractsDir = join(root, "src", "contracts")
  mkdirSync(contractsDir, { recursive: true })
  writeFileSync(join(root, "foundry.toml"), "[profile.default]\n")

  const filePath = join(contractsDir, "Vault.sol")
  writeFileSync(filePath, "contract Vault { function run() external {} }")

  const calls: Array<{ contractName: string; projectDir: string }> = []
  const result = await executeContractAnalyzer({ file_path: filePath }, createContext(), {
    extractInfo: async (contractName, projectDir) => {
      calls.push({ contractName, projectDir })
      return createBaseProfile()
    },
  })

  expect(calls).toEqual([{ contractName: "Vault", projectDir: root }])
  expect(result.error).toBeUndefined()
})

test("executeContractAnalyzer does not pass executable selection to inspect", async () => {
  const root = mkdtempSync(join(tmpdir(), "argus-contract-analyzer-"))
  tempDirs.push(root)
  writeFileSync(join(root, "foundry.toml"), "[profile.default]\n")
  const filePath = join(root, "Vault.sol")
  writeFileSync(filePath, "contract Vault { function run() external {} }")

  let argumentCount = 0
  await executeContractAnalyzer({ file_path: filePath, project_dir: root }, createContext(), {
    extractInfo: async (...args) => {
      argumentCount = args.length
      return createBaseProfile()
    },
  })

  expect(argumentCount).toBe(2)
})

test("executeContractAnalyzer rejects unsafe Foundry compiler config before inspect", async () => {
  const root = mkdtempSync(join(tmpdir(), "argus-contract-analyzer-unsafe-"))
  tempDirs.push(root)
  const filePath = join(root, "src", "Vault.sol")
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(join(root, "foundry.toml"), '[profile.default]\nsolc = "./tools/solc"\n')
  writeFileSync(filePath, "contract Vault {}")
  let inspected = false

  const result = await executeContractAnalyzer(
    { file_path: filePath, project_dir: root },
    createContext(new AbortController(), { directory: root, worktree: root }),
    {
      extractInfo: async () => {
        inspected = true
        return createBaseProfile()
      },
    },
  )

  expect(inspected).toBe(false)
  expect(result.error).toContain("version-pinned compiler")
})

test("executeContractAnalyzer validates the effective parent Foundry root", async () => {
  const root = mkdtempSync(join(tmpdir(), "argus-contract-analyzer-parent-"))
  tempDirs.push(root)
  const sourceDir = join(root, "src")
  const filePath = join(sourceDir, "Vault.sol")
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(join(root, "foundry.toml"), '[profile.default]\nsolc = "./tools/solc"\n')
  writeFileSync(filePath, "contract Vault {}")
  let inspected = false

  const result = await executeContractAnalyzer(
    { file_path: filePath, project_dir: sourceDir },
    createContext(new AbortController(), { directory: root, worktree: root }),
    {
      extractInfo: async () => {
        inspected = true
        return createBaseProfile()
      },
    },
  )

  expect(inspected).toBe(false)
  expect(result.error).toContain("version-pinned compiler")
})

test("executeContractAnalyzer falls back to declared contract name when basename inspect fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "argus-contract-analyzer-"))
  tempDirs.push(root)

  const filePath = join(root, "contracts", "PositionRouter.sol")
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(join(root, "foundry.toml"), "[profile.default]\n")
  writeFileSync(filePath, "contract Router { function run() external {} }\n")

  const calls: string[] = []
  const result = await executeContractAnalyzer(
    { file_path: filePath, project_dir: root },
    createContext(),
    {
      extractInfo: async (contractName) => {
        calls.push(contractName)
        if (contractName === "PositionRouter") {
          return { ...createBaseProfile(), name: contractName, error: "Failed to inspect ABI" }
        }
        return { ...createBaseProfile(), name: contractName }
      },
    },
  )

  expect(calls).toEqual(["PositionRouter", "Router"])
  expect(result.name).toBe("Router")
  expect(result.error).toBeUndefined()
})

test("executeContractAnalyzer enriches risk indicators from source text and OZ imports", async () => {
  const root = mkdtempSync(join(tmpdir(), "argus-contract-analyzer-"))
  tempDirs.push(root)

  const filePath = join(root, "contracts", "RiskyVault.sol")
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(join(root, "foundry.toml"), "[profile.default]\n")
  writeFileSync(
    filePath,
    [
      'import "@openzeppelin/contracts/access/Ownable.sol";',
      'import "@openzeppelin/contracts/security/ReentrancyGuard.sol";',
      "contract RiskyVault is Ownable, ReentrancyGuard {",
      "  function callExternal(address target, bytes calldata data) external {",
      "    (bool ok,) = target.delegatecall(data);",
      "    require(ok);",
      "  }",
      "  function wipe() external { selfdestruct(payable(msg.sender)); }",
      "  function originOnly() external view returns (bool) { return tx.origin == msg.sender; }",
      "  function lowLevel() external pure returns (uint256 x) { assembly { x := 1 } }",
      "}",
    ].join("\n"),
  )

  const result = await executeContractAnalyzer(
    { file_path: filePath, project_dir: root },
    createContext(),
    {
      extractInfo: async () => ({
        ...createBaseProfile(),
        riskIndicators: ["uses-delegatecall"],
      }),
    },
  )

  expect(result.riskIndicators).toEqual(
    expect.arrayContaining([
      "uses-delegatecall",
      "uses-selfdestruct",
      "uses-assembly",
      "uses-tx-origin",
      "uses-oz-ownable",
      "uses-oz-reentrancy-guard",
    ]),
  )
  expect(result.riskIndicators.filter((item) => item === "uses-delegatecall")).toHaveLength(1)
})

test("executeContractAnalyzer populates externalCalls from Solidity AST", async () => {
  const root = mkdtempSync(join(tmpdir(), "argus-contract-analyzer-"))
  tempDirs.push(root)

  const filePath = join(root, "contracts", "ExternalCalls.sol")
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(join(root, "foundry.toml"), "[profile.default]\n")
  writeFileSync(
    filePath,
    [
      "contract ExternalCalls {",
      "  function ping(address target, bytes calldata data) external {",
      "    (bool okCall,) = target.call(data);",
      "    (bool okDelegate,) = target.delegatecall(data);",
      "    (bool okStatic,) = target.staticcall(data);",
      "    require(okCall && okDelegate && okStatic);",
      "  }",
      "}",
    ].join("\n"),
  )

  const result = await executeContractAnalyzer(
    { file_path: filePath, project_dir: root },
    createContext(),
    {
      extractInfo: async () => ({
        ...createBaseProfile(),
        externalCalls: ["target.call"],
      }),
    },
  )

  expect(result.externalCalls).toEqual(
    expect.arrayContaining(["target.call", "target.delegatecall", "target.staticcall"]),
  )
  expect(result.externalCalls.filter((item) => item === "target.call")).toHaveLength(1)
})

test("executeContractAnalyzer returns structured error when file does not exist", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "argus-contract-analyzer-missing-")))
  tempDirs.push(root)
  const result = await executeContractAnalyzer(
    { file_path: join(root, "does-not-exist", "NotHere.sol") },
    createContext(new AbortController(), { directory: root, worktree: root }),
    {
      extractInfo: async () => createBaseProfile(),
    },
  )

  expect(result.error).toContain("Contract file not found")
  expect(result.functions).toEqual([])
  expect(result.riskIndicators).toEqual([])
})

test("executeContractAnalyzer maps missing forge errors from parser", async () => {
  const root = mkdtempSync(join(tmpdir(), "argus-contract-analyzer-"))
  tempDirs.push(root)

  const filePath = join(root, "contracts", "Vault.sol")
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, "contract Vault {}\n")

  const result = await executeContractAnalyzer(
    { file_path: filePath, project_dir: root },
    createContext(),
    {
      extractInfo: async () => {
        const error = new Error("spawn forge ENOENT") as Error & { code?: string }
        error.code = "ENOENT"
        throw error
      },
    },
  )

  expect(result.error).toBe(
    "Foundry not found. Install: curl -L https://foundry.paradigm.xyz | bash",
  )
})

test("executeContractAnalyzer extracts modifiers from source text", async () => {
  const root = mkdtempSync(join(tmpdir(), "argus-contract-analyzer-"))
  tempDirs.push(root)

  const filePath = join(root, "contracts", "ModVault.sol")
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(join(root, "foundry.toml"), "[profile.default]\n")
  writeFileSync(
    filePath,
    [
      "contract ModVault {",
      "  function withdraw(uint256 amount) external onlyOwner nonReentrant returns (bool) {",
      "    return true;",
      "  }",
      "  function pause() external whenNotPaused {",
      "    // pause logic",
      "  }",
      "  function getBalance() external view returns (uint256) {",
      "    return 0;",
      "  }",
      "  function admin(address a) external onlyRole(ADMIN) {",
      "    // admin logic",
      "  }",
      "}",
    ].join("\n"),
  )

  const result = await executeContractAnalyzer(
    { file_path: filePath, project_dir: root },
    createContext(),
    {
      extractInfo: async () => ({
        ...createBaseProfile(),
        functions: [
          { name: "withdraw", visibility: "external", mutability: "nonpayable", modifiers: [] },
          { name: "pause", visibility: "external", mutability: "nonpayable", modifiers: [] },
          { name: "getBalance", visibility: "external", mutability: "view", modifiers: [] },
          { name: "admin", visibility: "external", mutability: "nonpayable", modifiers: [] },
        ],
      }),
    },
  )

  expect(result.functions[0]?.modifiers).toEqual(["onlyOwner", "nonReentrant"])
  expect(result.functions[1]?.modifiers).toEqual(["whenNotPaused"])
  expect(result.functions[2]?.modifiers).toEqual([])
  expect(result.functions[3]?.modifiers).toEqual(["onlyRole"])
})

test("executeContractAnalyzer retains empty modifiers when function not found in source", async () => {
  const root = mkdtempSync(join(tmpdir(), "argus-contract-analyzer-"))
  tempDirs.push(root)

  const filePath = join(root, "contracts", "Minimal.sol")
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(join(root, "foundry.toml"), "[profile.default]\n")
  writeFileSync(filePath, "contract Minimal {}\n")

  const result = await executeContractAnalyzer(
    { file_path: filePath, project_dir: root },
    createContext(),
    {
      extractInfo: async () => ({
        ...createBaseProfile(),
        functions: [
          { name: "missing", visibility: "external", mutability: "nonpayable", modifiers: [] },
        ],
      }),
    },
  )

  expect(result.functions[0]?.modifiers).toEqual([])
})

test("executeContractAnalyzer supports context abort", async () => {
  const root = mkdtempSync(join(tmpdir(), "argus-contract-analyzer-"))
  tempDirs.push(root)

  const filePath = join(root, "contracts", "Vault.sol")
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, "contract Vault {}\n")

  const abortController = new AbortController()
  abortController.abort()
  const abortedBeforeStart = await executeContractAnalyzer(
    { file_path: filePath, project_dir: root },
    createContext(abortController),
    {
      extractInfo: async () => createBaseProfile(),
    },
  )

  expect(abortedBeforeStart.error).toBe("contract analysis aborted")

  const delayedAbortController = new AbortController()
  const delayedContext = createContext(delayedAbortController)
  const pending = executeContractAnalyzer(
    { file_path: filePath, project_dir: root },
    delayedContext,
    {
      extractInfo: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return createBaseProfile()
      },
    },
  )
  delayedAbortController.abort()

  const abortedMidway = await pending
  expect(abortedMidway.error).toBe("contract analysis aborted")
})
