import { test, expect } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import {
  slitherTool,
  executeSlitherAnalyze,
  type SlitherRunResult,
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
