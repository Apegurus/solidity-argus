import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { findMatches, type LoadedPattern } from "./pattern-checker-tool"
import { extractDetectionRulesFromSkills } from "./pattern-loader"

const CORPUS_DIR = join(import.meta.dir, "../../tests/fixtures/pattern-corpus")
const SKILLS_DIR = join(dirname(dirname(import.meta.dir)), "skills")

function readFixture(name: string): string {
  return readFileSync(join(CORPUS_DIR, name), "utf-8")
}

function matchesRegex(content: string, regexSource: string): boolean {
  return new RegExp(regexSource).test(content)
}

const { patterns: skillPatterns } = extractDetectionRulesFromSkills(SKILLS_DIR)

type CorpusCase = {
  patternName: string
  regex: string
  positive: string
  negative: string
}

// Regex strings from skill detection_rules, tested against positive/negative fixture files
const CORPUS: CorpusCase[] = [
  {
    patternName: "reentrancy-eth-transfer",
    regex: "\\.call\\{value:",
    positive: "reentrancy-eth-positive.sol",
    negative: "reentrancy-eth-negative.sol",
  },
  {
    patternName: "cross-function-reentrancy",
    regex: "(external|public)\\s.*\\{[^}]*\\.call",
    positive: "reentrancy-cross-function-positive.sol",
    negative: "reentrancy-cross-function-negative.sol",
  },
  {
    patternName: "stale-price-check",
    regex: "latestRoundData|getPrice",
    positive: "oracle-stale-price-positive.sol",
    negative: "oracle-stale-price-negative.sol",
  },
  {
    patternName: "price-feed-decimals",
    regex: "priceFeed|oracle.*decimals",
    positive: "oracle-manipulation-positive.sol",
    negative: "oracle-manipulation-negative.sol",
  },
  {
    patternName: "unchecked-flash-return",
    regex: "flashLoan|flashBorrow",
    positive: "flash-loan-unchecked-positive.sol",
    negative: "flash-loan-unchecked-negative.sol",
  },
  {
    patternName: "unprotected-initialize",
    regex: "function\\s+initialize",
    positive: "access-control-initialize-positive.sol",
    negative: "access-control-initialize-negative.sol",
  },
  {
    patternName: "inflation-attack",
    regex: "deposit.*totalSupply.*==.*0|convertToShares.*totalSupply",
    positive: "erc4626-inflation-positive.sol",
    negative: "erc4626-inflation-negative.sol",
  },
  {
    patternName: "storage-collision",
    regex: "delegatecall|IMPLEMENTATION_SLOT",
    positive: "proxy-collision-positive.sol",
    negative: "proxy-collision-negative.sol",
  },
  {
    patternName: "uninitialized-proxy",
    regex: "_disableInitializers|initializer",
    positive: "proxy-uninitialized-positive.sol",
    negative: "proxy-uninitialized-negative.sol",
  },
  {
    patternName: "replay-attack",
    regex: "ecrecover|ECDSA\\.recover",
    positive: "signature-replay-positive.sol",
    negative: "signature-replay-negative.sol",
  },
  {
    patternName: "sig-malleability",
    regex: "ecrecover",
    positive: "signature-malleability-positive.sol",
    negative: "signature-malleability-negative.sol",
  },
  {
    patternName: "reentrancy (builtin)",
    regex: "\\.call\\{value:",
    positive: "unchecked-return-positive.sol",
    negative: "unchecked-return-negative.sol",
  },
  {
    patternName: "tx-origin-auth (builtin)",
    regex: "tx\\.origin",
    positive: "tx-origin-positive.sol",
    negative: "tx-origin-negative.sol",
  },
  {
    patternName: "delegatecall (builtin)",
    regex: "\\.delegatecall\\(",
    positive: "delegatecall-positive.sol",
    negative: "delegatecall-negative.sol",
  },
  {
    patternName: "selfdestruct (builtin)",
    regex: "selfdestruct\\(|suicide\\(",
    positive: "selfdestruct-positive.sol",
    negative: "selfdestruct-negative.sol",
  },
  {
    patternName: "missing-slippage-protection",
    regex: "swap\\w*\\([^)]*,\\s*0\\s*[,)]",
    positive: "frontrunning-vulnerable.sol",
    negative: "frontrunning-safe.sol",
  },
  {
    patternName: "missing-deadline",
    regex: "\\bdeadline\\s*[:=]\\s*block\\.timestamp\\b",
    positive: "frontrunning-vulnerable.sol",
    negative: "frontrunning-safe.sol",
  },
  {
    patternName: "predictable-randomness",
    regex: "keccak256\\(abi\\.encodePacked\\(block\\.(timestamp|number|prevrandao)",
    positive: "frontrunning-vulnerable.sol",
    negative: "frontrunning-safe.sol",
  },
  {
    patternName: "commit-reveal-weakness",
    regex: "function\\s+commit\\s*\\(\\s*(uint\\d*|int\\d*|address|bool|string)\\s",
    positive: "frontrunning-vulnerable.sol",
    negative: "frontrunning-safe.sol",
  },
  {
    patternName: "pyth-unsafe-price-read",
    regex: "getPriceUnsafe\\s*\\(",
    positive: "pyth-unsafe-positive.sol",
    negative: "pyth-safe-negative.sol",
  },
]

describe("Pattern Test Corpus", () => {
  it("loaded ≥20 skill detection rules from skills/", () => {
    expect(skillPatterns.length).toBeGreaterThanOrEqual(20)
  })

  it("corpus directory contains ≥30 fixture files", () => {
    const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".sol"))
    expect(files.length).toBeGreaterThanOrEqual(30)
  })

  it("all fixtures have SPDX license and pragma", () => {
    const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".sol"))
    for (const file of files) {
      const content = readFixture(file)
      expect(content).toContain("SPDX-License-Identifier: MIT")
      expect(content).toContain("pragma solidity ^0.8.0;")
    }
  })

  it("tests ≥10 distinct patterns", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(10)
  })

  for (const entry of CORPUS) {
    describe(entry.patternName, () => {
      it(`triggers on ${entry.positive}`, () => {
        const content = readFixture(entry.positive)
        expect(matchesRegex(content, entry.regex)).toBe(true)
      })

      it(`does NOT trigger on ${entry.negative}`, () => {
        const content = readFixture(entry.negative)
        expect(matchesRegex(content, entry.regex)).toBe(false)
      })
    })
  }

  describe("comment stripping", () => {
    it("does NOT match when keyword appears only in comments and strings", () => {
      const fixture = join(CORPUS_DIR, "comment-only-delegatecall.sol")
      const pattern: LoadedPattern = {
        name: "delegatecall-in-comment",
        category: "delegatecall",
        severity: "High",
        regex: /\.delegatecall\(/,
        description: "Detects delegatecall usage",
      }
      const results = findMatches(fixture, [pattern])
      expect(results).toHaveLength(0)
    })
  })

  describe("scanner rule eligibility", () => {
    it("does NOT match advisory protocol guidance or safe feature use", () => {
      const advisoryRulePrefixes = [
        "concentrated-liquidity-",
        "liquid-staking-restaking-",
        "staking-vesting-",
      ]
      const safeFeatures = [
        "items[index] = amount;",
        "members.add(account);",
        "delete positions[id];",
        "multicall(calls);",
        "scale = price.expo;",
        "function withdraw(uint256 amount) external {",
      ]

      expect(
        skillPatterns.some((pattern) =>
          advisoryRulePrefixes.some((prefix) => pattern.name.startsWith(prefix)),
        ),
      ).toBe(false)

      for (const safeFeature of safeFeatures) {
        expect(skillPatterns.some((pattern) => matchesRegex(safeFeature, pattern.regex))).toBe(
          false,
        )
      }
    })

    it("matches unsafe Pyth reads and unbounded iteration", () => {
      const unsafeExamples = [
        "pyth.getPriceUnsafe(priceId);",
        "for (uint256 i = 0; i < users.length; ++i) {}",
      ]

      for (const unsafeExample of unsafeExamples) {
        expect(skillPatterns.some((pattern) => matchesRegex(unsafeExample, pattern.regex))).toBe(
          true,
        )
      }
    })

    it("does NOT load context-free function/math presence rules", () => {
      const removedRegexSources = [
        "function\\s+\\w+\\s*\\(",
        "function\\s+\\w+\\s*\\([^)]*\\)\\s+(external|public)",
        "mulDiv|roundUp|roundDown|FullMath",
      ]
      const loadedSources = new Set(skillPatterns.map((pattern) => pattern.regex))

      for (const source of removedRegexSources) {
        expect(loadedSources.has(source)).toBe(false)
      }
    })
  })
})
