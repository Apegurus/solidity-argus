import { test, expect } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import {
  patternCheckerTool,
  executePatternCheck,
  type PatternCheckResult,
  type Match,
} from "./pattern-checker-tool";

function createContext(): ToolContext {
  return {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "argus",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: new AbortController().signal,
    metadata() {
      return;
    },
    async ask() {
      return;
    },
  };
}

function getReentrancyMatch(result: PatternCheckResult): Match | undefined {
  return result.sources
    .flatMap((source) => source.matches)
    .find((match) => match.pattern === "reentrancy");
}

test("patternCheckerTool uses tool() helper contract", () => {
  expect(patternCheckerTool.description.length).toBeGreaterThan(0);
  expect(patternCheckerTool.args).toBeDefined();
  expect(typeof patternCheckerTool.execute).toBe("function");
});

test("executePatternCheck detects reentrancy in VulnerableVault fixture", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/vulnerable-vault/src/VulnerableVault.sol",
      patterns: ["reentrancy"],
      include_scvd: true,
    },
    createContext()
  );

  expect(result.target).toContain("VulnerableVault.sol");
  expect(result.patternsChecked).toBe(1);
  expect(result.sources).toHaveLength(1);
  expect(result.sources[0]?.source).toBe("pattern-db");

  const match = getReentrancyMatch(result);
  expect(match).toBeDefined();
  expect(match?.severity).toBe("High");
  expect(match?.description).toContain("reentrancy");
  expect(match?.exploitReference).toContain("DAO hack");
  expect(match?.file.endsWith("VulnerableVault.sol")).toBe(true);
  expect((match?.lines[0] ?? 0) <= 20).toBe(true);
  expect((match?.lines[1] ?? 0) >= 20).toBe(true);
});

test("executePatternCheck filters matches by categories", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/vulnerable-vault/src",
      patterns: ["access-control"],
    },
    createContext()
  );

  expect(result.patternsChecked).toBe(3);
  const matches = result.sources.flatMap((source) => source.matches);
  expect(matches.some((match) => match.pattern === "reentrancy")).toBe(false);
  expect(matches.some((match) => match.pattern === "missing-zero-check")).toBe(false);
});

test("executePatternCheck accepts include_scvd false without changing output shape", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/vulnerable-vault/src/VulnerableVault.sol",
      include_scvd: false,
    },
    createContext()
  );

  expect(result.sources).toHaveLength(1);
  expect(result.sources[0]?.source).toBe("pattern-db");
});

test("executePatternCheck adds SCVD match source when include_scvd=true and index is available", async () => {
  const queriedSwc: string[] = [];
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/vulnerable-vault/src/VulnerableVault.sol",
      patterns: ["reentrancy"],
      include_scvd: true,
    },
    createContext(),
    {
      loadIndexFn: async () => ({
        version: 1,
        lastSync: "2026-02-17T00:00:00.000Z",
        totalFindings: 1,
        entries: [
          {
            id: "SCVD-107-1",
            title: "Reentrancy in withdraw",
            severity: "High",
            swc: ["SWC-107"],
            cwe: ["CWE-841"],
            keywords: ["reentrancy", "withdraw"],
            repoUrl: "https://github.com/example/vault",
          },
        ],
      }),
      searchIndexFn: (index, query) => {
        if (query.swc) {
          queriedSwc.push(query.swc);
        }
        return index.entries.filter((entry) => entry.swc.includes(query.swc ?? ""));
      },
    }
  );

  expect(queriedSwc).toContain("SWC-107");
  expect(result.sources).toHaveLength(2);
  expect(result.sources[1]?.source).toBe("scvd");
  expect(result.sources[1]?.matches).toHaveLength(1);
  expect(result.sources[1]?.matches[0]?.pattern).toBe("SCVD-107-1");
  expect(result.sources[1]?.matches[0]?.file).toBe("https://github.com/example/vault");
});

test("executePatternCheck silently skips SCVD when index is missing", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/vulnerable-vault/src/VulnerableVault.sol",
      patterns: ["reentrancy"],
      include_scvd: true,
    },
    createContext(),
    {
      loadIndexFn: async () => null,
    }
  );

  expect(result.sources).toHaveLength(1);
  expect(result.sources[0]?.source).toBe("pattern-db");
});

test("patternCheckerTool execute returns stringified PatternCheckResult", async () => {
  const payload = await patternCheckerTool.execute(
    {
      target: "tests/fixtures/vulnerable-vault/src/VulnerableVault.sol",
      include_scvd: true,
    },
    createContext()
  );
  const parsed = JSON.parse(payload) as PatternCheckResult;

  expect(parsed.sources[0]?.source).toBe("pattern-db");
  expect(typeof parsed.executionTime).toBe("number");
});

test("executePatternCheck throws when target does not exist", () => {
  return expect(
    executePatternCheck(
      {
        target: "tests/fixtures/vulnerable-vault/src/DoesNotExist.sol",
      },
      createContext()
    )
  ).rejects.toThrow("Target does not exist");
});

test("executePatternCheck throws when no solidity files are found", () => {
  return expect(
    executePatternCheck(
      {
        target: "src/state",
      },
      createContext()
    )
  ).rejects.toThrow("No Solidity files found");
});
