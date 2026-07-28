import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { getToolResultCache } from "../shared/tool-result-cache"
import {
  collectSolidityFiles,
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

function createContextForDir(projectDir: string): ToolContext {
  return {
    ...createContext(),
    directory: projectDir,
    worktree: projectDir,
  }
}

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

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

test("collectSolidityFiles excludes dependency and build directories (WS-6)", () => {
  const root = mkdtempSync(join(tmpdir(), "argus-scan-"))
  tempDirs.push(root)

  const write = (rel: string): void => {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, "// SPDX-License-Identifier: MIT\ncontract C {}\n")
  }
  write("src/Vault.sol")
  write("contracts/Token.sol")
  write("lib/forge-std/Test.sol")
  write("node_modules/pkg/Dep.sol")
  write(".git/hooks/Weird.sol")
  write("out/Compiled.sol")
  write("cache/Cached.sol")

  const found = collectSolidityFiles(root)
    .map((p) => relative(root, p))
    .sort()

  expect(found).toEqual(["contracts/Token.sol", "src/Vault.sol"])
})

test("collectSolidityFiles caps discovery at maxFiles (WS-6)", () => {
  const root = mkdtempSync(join(tmpdir(), "argus-scan-cap-"))
  tempDirs.push(root)

  mkdirSync(join(root, "src"), { recursive: true })
  for (let i = 0; i < 6; i += 1) {
    writeFileSync(
      join(root, "src", `C${i}.sol`),
      "// SPDX-License-Identifier: MIT\ncontract C {}\n",
    )
  }

  expect(collectSolidityFiles(root, 8, 3)).toHaveLength(3)
  expect(collectSolidityFiles(root, 8, 100)).toHaveLength(6)
})

test("collectSolidityFiles excludes lib/out/cache only at the scan root, not nested (adj_5)", () => {
  const root = mkdtempSync(join(tmpdir(), "argus-scan-nested-"))
  tempDirs.push(root)

  const write = (rel: string): void => {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, "// SPDX-License-Identifier: MIT\ncontract C {}\n")
  }
  write("src/Vault.sol")
  write("src/protocol/lib/MathUtils.sol")
  write("lib/forge-std/Test.sol")
  write("out/Compiled.sol")
  write("src/deep/node_modules/nested/Nested.sol")
  write("src/weird/.git/Hooked.sol")

  const found = collectSolidityFiles(root)
    .map((p) => relative(root, p))
    .sort()

  expect(found).toEqual(["src/Vault.sol", "src/protocol/lib/MathUtils.sol"])
})

test("executePatternCheck refuses a target outside the project directory (adj_4)", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "argus-proj-"))
  const outside = mkdtempSync(join(tmpdir(), "argus-outside-"))
  tempDirs.push(projectDir, outside)
  writeFileSync(join(outside, "Secret.sol"), "// SPDX-License-Identifier: MIT\ncontract S {}\n")

  const result = await executePatternCheck(
    { target: join(outside, "Secret.sol"), patterns: ["reentrancy"] },
    createContextForDir(projectDir),
  )

  expect(result.success).toBe(false)
  expect(result.error ?? "").toContain("escapes the project directory")
  expect(result.sources).toHaveLength(0)
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

test("executePatternCheck scans detection rules from custom resolver roots", async () => {
  const projectDir = join(tmpdir(), `argus-pattern-custom-${Date.now()}`)
  tempDirs.push(projectDir)
  const srcDir = join(projectDir, "src")
  const customSkillsDir = join(projectDir, "custom-skills", "custom-danger")
  mkdirSync(srcDir, { recursive: true })
  mkdirSync(customSkillsDir, { recursive: true })
  writeFileSync(
    join(srcDir, "CustomDanger.sol"),
    [
      "// SPDX-License-Identifier: MIT",
      "pragma solidity ^0.8.20;",
      "contract CustomDanger {",
      "    function run() external { dangerCall(); }",
      "    function dangerCall() internal {}",
      "}",
    ].join("\n"),
  )
  writeFileSync(
    join(customSkillsDir, "SKILL.md"),
    [
      "---",
      "name: custom-danger",
      "description: Custom resolver-root pattern",
      "category: vulnerability-pattern",
      "pattern_category: logic-error",
      "detection_rules:",
      "  - regex: 'dangerCall\\s*\\(' ",
      "    severity: High",
      "    confidence: High",
      "    description: Custom resolver-root rule",
      "---",
      "# Custom Danger",
    ].join("\n"),
  )

  const result = await executePatternCheck(
    {
      target: "src/CustomDanger.sol",
      patterns: ["logic-error"],
      include_scvd: false,
    },
    createContextForDir(projectDir),
    {
      loadConfig: () => ({
        agents: {
          argus: {},
          sentinel: {},
          pythia: {},
          auditSpecialist: {},
          scribe: {},
          themis: {},
        },
        tools: {},
        knowledge: {
          scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
          autoSync: true,
          skillPrecedence: "custom-first",
          customSkillsDir: "custom-skills",
        },
        reporting: {
          confidenceThreshold: 80,
          severityThreshold: "low",
          output_dir: ".opencode/reports/",
        },
        solodit: { enabled: true },
        disabled_hooks: [],
      }),
    },
  )

  const customMatch = result.sources
    .flatMap((source) => source.matches)
    .find((match) => match.pattern === "custom-danger-rule-1")

  expect(customMatch).toBeDefined()
  expect(customMatch?.patternSource).toBe("skill")
  expect(customMatch?.category).toBe("logic-error")
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
  expect(result.sources[1]?.matches[0]?.severity).toBe("Informational")
  expect(result.sources[1]?.matches[0]?.file).toBe("")
  expect(result.sources[1]?.matches[0]?.exploitReference).toBe("https://github.com/example/vault")
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
      full_detail: false,
    },
    createContext(),
  )
  const parsed = JSON.parse(payload) as PatternCheckResult

  expect(parsed.sources[0]?.source).toBe("pattern-db")
  expect(typeof parsed.executionTime).toBe("number")
})

test("patternCheckerTool execute emits compact results by default", async () => {
  const payload = await patternCheckerTool.execute(
    {
      target: "tests/fixtures/vulnerable-vault/src/VulnerableVault.sol",
      include_scvd: true,
      full_detail: false,
    },
    createContext(),
  )
  const parsed = JSON.parse(payload) as PatternCheckResult

  expect(parsed.compact).toBe(true)
  expect(parsed.matchCountsByPattern).toBeDefined()
  expect(payload.length).toBeLessThan(50_000)
})

test("executePatternCheck retains every source match for tool tracking when presentation is compact", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "argus-pattern-compact-"))
  tempDirs.push(projectDir)
  const srcDir = join(projectDir, "src")
  const skillDir = join(projectDir, "custom-skills", "many-danger")
  mkdirSync(srcDir, { recursive: true })
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(srcDir, "ManyDanger.sol"),
    `contract ManyDanger { function run() external { ${"dangerCall();".repeat(101)} } }`,
  )
  writeFileSync(
    join(skillDir, "SKILL.md"),
    [
      "---",
      "name: many-danger",
      "description: Many matches",
      "category: vulnerability-pattern",
      "pattern_category: logic-error",
      "detection_rules:",
      "  - regex: 'dangerCall\\s*\\('",
      "    severity: High",
      "    confidence: High",
      "    description: Match every danger call",
      "---",
    ].join("\n"),
  )

  const result = await executePatternCheck(
    { target: "src/ManyDanger.sol", patterns: ["logic-error"], include_scvd: false },
    createContextForDir(projectDir),
    {
      loadConfig: () => ({
        agents: {
          argus: {},
          sentinel: {},
          pythia: {},
          auditSpecialist: {},
          scribe: {},
          themis: {},
        },
        tools: {},
        knowledge: {
          scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
          autoSync: true,
          skillPrecedence: "custom-first",
          customSkillsDir: "custom-skills",
        },
        reporting: {
          confidenceThreshold: 80,
          severityThreshold: "low",
          output_dir: ".opencode/reports/",
        },
        solodit: { enabled: true },
        disabled_hooks: [],
      }),
    },
  )

  expect(result.matches).toHaveLength(50)
  expect(result.sources[0]?.matches).toHaveLength(101)
})

test("patternCheckerTool keeps full tracking sources out of compact model output", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "argus-pattern-tracking-"))
  tempDirs.push(projectDir)
  const srcDir = join(projectDir, "src")
  const skillDir = join(projectDir, "custom-skills", "many-danger")
  const configDir = join(projectDir, ".argus")
  mkdirSync(srcDir, { recursive: true })
  mkdirSync(skillDir, { recursive: true })
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, "solidity-argus.jsonc"),
    JSON.stringify({
      knowledge: { customSkillsDir: "custom-skills", skillPrecedence: "custom-first" },
    }),
  )
  writeFileSync(
    join(srcDir, "ManyDanger.sol"),
    `contract ManyDanger { function run() external { ${"dangerCall();".repeat(101)} } }`,
  )
  writeFileSync(
    join(skillDir, "SKILL.md"),
    [
      "---",
      "name: many-danger",
      "description: Many matches",
      "category: vulnerability-pattern",
      "pattern_category: logic-error",
      "detection_rules:",
      "  - regex: 'dangerCall\\s*\\('",
      "    severity: High",
      "    confidence: High",
      "    description: Match every danger call",
      "---",
    ].join("\n"),
  )
  const context = { ...createContextForDir(projectDir), sessionID: "session-tracking" }

  const displayed = await patternCheckerTool.execute(
    { target: "src/ManyDanger.sol", include_scvd: false, full_detail: false },
    context,
  )
  const displayedResult = JSON.parse(displayed) as PatternCheckResult
  const tracking = getToolResultCache().takeTrackingMatch(
    context.sessionID,
    "argus_check_patterns",
    displayed,
  )
  const trackingResult = JSON.parse(tracking ?? "{}") as PatternCheckResult

  expect(displayedResult.sources[0]?.matches).toHaveLength(50)
  expect(trackingResult.sources[0]?.matches).toHaveLength(trackingResult.summary.total)
  expect(trackingResult.summary.total).toBeGreaterThan(50)
  expect(displayed.length).toBeLessThan(tracking?.length ?? 0)
})

test("patternCheckerTool execute keeps full detail behind full_detail", async () => {
  const payload = await patternCheckerTool.execute(
    {
      target: "tests/fixtures/vulnerable-vault/src/VulnerableVault.sol",
      include_scvd: false,
      full_detail: true,
    },
    createContext(),
  )
  const parsed = JSON.parse(payload) as PatternCheckResult

  expect(parsed.compact).toBe(false)
  expect(parsed.truncatedMatches).toBe(0)
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

test("executePatternCheck covers Pyth unsafe and safe price-read corpus fixtures", async () => {
  const unsafe = await executePatternCheck(
    {
      target: "tests/fixtures/pattern-corpus/pyth-unsafe-positive.sol",
      patterns: ["oracle-manipulation"],
      include_scvd: false,
    },
    createContext(),
  )

  const unsafePythMatches = unsafe.sources
    .flatMap((source) => source.matches)
    .filter((match) => match.pattern.startsWith("pyth-oracle-validation"))

  expect(unsafePythMatches.some((match) => match.pattern === "pyth-oracle-validation-rule-1")).toBe(
    true,
  )

  const safe = await executePatternCheck(
    {
      target: "tests/fixtures/pattern-corpus/pyth-safe-negative.sol",
      patterns: ["oracle-manipulation"],
      include_scvd: false,
    },
    createContext(),
  )

  const safePythMatches = safe.sources
    .flatMap((source) => source.matches)
    .filter((match) => match.pattern.startsWith("pyth-oracle-validation"))

  expect(safePythMatches).toHaveLength(0)
})
