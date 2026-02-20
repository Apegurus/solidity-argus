import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadPatternPacks } from "./pattern-loader";

const CORPUS_DIR = join(import.meta.dir, "../../tests/fixtures/pattern-corpus");
const PATTERNS_DIR = join(import.meta.dir, "../../skills/patterns");

function readFixture(name: string): string {
  return readFileSync(join(CORPUS_DIR, name), "utf-8");
}

function matchesRegex(content: string, regexSource: string): boolean {
  return new RegExp(regexSource).test(content);
}

const yamlPatterns = loadPatternPacks(PATTERNS_DIR);

function yaml(name: string): string {
  const p = yamlPatterns.find((pat) => pat.name === name);
  if (!p) throw new Error(`YAML pattern '${name}' not found in loaded packs`);
  return p.regex;
}

const BUILTIN_REENTRANCY = "\\.call\\{value:";
const BUILTIN_TX_ORIGIN = "tx\\.origin";
const BUILTIN_SELFDESTRUCT = "selfdestruct\\(|suicide\\(";
const BUILTIN_DELEGATECALL = "\\.delegatecall\\(";

type CorpusCase = {
  patternName: string;
  regex: string;
  positive: string;
  negative: string;
};

const CORPUS: CorpusCase[] = [
  {
    patternName: "reentrancy-eth-transfer",
    regex: yaml("reentrancy-eth-transfer"),
    positive: "reentrancy-eth-positive.sol",
    negative: "reentrancy-eth-negative.sol",
  },
  {
    patternName: "cross-function-reentrancy",
    regex: yaml("cross-function-reentrancy"),
    positive: "reentrancy-cross-function-positive.sol",
    negative: "reentrancy-cross-function-negative.sol",
  },

  {
    patternName: "stale-price-check",
    regex: yaml("stale-price-check"),
    positive: "oracle-stale-price-positive.sol",
    negative: "oracle-stale-price-negative.sol",
  },
  {
    patternName: "price-feed-decimals",
    regex: yaml("price-feed-decimals"),
    positive: "oracle-manipulation-positive.sol",
    negative: "oracle-manipulation-negative.sol",
  },

  {
    patternName: "unchecked-flash-return",
    regex: yaml("unchecked-flash-return"),
    positive: "flash-loan-unchecked-positive.sol",
    negative: "flash-loan-unchecked-negative.sol",
  },

  {
    patternName: "missing-access-modifier",
    regex: yaml("missing-access-modifier"),
    positive: "access-control-missing-positive.sol",
    negative: "access-control-missing-negative.sol",
  },
  {
    patternName: "unprotected-initialize",
    regex: yaml("unprotected-initialize"),
    positive: "access-control-initialize-positive.sol",
    negative: "access-control-initialize-negative.sol",
  },

  {
    patternName: "inflation-attack",
    regex: yaml("inflation-attack"),
    positive: "erc4626-inflation-positive.sol",
    negative: "erc4626-inflation-negative.sol",
  },

  {
    patternName: "storage-collision",
    regex: yaml("storage-collision"),
    positive: "proxy-collision-positive.sol",
    negative: "proxy-collision-negative.sol",
  },
  {
    patternName: "uninitialized-proxy",
    regex: yaml("uninitialized-proxy"),
    positive: "proxy-uninitialized-positive.sol",
    negative: "proxy-uninitialized-negative.sol",
  },

  {
    patternName: "replay-attack",
    regex: yaml("replay-attack"),
    positive: "signature-replay-positive.sol",
    negative: "signature-replay-negative.sol",
  },
  {
    patternName: "sig-malleability",
    regex: yaml("sig-malleability"),
    positive: "signature-malleability-positive.sol",
    negative: "signature-malleability-negative.sol",
  },

  {
    patternName: "reentrancy (builtin)",
    regex: BUILTIN_REENTRANCY,
    positive: "unchecked-return-positive.sol",
    negative: "unchecked-return-negative.sol",
  },
  {
    patternName: "tx-origin-auth (builtin)",
    regex: BUILTIN_TX_ORIGIN,
    positive: "tx-origin-positive.sol",
    negative: "tx-origin-negative.sol",
  },
  {
    patternName: "delegatecall (builtin)",
    regex: BUILTIN_DELEGATECALL,
    positive: "delegatecall-positive.sol",
    negative: "delegatecall-negative.sol",
  },
  {
    patternName: "selfdestruct (builtin)",
    regex: BUILTIN_SELFDESTRUCT,
    positive: "selfdestruct-positive.sol",
    negative: "selfdestruct-negative.sol",
  },

  {
    patternName: "missing-slippage-protection",
    regex: yaml("missing-slippage-protection"),
    positive: "frontrunning-vulnerable.sol",
    negative: "frontrunning-safe.sol",
  },
  {
    patternName: "missing-deadline",
    regex: yaml("missing-deadline"),
    positive: "frontrunning-vulnerable.sol",
    negative: "frontrunning-safe.sol",
  },
  {
    patternName: "predictable-randomness",
    regex: yaml("predictable-randomness"),
    positive: "frontrunning-vulnerable.sol",
    negative: "frontrunning-safe.sol",
  },
  {
    patternName: "commit-reveal-weakness",
    regex: yaml("commit-reveal-weakness"),
    positive: "frontrunning-vulnerable.sol",
    negative: "frontrunning-safe.sol",
  },
];

describe("Pattern Test Corpus", () => {
  it("loaded ≥20 YAML patterns from skills/patterns/", () => {
    expect(yamlPatterns.length).toBeGreaterThanOrEqual(20);
  });

  it("corpus directory contains ≥30 fixture files", () => {
    const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".sol"));
    expect(files.length).toBeGreaterThanOrEqual(30);
  });

  it("all fixtures have SPDX license and pragma", () => {
    const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".sol"));
    for (const file of files) {
      const content = readFixture(file);
      expect(content).toContain("SPDX-License-Identifier: MIT");
      expect(content).toContain("pragma solidity ^0.8.0;");
    }
  });

  it("tests ≥10 distinct patterns", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(10);
  });

  for (const entry of CORPUS) {
    describe(entry.patternName, () => {
      it(`triggers on ${entry.positive}`, () => {
        const content = readFixture(entry.positive);
        expect(matchesRegex(content, entry.regex)).toBe(true);
      });

      it(`does NOT trigger on ${entry.negative}`, () => {
        const content = readFixture(entry.negative);
        expect(matchesRegex(content, entry.regex)).toBe(false);
      });
    });
  }
});
