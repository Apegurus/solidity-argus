import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { ToolContext } from "@opencode-ai/plugin";
import { contractAnalyzerTool, executeContractAnalyzer } from "./contract-analyzer-tool";
import type { ContractProfile } from "../state/types";

function createContext(abortController = new AbortController()): ToolContext {
  return {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "argus",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: abortController.signal,
    metadata() {
      return;
    },
    async ask() {
      return;
    },
  };
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
  };
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

test("contractAnalyzerTool uses tool() helper contract", () => {
  expect(contractAnalyzerTool.description.length).toBeGreaterThan(0);
  expect(contractAnalyzerTool.args).toBeDefined();
  expect(typeof contractAnalyzerTool.execute).toBe("function");
});

test("executeContractAnalyzer calls extractContractInfo using basename contract name", async () => {
  const root = mkdtempSync(join(tmpdir(), "argus-contract-analyzer-"));
  tempDirs.push(root);

  const contractsDir = join(root, "src", "contracts");
  mkdirSync(contractsDir, { recursive: true });
  writeFileSync(join(root, "foundry.toml"), "[profile.default]\n");

  const filePath = join(contractsDir, "Vault.sol");
  writeFileSync(filePath, "contract Vault { function run() external {} }");

  const calls: Array<{ contractName: string; projectDir: string }> = [];
  const result = await executeContractAnalyzer(
    { file_path: filePath },
    createContext(),
    {
      extractInfo: async (contractName, projectDir) => {
        calls.push({ contractName, projectDir });
        return createBaseProfile();
      },
    }
  );

  expect(calls).toEqual([{ contractName: "Vault", projectDir: root }]);
  expect(result.error).toBeUndefined();
});

test("executeContractAnalyzer enriches risk indicators from source text and OZ imports", async () => {
  const root = mkdtempSync(join(tmpdir(), "argus-contract-analyzer-"));
  tempDirs.push(root);

  const filePath = join(root, "contracts", "RiskyVault.sol");
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(join(root, "foundry.toml"), "[profile.default]\n");
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
    ].join("\n")
  );

  const result = await executeContractAnalyzer(
    { file_path: filePath, project_dir: root },
    createContext(),
    {
      extractInfo: async () => ({
        ...createBaseProfile(),
        riskIndicators: ["uses-delegatecall"],
      }),
    }
  );

  expect(result.riskIndicators).toEqual(
    expect.arrayContaining([
      "uses-delegatecall",
      "uses-selfdestruct",
      "uses-assembly",
      "uses-tx-origin",
      "uses-oz-ownable",
      "uses-oz-reentrancy-guard",
    ])
  );
  expect(result.riskIndicators.filter((item) => item === "uses-delegatecall")).toHaveLength(1);
});

test("executeContractAnalyzer returns structured error when file does not exist", async () => {
  const result = await executeContractAnalyzer(
    { file_path: "/tmp/does-not-exist/NotHere.sol" },
    createContext(),
    {
      extractInfo: async () => createBaseProfile(),
    }
  );

  expect(result.error).toContain("Contract file not found");
  expect(result.functions).toEqual([]);
  expect(result.riskIndicators).toEqual([]);
});

test("executeContractAnalyzer maps missing forge errors from parser", async () => {
  const root = mkdtempSync(join(tmpdir(), "argus-contract-analyzer-"));
  tempDirs.push(root);

  const filePath = join(root, "contracts", "Vault.sol");
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, "contract Vault {}\n");

  const result = await executeContractAnalyzer(
    { file_path: filePath, project_dir: root },
    createContext(),
    {
      extractInfo: async () => {
        const error = new Error("spawn forge ENOENT") as Error & { code?: string };
        error.code = "ENOENT";
        throw error;
      },
    }
  );

  expect(result.error).toBe("Foundry not found. Install: curl -L https://foundry.paradigm.xyz | bash");
});

test("executeContractAnalyzer supports context abort", async () => {
  const root = mkdtempSync(join(tmpdir(), "argus-contract-analyzer-"));
  tempDirs.push(root);

  const filePath = join(root, "contracts", "Vault.sol");
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, "contract Vault {}\n");

  const abortController = new AbortController();
  abortController.abort();
  const abortedBeforeStart = await executeContractAnalyzer(
    { file_path: filePath, project_dir: root },
    createContext(abortController),
    {
      extractInfo: async () => createBaseProfile(),
    }
  );

  expect(abortedBeforeStart.error).toBe("contract analysis aborted");

  const delayedAbortController = new AbortController();
  const delayedContext = createContext(delayedAbortController);
  const pending = executeContractAnalyzer(
    { file_path: filePath, project_dir: root },
    delayedContext,
    {
      extractInfo: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return createBaseProfile();
      },
    }
  );
  delayedAbortController.abort();

  const abortedMidway = await pending;
  expect(abortedMidway.error).toBe("contract analysis aborted");
});
