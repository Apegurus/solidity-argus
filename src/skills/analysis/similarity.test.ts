import { describe, expect, it } from "bun:test"
import { normalizeSkill, type SkillDoc } from "./normalize"
import {
  buildTfidfCorpus,
  computeAllPairs,
  computeSimilarity,
  detectionRuleOverlap,
  shingleJaccard,
  tfidfCosine,
  tokenJaccard,
} from "./similarity"

function makeDoc(overrides: Partial<SkillDoc>): SkillDoc {
  return {
    name: "skill",
    description: "",
    category: undefined,
    detectionRules: [],
    bodyText: "",
    bodyTokens: [],
    nameDescTokens: [],
    ruleTokens: [],
    ...overrides,
  }
}

describe("similarity", () => {
  describe("tokenJaccard", () => {
    it("returns 1.0 for identical sets", () => {
      expect(tokenJaccard(["alpha", "beta"], ["beta", "alpha"])).toBeCloseTo(1)
    })

    it("returns 0.0 for disjoint sets", () => {
      expect(tokenJaccard(["alpha", "beta"], ["gamma", "delta"])).toBeCloseTo(0)
    })

    it("returns correct ratio for partial overlap", () => {
      const value = tokenJaccard(["alpha", "beta", "gamma"], ["gamma", "delta", "epsilon"])
      expect(value).toBeCloseTo(1 / 5)
    })

    it("returns 0.0 for both empty", () => {
      expect(tokenJaccard([], [])).toBe(0)
    })
  })

  describe("shingleJaccard", () => {
    it("returns 1.0 for identical token arrays", () => {
      const tokens = ["safe", "external", "call", "ordering", "checks"]
      expect(shingleJaccard(tokens, tokens)).toBeCloseTo(1)
    })

    it("returns 0.0 for completely different arrays", () => {
      const a = ["safe", "external", "call", "ordering", "checks"]
      const b = ["oracle", "stale", "price", "window", "validation"]
      expect(shingleJaccard(a, b)).toBeCloseTo(0)
    })

    it("returns 0.0 when either array is shorter than n", () => {
      expect(shingleJaccard(["one", "two", "three"], ["one", "two", "three"])).toBe(0)
    })
  })

  describe("buildTfidfCorpus", () => {
    it("counts document frequencies correctly", () => {
      const docs = [
        makeDoc({ name: "a", bodyTokens: ["alpha", "beta", "beta"] }),
        makeDoc({ name: "b", bodyTokens: ["beta", "gamma"] }),
        makeDoc({ name: "c", bodyTokens: [] }),
      ]

      const corpus = buildTfidfCorpus(docs)

      expect(corpus.docCount).toBe(3)
      expect(corpus.docFreq.get("alpha")).toBe(1)
      expect(corpus.docFreq.get("beta")).toBe(2)
      expect(corpus.docFreq.get("gamma")).toBe(1)
    })
  })

  describe("tfidfCosine", () => {
    it("returns 1.0 for identical docs", () => {
      const a = makeDoc({ name: "a", bodyTokens: ["alpha", "beta", "beta"] })
      const b = makeDoc({ name: "b", bodyTokens: ["alpha", "beta", "beta"] })
      const c = makeDoc({ name: "c", bodyTokens: ["gamma"] })
      const corpus = buildTfidfCorpus([a, b, c])

      expect(tfidfCosine(a, b, corpus)).toBeCloseTo(1, 8)
    })

    it("returns 0.0 for completely different docs", () => {
      const a = makeDoc({ name: "a", bodyTokens: ["alpha", "beta"] })
      const b = makeDoc({ name: "b", bodyTokens: ["gamma", "delta"] })
      const corpus = buildTfidfCorpus([a, b])

      expect(tfidfCosine(a, b, corpus)).toBeCloseTo(0, 8)
    })

    it("returns 0.0 when one doc is empty", () => {
      const a = makeDoc({ name: "a", bodyTokens: ["alpha", "beta"] })
      const b = makeDoc({ name: "b", bodyTokens: [] })
      const corpus = buildTfidfCorpus([a, b])

      expect(tfidfCosine(a, b, corpus)).toBe(0)
    })
  })

  describe("detectionRuleOverlap", () => {
    it("returns 1.0 for identical rules", () => {
      const a = makeDoc({
        detectionRules: ["\\.call\\{value:", "tx\\.origin"],
        ruleTokens: ["call", "value", "origin"],
      })
      const b = makeDoc({
        detectionRules: ["\\.call\\{value:", "tx\\.origin"],
        ruleTokens: ["call", "value", "origin"],
      })

      expect(detectionRuleOverlap(a, b)).toBeCloseTo(1)
    })

    it("returns 0.0 for no overlap", () => {
      const a = makeDoc({ detectionRules: ["tx\\.origin"], ruleTokens: ["origin"] })
      const b = makeDoc({ detectionRules: ["delegatecall\\("], ruleTokens: ["delegatecall"] })

      expect(detectionRuleOverlap(a, b)).toBeCloseTo(0)
    })

    it("returns weighted partial overlap score", () => {
      const a = makeDoc({
        detectionRules: ["\\.call\\{value:", "tx\\.origin"],
        ruleTokens: ["call", "value", "origin"],
      })
      const b = makeDoc({
        detectionRules: ["\\.call\\{value:", "delegatecall\\("],
        ruleTokens: ["call", "value", "delegatecall"],
      })

      expect(detectionRuleOverlap(a, b)).toBeCloseTo(0.5)
    })
  })

  describe("computeSimilarity", () => {
    it("returns composite score in [0, 1]", () => {
      const a = makeDoc({
        name: "a",
        bodyTokens: ["alpha", "beta", "gamma", "delta"],
        nameDescTokens: ["reentrancy", "guard"],
        detectionRules: ["\\.call\\{value:"],
        ruleTokens: ["call", "value"],
      })
      const b = makeDoc({
        name: "b",
        bodyTokens: ["alpha", "beta", "zeta", "eta"],
        nameDescTokens: ["reentrancy", "pattern"],
        detectionRules: ["\\.call\\{value:"],
        ruleTokens: ["call", "value"],
      })
      const corpus = buildTfidfCorpus([a, b])

      const score = computeSimilarity(a, b, corpus)

      expect(score.composite).toBeGreaterThanOrEqual(0)
      expect(score.composite).toBeLessThanOrEqual(1)
      expect(score.bodyTfidf).toBeGreaterThanOrEqual(0)
      expect(score.bodyTfidf).toBeLessThanOrEqual(1)
      expect(score.bodyShingle).toBeGreaterThanOrEqual(0)
      expect(score.bodyShingle).toBeLessThanOrEqual(1)
      expect(score.nameDesc).toBeGreaterThanOrEqual(0)
      expect(score.nameDesc).toBeLessThanOrEqual(1)
      expect(score.detectionRules).toBeGreaterThanOrEqual(0)
      expect(score.detectionRules).toBeLessThanOrEqual(1)
    })

    it("uses expected weighted sum", () => {
      const a = makeDoc({
        name: "a",
        bodyTokens: ["alpha", "beta", "gamma", "delta", "epsilon"],
        nameDescTokens: ["oracle", "manipulation"],
        detectionRules: ["stalePrice"],
        ruleTokens: ["staleprice"],
      })
      const b = makeDoc({
        name: "b",
        bodyTokens: ["alpha", "beta", "theta", "lambda", "omega"],
        nameDescTokens: ["oracle", "check"],
        detectionRules: ["stalePrice"],
        ruleTokens: ["staleprice"],
      })
      const corpus = buildTfidfCorpus([a, b])

      const score = computeSimilarity(a, b, corpus)
      const expected =
        score.bodyTfidf * 0.45 +
        score.bodyShingle * 0.2 +
        score.nameDesc * 0.2 +
        score.detectionRules * 0.15

      expect(score.composite).toBeCloseTo(expected, 10)
    })
  })

  describe("computeAllPairs", () => {
    it("returns n*(n-1)/2 pairs", () => {
      const docs = [
        makeDoc({ name: "a", bodyTokens: ["alpha", "beta", "gamma", "delta"] }),
        makeDoc({ name: "b", bodyTokens: ["alpha", "beta", "gamma", "delta"] }),
        makeDoc({ name: "c", bodyTokens: ["oracle", "stale", "price", "window"] }),
        makeDoc({ name: "d", bodyTokens: ["governance", "quorum", "timelock", "delay"] }),
      ]
      const corpus = buildTfidfCorpus(docs)

      const pairs = computeAllPairs(docs, corpus)

      expect(pairs).toHaveLength(6)
    })

    it("sorts pairs by composite descending", () => {
      const docs = [
        makeDoc({
          name: "a",
          bodyTokens: ["alpha", "beta", "gamma", "delta", "epsilon"],
          nameDescTokens: ["x", "y", "z"],
        }),
        makeDoc({
          name: "b",
          bodyTokens: ["alpha", "beta", "gamma", "delta", "epsilon"],
          nameDescTokens: ["x", "y", "z"],
        }),
        makeDoc({
          name: "c",
          bodyTokens: ["oracle", "stale", "price", "window", "validation"],
          nameDescTokens: ["oracle", "safety"],
        }),
      ]
      const corpus = buildTfidfCorpus(docs)

      const pairs = computeAllPairs(docs, corpus)

      for (let i = 1; i < pairs.length; i += 1) {
        const prev = pairs.at(i - 1)
        const curr = pairs.at(i)
        expect(prev).toBeDefined()
        expect(curr).toBeDefined()
        expect(prev?.score.composite).toBeGreaterThanOrEqual(curr?.score.composite ?? 0)
      }
    })
  })

  describe("integration", () => {
    it("scores very similar SKILL.md contents above 0.7", () => {
      const contentA = `---
name: reentrancy-guard-check
description: Detect missing reentrancy guard around withdraw path
category: vulnerability-pattern
detection_rules:
  - regex: '\\.call\\{value:'
    severity: High
---

This check identifies withdraw flows where state updates happen after external calls.
Look for call value sends and missing lock protections in payout paths.`

      const contentB = `---
name: reentrancy-withdraw-protection
description: Detect missing reentrancy guard around withdraw path
category: vulnerability-pattern
detection_rules:
  - regex: '\\.call\\{value:'
    severity: High
---

This check identifies withdraw flows where state updates happen after external calls.
Look for call value sends and missing lock protections in payout paths.`

      const a = normalizeSkill(contentA)
      const b = normalizeSkill(contentB)
      const filler = normalizeSkill(`---
name: filler-skill
description: unrelated corpus anchor
category: reference
---

Governance quorum updates and timelock execution details for proposal scheduling.`)
      expect(a).not.toBeNull()
      expect(b).not.toBeNull()
      expect(filler).not.toBeNull()
      if (!a || !b || !filler) return

      const corpus = buildTfidfCorpus([a, b, filler])
      const score = computeSimilarity(a, b, corpus)

      expect(score.composite).toBeGreaterThan(0.7)
    })

    it("scores unrelated SKILL.md contents below 0.3", () => {
      const contentA = `---
name: bridge-signature-replay
description: Prevent replayed bridge signatures across chains
category: protocol-pattern
detection_rules:
  - regex: 'ecrecover\\('
    severity: High
---

Validate domain separator, chain id, and unique nonce for each bridge authorization.
Reject already consumed message ids and stale signatures.`

      const contentB = `---
name: amm-twap-validation
description: Validate time weighted average prices in AMM oracles
category: protocol-pattern
detection_rules:
  - regex: 'consult\\('
    severity: Medium
---

Ensure price checks use twap windows and staleness thresholds.
Compare spot and averaged values before liquidation or collateral valuation.`

      const a = normalizeSkill(contentA)
      const b = normalizeSkill(contentB)
      const filler = normalizeSkill(`---
name: filler-skill
description: unrelated corpus anchor
category: reference
---

Reentrancy lock ordering checks and external call sequencing guidance.`)
      expect(a).not.toBeNull()
      expect(b).not.toBeNull()
      expect(filler).not.toBeNull()
      if (!a || !b || !filler) return

      const corpus = buildTfidfCorpus([a, b, filler])
      const score = computeSimilarity(a, b, corpus)

      expect(score.composite).toBeLessThan(0.3)
    })
  })
})
