import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, rmSync } from "node:fs";
import type { ToolContext } from "@opencode-ai/plugin";
import {
  slitherTool,
  executeSlitherAnalyze,
  flattenFallback,
  detectViaIr,
  type SlitherRunResult,
  type FlattenFallbackDeps,
} from "./slither-tool";

function createContext(): { context: ToolContext; metadataCalls: Array<{ title?: string }> } {
  const metadataCalls: Array<{ title?: string }> = [];
  const abortController = new AbortController();

  const context: ToolContext = {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "argus",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: abortController.signal,
    metadata(input) {
      metadataCalls.push({ title: input.title });
    },
    async ask() {
      return;
    },
  };

  return { context, metadataCalls };
}

test("slitherTool uses tool() helper contract", () => {
  expect(slitherTool.description.length).toBeGreaterThan(0);
  expect(slitherTool.args).toBeDefined();
  expect(typeof slitherTool.execute).toBe("function");
});

test("executeSlitherAnalyze parses detector JSON and maps findings", async () => {
  const slitherJSON = JSON.stringify({
    success: true,
    error: null,
    results: {
      detectors: [
        {
          check: "reentrancy-eth",
          impact: "High",
          confidence: "Medium",
          description: "Reentrancy vulnerability",
          elements: [
            {
              source_mapping: {
                filename_relative: "src/Vault.sol",
                lines: [10, 15],
              },
            },
          ],
        },
      ],
    },
  });
  const { context, metadataCalls } = createContext();

  const result = await executeSlitherAnalyze(
    { target: "." },
    context,
    async () => ({
      stdout: slitherJSON,
      stderr: "",
      exitCode: 0,
    })
  );

  expect(result.success).toBe(true);
  expect(result.findingsCount).toBe(1);
  expect(result.findings[0]?.check).toBe("reentrancy-eth");
  expect(result.findings[0]?.severity).toBe("High");
  expect(result.findings[0]?.confidence).toBe("Medium");
  expect(result.findings[0]?.file).toBe("src/Vault.sol");
  expect(result.findings[0]?.lines).toEqual([10, 15]);
  expect(result.findings[0]?.source).toBe("slither");
  expect(result.findings[0]?.id.length).toBeGreaterThan(0);
  expect(metadataCalls.length).toBe(1);
  expect(metadataCalls[0]?.title).toContain("Slither");
});

test("executeSlitherAnalyze handles ENOENT when slither is missing", async () => {
  const { context } = createContext();

  const result = await executeSlitherAnalyze({ target: "." }, context, async () => {
    const error = new Error("slither not found") as Error & { code?: string };
    error.code = "ENOENT";
    throw error;
  });

  expect(result.success).toBe(false);
  expect(result.error).toBe("Slither not found. Install with: pip install slither-analyzer");
});

test("executeSlitherAnalyze parses partial findings from non-zero exit JSON", async () => {
  const slitherJSON = JSON.stringify({
    success: false,
    error: "Compilation failed",
    results: {
      detectors: [
        {
          check: "unchecked-transfer",
          impact: "Low",
          confidence: "High",
          description: "Return value not checked",
          elements: [
            {
              source_mapping: {
                filename_relative: "src/Token.sol",
                lines: [22],
              },
            },
          ],
        },
      ],
    },
  });
  const { context } = createContext();

  const result = await executeSlitherAnalyze(
    { target: "." },
    context,
    async () => ({
      stdout: slitherJSON,
      stderr: "stderr compile warning",
      exitCode: 1,
    })
  );

  expect(result.success).toBe(true);
  expect(result.findingsCount).toBe(1);
  expect(result.findings[0]?.severity).toBe("Low");
  expect(result.findings[0]?.lines).toEqual([22, 22]);
  expect(result.errors.length).toBe(3);
  expect(result.errors.some((item) => item.includes("code 1"))).toBe(true);
  expect(result.errors.some((item) => item.includes("Compilation failed"))).toBe(true);
  expect(result.errors.some((item) => item.includes("stderr compile warning"))).toBe(true);
});

test("executeSlitherAnalyze returns parse error for non-JSON output", async () => {
  const { context } = createContext();

  const result = await executeSlitherAnalyze(
    { target: "." },
    context,
    async () => ({
      stdout: "plain text error output",
      stderr: "",
      exitCode: 2,
    })
  );

  expect(result.success).toBe(false);
  expect(result.error).toContain("Slither output parse error:");
});

test("executeSlitherAnalyze forwards optional CLI flags and abort signal", async () => {
  const calls: SlitherRunResult[] = [];
  const { context } = createContext();

  const result = await executeSlitherAnalyze(
    {
      target: "contracts",
      detectors: ["reentrancy-eth", "unchecked-transfer"],
      exclude: ["unused-state"],
      solc_version: "0.8.24",
    },
    context,
    async (command, signal) => {
      expect(command).toEqual([
        "slither",
        "contracts",
        "--json",
        "-",
        "--filter-paths",
        "node_modules",
        "--detect",
        "reentrancy-eth,unchecked-transfer",
        "--exclude-detectors",
        "unused-state",
        "--solc",
        "solc:0.8.24",
      ]);
      expect(signal).toBe(context.abort);
      const response: SlitherRunResult = { stdout: "{\"success\":true,\"results\":{\"detectors\":[]}}", stderr: "", exitCode: 0 };
      calls.push(response);
      return response;
    }
  );

  expect(calls.length).toBe(1);
  expect(result.success).toBe(true);
  expect(result.findingsCount).toBe(0);
});

function createFlattenDeps(overrides: Partial<FlattenFallbackDeps> = {}): FlattenFallbackDeps {
  return {
    runCommand: async () => ({ stdout: '{"success":true,"results":{"detectors":[]}}', stderr: "", exitCode: 0 }),
    hasBinary: () => true,
    ensureSolc: () => true,
    parseSolcVersion: () => "0.8.20",
    extractContractNames: () => ["Vault"],
    execSyncFn: (() => "") as unknown as typeof import("node:child_process").execSync,
    ...overrides,
  };
}

test("flattenFallback returns undefined when forge is missing", async () => {
  const { context } = createContext();
  const deps = createFlattenDeps({ hasBinary: (name) => name !== "forge" });

  const result = await flattenFallback({ target: "/tmp/project" }, context, deps);
  expect(result).toBeUndefined();
});

test("flattenFallback returns undefined when no solc version found", async () => {
  const { context } = createContext();
  const deps = createFlattenDeps({ parseSolcVersion: () => undefined });

  const result = await flattenFallback({ target: "/tmp/project" }, context, deps);
  expect(result).toBeUndefined();
});

test("flattenFallback returns error when solc unavailable and solc-select missing", async () => {
  const { context } = createContext();
  const deps = createFlattenDeps({ ensureSolc: () => false });

  const result = await flattenFallback({ target: "/tmp/project" }, context, deps);
  expect(result).toBeDefined();
  expect(result!.success).toBe(false);
  expect(result!.error).toContain("Flatten fallback requires solc on PATH");
  expect(result!.error).toContain("solc-select install 0.8.20");
});

test("flattenFallback processes flattened files and returns findings", async () => {
  const { context } = createContext();
  const tmpFile = join(tmpdir(), `argus-test-${Date.now()}.sol`);
  writeFileSync(tmpFile, "pragma solidity ^0.8.20;\ncontract Vault { function withdraw() external {} }");

  const slitherJSON = JSON.stringify({
    success: true,
    results: {
      detectors: [{
        check: "reentrancy-eth",
        impact: "High",
        confidence: "High",
        description: "Reentrancy in Vault.withdraw()",
        elements: [{ source_mapping: { filename_relative: "Vault.flat.sol", lines: [10, 20] } }],
      }],
    },
  });

  const deps = createFlattenDeps({
    runCommand: async () => ({ stdout: slitherJSON, stderr: "", exitCode: 0 }),
    execSyncFn: ((cmd: string) => {
      if (typeof cmd === "string" && cmd.startsWith("forge flatten")) return "// flattened content";
      return "";
    }) as unknown as typeof import("node:child_process").execSync,
    extractContractNames: () => ["Vault"],
  });

  try {
    const result = await flattenFallback({ target: tmpFile }, context, deps);
    expect(result).toBeDefined();
    expect(result!.success).toBe(true);
    expect(result!.findingsCount).toBe(1);
    expect(result!.findings[0]?.check).toBe("reentrancy-eth");
    expect(result!.errors[0]).toContain("[flatten-fallback]");
  } finally {
    rmSync(tmpFile, { force: true });
  }
});

test("flattenFallback filters findings to original contract names", async () => {
  const { context } = createContext();
  const tmpFile = join(tmpdir(), `argus-filter-test-${Date.now()}.sol`);
  writeFileSync(tmpFile, "pragma solidity ^0.8.20;\ncontract Vault { function deposit() external {} }");

  const slitherJSON = JSON.stringify({
    success: true,
    results: {
      detectors: [
        {
          check: "reentrancy-eth",
          impact: "High",
          confidence: "High",
          description: "Reentrancy in Vault.withdraw()",
          elements: [{ source_mapping: { filename_relative: "Vault.flat.sol", lines: [10] } }],
        },
        {
          check: "naming-convention",
          impact: "Informational",
          confidence: "High",
          description: "OpenZeppelin ERC20._approve() naming issue",
          elements: [{ source_mapping: { filename_relative: "lib/ERC20.sol", lines: [50] } }],
        },
      ],
    },
  });

  const deps = createFlattenDeps({
    runCommand: async () => ({ stdout: slitherJSON, stderr: "", exitCode: 0 }),
    execSyncFn: ((cmd: string) => {
      if (typeof cmd === "string" && cmd.startsWith("forge flatten")) return "// flattened";
      return "";
    }) as unknown as typeof import("node:child_process").execSync,
    extractContractNames: () => ["Vault"],
  });

  try {
    const result = await flattenFallback({ target: tmpFile }, context, deps);
    expect(result).toBeDefined();
    expect(result!.findingsCount).toBe(1);
    expect(result!.findings[0]?.description).toContain("Vault");
  } finally {
    rmSync(tmpFile, { force: true });
  }
});

test("executeSlitherAnalyze triggers flatten fallback on parse error with crytic_compile stderr", async () => {
  const { context } = createContext();
  let callCount = 0;
  const slitherJSON = JSON.stringify({
    success: true,
    results: {
      detectors: [{
        check: "unchecked-transfer",
        impact: "Medium",
        confidence: "High",
        description: "Unchecked return in Vault.deposit()",
        elements: [{ source_mapping: { filename_relative: "Vault.flat.sol", lines: [5] } }],
      }],
    },
  });

  const result = await executeSlitherAnalyze(
    { target: "/tmp/project" },
    context,
    async (_command) => {
      callCount++;
      if (callCount === 1) {
        return { stdout: "not json", stderr: "crytic_compile error: Contract not found", exitCode: 1 };
      }
      return { stdout: slitherJSON, stderr: "", exitCode: 0 };
    }
  );

  expect(result.success).toBe(false);
  expect(result.error).toContain("Slither output parse error");
});

test("executeSlitherAnalyze does NOT trigger fallback when primary succeeds with findings", async () => {
  const { context } = createContext();
  const slitherJSON = JSON.stringify({
    success: true,
    results: {
      detectors: [{
        check: "reentrancy-eth",
        impact: "High",
        confidence: "High",
        description: "Reentrancy vulnerability",
        elements: [{ source_mapping: { filename_relative: "src/Vault.sol", lines: [10, 15] } }],
      }],
    },
  });

  const result = await executeSlitherAnalyze(
    { target: "." },
    context,
    async () => ({ stdout: slitherJSON, stderr: "", exitCode: 0 })
  );

  expect(result.success).toBe(true);
  expect(result.findingsCount).toBe(1);
  expect(result.findings[0]?.check).toBe("reentrancy-eth");
});

test("executeSlitherAnalyze skips primary run and uses flatten fallback when via_ir is true", async () => {
  const { context } = createContext();
  let primaryCalled = false;

  const result = await executeSlitherAnalyze(
    { target: "/tmp/project", via_ir: true },
    context,
    async (command) => {
      if (command.includes("slither") && !command.some(c => c.includes(".flat.sol"))) {
        primaryCalled = true;
      }
      return { stdout: "{}", stderr: "", exitCode: 1 };
    }
  );

  expect(primaryCalled).toBe(false);
  expect(result.success).toBe(false);
  expect(result.errors.some(e => e.includes("via_ir"))).toBe(true);
});

test("executeSlitherAnalyze runs primary when via_ir is false", async () => {
  const { context } = createContext();
  const slitherJSON = JSON.stringify({
    success: true,
    results: { detectors: [] },
  });

  const result = await executeSlitherAnalyze(
    { target: "/tmp/project", via_ir: false },
    context,
    async () => ({ stdout: slitherJSON, stderr: "", exitCode: 0 })
  );

  expect(result.success).toBe(true);
});

test("detectViaIr returns true for foundry.toml with via_ir = true", () => {
  const tmpDir = join(tmpdir(), `argus-via-ir-${Date.now()}`);
  const { mkdirSync } = require("node:fs");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(join(tmpDir, "foundry.toml"), `[profile.default]\nvia_ir = true\nsolc = "0.8.20"\n`);

  try {
    expect(detectViaIr(tmpDir)).toBe(true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("detectViaIr returns false when no foundry.toml exists", () => {
  expect(detectViaIr("/tmp/nonexistent-dir-" + Date.now())).toBe(false);
});

test("detectViaIr returns false for foundry.toml without via_ir", () => {
  const tmpDir = join(tmpdir(), `argus-via-ir-no-${Date.now()}`);
  const { mkdirSync } = require("node:fs");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(join(tmpDir, "foundry.toml"), `[profile.default]\nsolc = "0.8.20"\n`);

  try {
    expect(detectViaIr(tmpDir)).toBe(false);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("detectViaIr detects via-ir (hyphenated) in foundry.toml", () => {
  const tmpDir = join(tmpdir(), `argus-via-ir-hyph-${Date.now()}`);
  const { mkdirSync } = require("node:fs");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(join(tmpDir, "foundry.toml"), `[profile.default]\nvia-ir = true\n`);

  try {
    expect(detectViaIr(tmpDir)).toBe(true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
