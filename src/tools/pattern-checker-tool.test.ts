import { expect, test } from "bun:test"
import { dirname, join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import {
  executePatternCheck,
  type Match,
  PATTERN_PACK_VERSION,
  type PatternCheckResult,
  patternCheckerTool,
} from "./pattern-checker-tool"
import { extractDetectionRulesFromSkills } from "./pattern-loader"
import { PATTERN_CATEGORIES, type PatternCategory } from "./pattern-schema"

const SKILLS_DIR = join(dirname(dirname(__dirname)), "skills")

function expectedPatternsChecked(categories?: string[]): number {
  const { patterns: skillPatterns } = extractDetectionRulesFromSkills(SKILLS_DIR)

  if (!categories || categories.length === 0) {
    return skillPatterns.length
  }

  const categorySet = new Set(categories)
  return skillPatterns.filter((pattern) => categorySet.has(pattern.category)).length
}

function createContext(): ToolContext {
  const projectDir = process.cwd()
  return {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "argus",
    directory: projectDir,
    worktree: projectDir,
    abort: new AbortController().signal,
    metadata() {
      return
    },
    async ask() {
      return
    },
  }
}

function getReentrancyMatch(result: PatternCheckResult): Match | undefined {
  return result.sources
    .flatMap((source) => source.matches)
    .find((match) => match.category === "reentrancy")
}

test("patternCheckerTool uses tool() helper contract", () => {
  expect(patternCheckerTool.description.length).toBeGreaterThan(0)
  expect(patternCheckerTool.args).toBeDefined()
  expect(typeof patternCheckerTool.execute).toBe("function")
})

test("executePatternCheck detects reentrancy in VulnerableVault fixture", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/vulnerable-vault/src/VulnerableVault.sol",
      patterns: ["reentrancy"],
      include_scvd: true,
    },
    createContext(),
  )

  expect(result.target).toContain("VulnerableVault.sol")
  expect(result.patternsChecked).toBe(expectedPatternsChecked(["reentrancy"]))
  expect(result.sources).toHaveLength(1)
  expect(result.sources[0]?.source).toBe("pattern-db")

  const match = getReentrancyMatch(result)
  expect(match).toBeDefined()
  expect(match?.severity).toBe("High")
  expect(match?.category).toBe("reentrancy")
  expect(match?.file.endsWith("VulnerableVault.sol")).toBe(true)
  expect((match?.lines[0] ?? 0) <= 20).toBe(true)
  expect((match?.lines[1] ?? 0) >= 20).toBe(true)
})

test("executePatternCheck filters matches by categories", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/vulnerable-vault/src",
      patterns: ["access-control"],
    },
    createContext(),
  )

  expect(result.patternsChecked).toBe(expectedPatternsChecked(["access-control"]))
  const matches = result.sources.flatMap((source) => source.matches)
  expect(matches.some((match) => match.pattern === "reentrancy")).toBe(false)
  expect(matches.some((match) => match.pattern === "missing-zero-check")).toBe(false)
})

test("executePatternCheck loads skill detection rules for proxy category", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/pattern-corpus/proxy-uninitialized-positive.sol",
      patterns: ["proxy"],
      include_scvd: false,
    },
    createContext(),
  )

  const proxyMatch = result.sources
    .flatMap((source) => source.matches)
    .find((match) => match.category === "proxy")

  expect(proxyMatch).toBeDefined()
  expect(proxyMatch?.patternSource).toBe("skill")
})

test("executePatternCheck loads SKILL detection rules with skill source", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/pattern-corpus/unchecked-return-positive.sol",
      patterns: ["reentrancy"],
      include_scvd: false,
    },
    createContext(),
  )

  const skillMatch = result.sources
    .flatMap((source) => source.matches)
    .find((match) => match.pattern === "reentrancy-rule-1")

  expect(skillMatch).toBeDefined()
  expect(skillMatch?.patternSource).toBe("skill")
})

test("executePatternCheck accepts include_scvd false without changing output shape", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/vulnerable-vault/src/VulnerableVault.sol",
      include_scvd: false,
    },
    createContext(),
  )

  expect(result.sources).toHaveLength(1)
  expect(result.sources[0]?.source).toBe("pattern-db")
})

test("executePatternCheck adds SCVD match source when include_scvd=true and index is available", async () => {
  const queriedSwc: string[] = []
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
          queriedSwc.push(query.swc)
        }
        return index.entries.filter((entry) => entry.swc.includes(query.swc ?? ""))
      },
    },
  )

  expect(queriedSwc).toContain("SWC-107")
  expect(result.sources).toHaveLength(2)
  expect(result.sources[1]?.source).toBe("scvd")
  expect(result.sources[1]?.matches).toHaveLength(1)
  expect(result.sources[1]?.matches[0]?.pattern).toBe("SCVD-107-1")
  expect(result.sources[1]?.matches[0]?.file).toBe("https://github.com/example/vault")
})

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
    },
  )

  expect(result.sources).toHaveLength(1)
  expect(result.sources[0]?.source).toBe("pattern-db")
})

test("patternCheckerTool execute returns stringified PatternCheckResult", async () => {
  const payload = await patternCheckerTool.execute(
    {
      target: "tests/fixtures/vulnerable-vault/src/VulnerableVault.sol",
      include_scvd: true,
    },
    createContext(),
  )
  const parsed = JSON.parse(payload) as PatternCheckResult

  expect(parsed.sources[0]?.source).toBe("pattern-db")
  expect(typeof parsed.executionTime).toBe("number")
})

test("executePatternCheck returns structured error when target does not exist", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/vulnerable-vault/src/DoesNotExist.sol",
    },
    createContext(),
  )
  expect(result).toHaveProperty("success", false)
  expect(result).toHaveProperty("error")
  expect((result as { error: string }).error).toContain("No Solidity files found")
})

test("executePatternCheck returns structured error when no solidity files are found", async () => {
  const result = await executePatternCheck(
    {
      target: "src/state",
    },
    createContext(),
  )

  expect(result.success).toBe(false)
  expect(result.error).toContain("No Solidity files found")
  expect(result.matches).toEqual([])
  expect(result.summary).toEqual({ total: 0, bySeverity: {}, byCategory: {} })
})

test("result includes patternVersion", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/vulnerable-vault/src/VulnerableVault.sol",
      include_scvd: false,
    },
    createContext(),
  )

  expect(result.patternVersion).toBe(PATTERN_PACK_VERSION)
  expect(result.patternVersion).toBe("1.0.0")
})

test("reentrancy matches include patternSource skill and category", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/vulnerable-vault/src/VulnerableVault.sol",
      patterns: ["reentrancy"],
      include_scvd: false,
    },
    createContext(),
  )

  const matches = result.sources
    .flatMap((source) => source.matches)
    .filter((match) => match.category === "reentrancy")

  expect(matches.length).toBeGreaterThan(0)
  for (const match of matches) {
    expect(match.patternSource).toBe("skill")
    expect(match.category).toBe("reentrancy")
  }
})

test("all detection rule matches carry patternSource skill", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/pattern-corpus",
      include_scvd: false,
    },
    createContext(),
  )

  const allMatches = result.sources.flatMap((source) => source.matches)

  expect(allMatches.length).toBeGreaterThan(0)
  for (const match of allMatches) {
    expect(match.patternSource).toBe("skill")
  }
})

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
  ] as const satisfies readonly PatternCategory[]

  const categories: readonly string[] = PATTERN_CATEGORIES
  for (const cat of expected) {
    expect(categories).toContain(cat)
  }
  expect(PATTERN_CATEGORIES).toHaveLength(expected.length)
})

test("PatternCheckResult JSON serialization includes new fields", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/vulnerable-vault/src/VulnerableVault.sol",
      patterns: ["reentrancy"],
      include_scvd: false,
    },
    createContext(),
  )

  const json = JSON.stringify(result)
  const parsed = JSON.parse(json) as PatternCheckResult

  expect(parsed.patternVersion).toBe("1.0.0")
  const match = parsed.sources.flatMap((s) => s.matches).find((m) => m.category === "reentrancy")
  expect(match?.patternSource).toBe("skill")
  expect(match?.category).toBe("reentrancy")
})

test("CATEGORY_TO_SWC has exactly 11 entries (6 existing + 5 new)", async () => {
  const toolPath = join(__dirname, "pattern-checker-tool.ts")
  const content = await Bun.file(toolPath).text()

  const categoryToSwcMatch = content.match(/const CATEGORY_TO_SWC[^}]+}/s)
  expect(categoryToSwcMatch).toBeDefined()

  const categoryToSwcStr = categoryToSwcMatch?.[0]
  expect(categoryToSwcStr).toBeDefined()
  const entries = categoryToSwcStr?.match(/\[\s*"SWC-\d+"/g) || []

  expect(entries.length).toBe(11)
})

test("CATEGORY_TO_SWC maps new categories to correct SWC codes", async () => {
  const toolPath = join(__dirname, "pattern-checker-tool.ts")
  const content = await Bun.file(toolPath).text()

  const categoryToSwcMatch = content.match(/const CATEGORY_TO_SWC[^}]+}/s)
  expect(categoryToSwcMatch).toBeDefined()

  const categoryToSwcStr = categoryToSwcMatch?.[0]
  expect(categoryToSwcStr).toBeDefined()

  expect(categoryToSwcStr).toContain('governance: ["SWC-105", "SWC-106"]')
  expect(categoryToSwcStr).toContain('"front-running": ["SWC-114"]')
  expect(categoryToSwcStr).toContain('"logic-error": ["SWC-101", "SWC-116"]')
  expect(categoryToSwcStr).toContain('"gas-optimization": ["SWC-128"]')
  expect(categoryToSwcStr).toContain('dos: ["SWC-128"]')
})

test("CATEGORY_TO_SWC preserves all 6 existing entries", async () => {
  const toolPath = join(__dirname, "pattern-checker-tool.ts")
  const content = await Bun.file(toolPath).text()

  const categoryToSwcMatch = content.match(/const CATEGORY_TO_SWC[^}]+}/s)
  expect(categoryToSwcMatch).toBeDefined()

  const categoryToSwcStr = categoryToSwcMatch?.[0]
  expect(categoryToSwcStr).toBeDefined()

  expect(categoryToSwcStr).toContain('reentrancy: ["SWC-107"]')
  expect(categoryToSwcStr).toContain('"access-control": ["SWC-105", "SWC-106"]')
  expect(categoryToSwcStr).toContain('"oracle-manipulation": ["SWC-116"]')
  expect(categoryToSwcStr).toContain('delegatecall: ["SWC-112"]')
  expect(categoryToSwcStr).toContain('"signature-replay": ["SWC-121"]')
  expect(categoryToSwcStr).toContain('"integer-overflow": ["SWC-101"]')
})
test("executePatternCheck detects lack-of-precision in logic-error category", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/pattern-corpus/precision-loss-positive.sol",
      patterns: ["logic-error"],
      include_scvd: false,
    },
    createContext(),
  )

  expect(result.success).toBe(true)
  expect(result.patternsChecked).toBe(expectedPatternsChecked(["logic-error"]))

  const allLogicMatches = result.sources.flatMap((source) => source.matches)

  const precisionMatches = allLogicMatches.filter((match) =>
    match.pattern.startsWith("lack-of-precision"),
  )

  expect(precisionMatches.length).toBeGreaterThan(0)

  for (const match of precisionMatches) {
    expect(match.category).toBe("logic-error")
    expect(match.patternSource).toBe("skill")
    expect(match.file.endsWith("precision-loss-positive.sol")).toBe(true)
  }
})

test("executePatternCheck detects precision loss in fee calculation fixture", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/pattern-corpus/precision-loss-fee.sol",
      patterns: ["logic-error"],
      include_scvd: false,
    },
    createContext(),
  )

  expect(result.success).toBe(true)

  const precisionMatches = result.sources
    .flatMap((source) => source.matches)
    .filter((match) => match.pattern.startsWith("lack-of-precision"))

  expect(precisionMatches.length).toBeGreaterThan(0)
  expect(precisionMatches.length).toBe(2)

  const [first, second] = precisionMatches
  expect(first?.category).toBe("logic-error")
  expect(first?.patternSource).toBe("skill")
  expect(first?.file.endsWith("precision-loss-fee.sol")).toBe(true)

  expect(second?.category).toBe("logic-error")
  expect(second?.patternSource).toBe("skill")
  expect(second?.file.endsWith("precision-loss-fee.sol")).toBe(true)
})

test("executePatternCheck does not flag multiplication-first pattern", async () => {
  const result = await executePatternCheck(
    {
      target: "tests/fixtures/pattern-corpus/precision-loss-negative.sol",
      patterns: ["logic-error"],
      include_scvd: false,
    },
    createContext(),
  )

  expect(result.success).toBe(true)

  const precisionMatches = result.sources
    .flatMap((source) => source.matches)
    .filter((match) => match.pattern.startsWith("lack-of-precision"))

  expect(precisionMatches).toHaveLength(0)
})
