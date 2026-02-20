import { test, expect } from "bun:test";
import { dirname, join } from "node:path";
import type { ToolContext } from "@opencode-ai/plugin";
import {
  patternCheckerTool,
  executePatternCheck,
  PATTERN_PACK_VERSION,
  type PatternCheckResult,
  type Match,
} from "./pattern-checker-tool";
import { PATTERN_CATEGORIES, type PatternCategory } from "./pattern-schema";
import {
  extractDetectionRulesFromSkills,
  loadPatternPacks,
} from "./pattern-loader";

const BUILTIN_CATEGORIES: string[] = [];
const SKILLS_DIR = join(dirname(dirname(__dirname)), "skills");
const YAML_PATTERNS_DIR = join(SKILLS_DIR, "patterns");

function expectedPatternsChecked(categories?: string[]): number {
  const yamlPatterns = loadPatternPacks(YAML_PATTERNS_DIR);
  const skillPatterns = extractDetectionRulesFromSkills(SKILLS_DIR);

  if (!categories || categories.length === 0) {
    return BUILTIN_CATEGORIES.length + yamlPatterns.length + skillPatterns.length;
  }

  const categorySet = new Set(categories);
  const builtinCount = BUILTIN_CATEGORIES.filter((cat) => categorySet.has(cat)).length;
  const yamlCount = yamlPatterns.filter((pattern) => categorySet.has(pattern.category)).length;
  const skillCount = skillPatterns.filter((pattern) => categorySet.has(pattern.category)).length;
  return builtinCount + yamlCount + skillCount;
}

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
    .find((match) => match.pattern === "reentrancy-call-value");
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
  expect(result.patternsChecked).toBe(expectedPatternsChecked(["reentrancy"]));
  expect(result.sources).toHaveLength(1);
  expect(result.sources[0]?.source).toBe("pattern-db");

  const match = getReentrancyMatch(result);
  expect(match).toBeDefined();
  expect(match?.severity).toBe("High");
  expect(match?.description).toContain("reentrancy");
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

  expect(result.patternsChecked).toBe(expectedPatternsChecked(["access-control"]));
  const matches = result.sources.flatMap((source) => source.matches);
  expect(matches.some((match) => match.pattern === "reentrancy")).toBe(false);
  expect(matches.some((match) => match.pattern === "missing-zero-check")).toBe(false);
});

test("executePatternCheck loads YAML pack patterns with yaml source", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/pattern-corpus/proxy-uninitialized-positive.sol",
      patterns: ["proxy"],
      include_scvd: false,
    },
    createContext()
  );

  const yamlMatch = result.sources
    .flatMap((source) => source.matches)
    .find((match) => match.pattern === "uninitialized-proxy");

  expect(yamlMatch).toBeDefined();
  expect(yamlMatch?.patternSource).toBe("yaml");
});

test("executePatternCheck loads SKILL detection rules with skill source", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/pattern-corpus/unchecked-return-positive.sol",
      patterns: ["reentrancy"],
      include_scvd: false,
    },
    createContext()
  );

  const skillMatch = result.sources
    .flatMap((source) => source.matches)
    .find((match) => match.pattern === "reentrancy-rule-1");

  expect(skillMatch).toBeDefined();
  expect(skillMatch?.patternSource).toBe("skill");
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

test("executePatternCheck returns structured error when target does not exist", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/vulnerable-vault/src/DoesNotExist.sol",
    },
    createContext()
  );
  expect(result).toHaveProperty("success", false);
  expect(result).toHaveProperty("error");
  expect((result as { error: string }).error).toContain("No Solidity files found");
});

test("executePatternCheck returns structured error when no solidity files are found", async () => {
  const result = await executePatternCheck(
    {
      target: "src/state",
    },
    createContext()
  );

  expect(result.success).toBe(false);
  expect(result.error).toContain("No Solidity files found");
  expect(result.matches).toEqual([]);
  expect(result.summary).toEqual({ total: 0, bySeverity: {}, byCategory: {} });
});

test("result includes patternVersion", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/vulnerable-vault/src/VulnerableVault.sol",
      include_scvd: false,
    },
    createContext()
  );

  expect(result.patternVersion).toBe(PATTERN_PACK_VERSION);
  expect(result.patternVersion).toBe("1.0.0");
});

test("migrated builtin matches include patternSource yaml and category", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/vulnerable-vault/src/VulnerableVault.sol",
      patterns: ["reentrancy"],
      include_scvd: false,
    },
    createContext()
  );

  const match = getReentrancyMatch(result);
  expect(match).toBeDefined();
  expect(match?.patternSource).toBe("yaml");
  expect(match?.category).toBe("reentrancy");
});

test("all migrated builtin patterns carry patternSource yaml", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/pattern-corpus",
      include_scvd: false,
    },
    createContext()
  );

  const migratedPatternNames = new Set([
    "reentrancy-call-value",
    "tx-origin-auth",
    "selfdestruct-usage",
    "delegatecall-usage",
    "missing-zero-check",
  ]);
  const migratedMatches = result.sources
    .flatMap((source) => source.matches)
    .filter((match) => migratedPatternNames.has(match.pattern));

  expect(migratedMatches.length).toBeGreaterThan(0);
  for (const match of migratedMatches) {
    expect(match.patternSource).toBe("yaml");
  }
});

test("PATTERN_CATEGORIES contains all expected categories", () => {
  const expected = [
    "reentrancy",
    "oracle-manipulation",
    "flash-loan",
    "access-control",
    "erc4626",
    "proxy",
    "signature",
    "dos",
    "front-running",
    "governance",
    "token-standard",
    "gas-optimization",
    "logic-error",
    "delegatecall",
  ] as const satisfies readonly PatternCategory[];

  const categories: readonly string[] = PATTERN_CATEGORIES;
  for (const cat of expected) {
    expect(categories).toContain(cat);
  }
  expect(PATTERN_CATEGORIES).toHaveLength(expected.length);
});

test("PatternCheckResult JSON serialization includes new fields", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/vulnerable-vault/src/VulnerableVault.sol",
      patterns: ["reentrancy"],
      include_scvd: false,
    },
    createContext()
  );

  const json = JSON.stringify(result);
  const parsed = JSON.parse(json) as PatternCheckResult;

  expect(parsed.patternVersion).toBe("1.0.0");
  const match = parsed.sources.flatMap((s) => s.matches).find((m) => m.pattern === "reentrancy-call-value");
  expect(match?.patternSource).toBe("yaml");
  expect(match?.category).toBe("reentrancy");
});

// --- Builtin migration tests ---

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { PatternPackSchema } from "./pattern-schema";

test("builtins.yaml loads and validates against PatternPackSchema", () => {
  const builtinsPath = join(YAML_PATTERNS_DIR, "builtins.yaml");
  const raw = readFileSync(builtinsPath, "utf-8");
  const parsed = parseYaml(raw);
  const result = PatternPackSchema.safeParse(parsed);

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.pack_name).toBe("builtins");
  }
});

test("builtins.yaml has exactly 5 patterns", () => {
  const builtinsPath = join(YAML_PATTERNS_DIR, "builtins.yaml");
  const raw = readFileSync(builtinsPath, "utf-8");
  const parsed = parseYaml(raw);
  const result = PatternPackSchema.safeParse(parsed);

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.patterns).toHaveLength(5);
  }
});

test("builtins.yaml regex parity — YAML regexes match same strings as old JS RegExps", () => {
  const builtinsPath = join(YAML_PATTERNS_DIR, "builtins.yaml");
  const raw = readFileSync(builtinsPath, "utf-8");
  const parsed = parseYaml(raw);
  const result = PatternPackSchema.safeParse(parsed);

  expect(result.success).toBe(true);
  if (!result.success) return;

  const byName = new Map(result.data.patterns.map((p) => [p.name, p]));

  // Old JS: /\.call\{value:/
  const reentrancy = byName.get("reentrancy-call-value");
  expect(reentrancy).toBeDefined();
  expect(new RegExp(reentrancy!.regex).test('to.call{value: amount}("")')).toBe(true);
  expect(new RegExp(reentrancy!.regex).test("transfer(to, amount)")).toBe(false);

  // Old JS: /tx\.origin/
  const txOrigin = byName.get("tx-origin-auth");
  expect(txOrigin).toBeDefined();
  expect(new RegExp(txOrigin!.regex).test("require(tx.origin == owner)")).toBe(true);
  expect(new RegExp(txOrigin!.regex).test("require(msg.sender == owner)")).toBe(false);

  // Old JS: /selfdestruct\(|suicide\(/
  const selfdestructPat = byName.get("selfdestruct-usage");
  expect(selfdestructPat).toBeDefined();
  expect(new RegExp(selfdestructPat!.regex).test("selfdestruct(payable(owner))")).toBe(true);
  expect(new RegExp(selfdestructPat!.regex).test("suicide(owner)")).toBe(true);
  expect(new RegExp(selfdestructPat!.regex).test("transfer(owner)")).toBe(false);

  // Old JS: /\.delegatecall\(/
  const delegatecall = byName.get("delegatecall-usage");
  expect(delegatecall).toBeDefined();
  expect(new RegExp(delegatecall!.regex).test("target.delegatecall(data)")).toBe(true);
  expect(new RegExp(delegatecall!.regex).test("target.call(data)")).toBe(false);

  // Old JS: /address\(0\)/
  const zeroCheck = byName.get("missing-zero-check");
  expect(zeroCheck).toBeDefined();
  expect(new RegExp(zeroCheck!.regex).test("require(addr != address(0))")).toBe(true);
  expect(new RegExp(zeroCheck!.regex).test("require(addr != address(1))")).toBe(false);
});

test("CATEGORY_TO_SWC has exactly 11 entries (6 existing + 5 new)", async () => {
  const toolPath = join(__dirname, "pattern-checker-tool.ts");
  const content = await Bun.file(toolPath).text();
  
  const categoryToSwcMatch = content.match(/const CATEGORY_TO_SWC[^}]+}/s);
  expect(categoryToSwcMatch).toBeDefined();
  
  const categoryToSwcStr = categoryToSwcMatch![0];
  const entries = categoryToSwcStr.match(/\[\s*"SWC-\d+"/g) || [];
  
  expect(entries.length).toBe(11);
});

test("CATEGORY_TO_SWC maps new categories to correct SWC codes", async () => {
  const toolPath = join(__dirname, "pattern-checker-tool.ts");
  const content = await Bun.file(toolPath).text();
  
  const categoryToSwcMatch = content.match(/const CATEGORY_TO_SWC[^}]+}/s);
  expect(categoryToSwcMatch).toBeDefined();
  
  const categoryToSwcStr = categoryToSwcMatch![0];
  
  expect(categoryToSwcStr).toContain('governance: ["SWC-105", "SWC-106"]');
  expect(categoryToSwcStr).toContain('"front-running": ["SWC-114"]');
  expect(categoryToSwcStr).toContain('"logic-error": ["SWC-101", "SWC-116"]');
  expect(categoryToSwcStr).toContain('"gas-optimization": ["SWC-128"]');
  expect(categoryToSwcStr).toContain('dos: ["SWC-128"]');
});

test("CATEGORY_TO_SWC preserves all 6 existing entries", async () => {
  const toolPath = join(__dirname, "pattern-checker-tool.ts");
  const content = await Bun.file(toolPath).text();
  
  const categoryToSwcMatch = content.match(/const CATEGORY_TO_SWC[^}]+}/s);
  expect(categoryToSwcMatch).toBeDefined();
  
  const categoryToSwcStr = categoryToSwcMatch![0];
  
  expect(categoryToSwcStr).toContain('reentrancy: ["SWC-107"]');
  expect(categoryToSwcStr).toContain('"access-control": ["SWC-105", "SWC-106"]');
  expect(categoryToSwcStr).toContain('"oracle-manipulation": ["SWC-116"]');
  expect(categoryToSwcStr).toContain('delegatecall: ["SWC-112"]');
  expect(categoryToSwcStr).toContain('"signature-replay": ["SWC-121"]');
  expect(categoryToSwcStr).toContain('"integer-overflow": ["SWC-101"]');
});
