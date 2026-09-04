import type { SkillDoc } from "./normalize"

export interface SimilarityScore {
  composite: number
  bodyTfidf: number
  bodyShingle: number
  nameDesc: number
  detectionRules: number
}

export interface SimilarityPair {
  skillA: string
  skillB: string
  score: SimilarityScore
}

export interface TfidfCorpus {
  docCount: number
  docFreq: Map<string, number>
}

// Composite similarity weights (sum to 1.0). Hand-tuned, not learned: body TF-IDF
// cosine dominates, with shingle / name-desc / detection-rule signals as
// tie-breakers. Retune against tests/eval/ duplicate-detection recall, not by feel.
const BODY_TFIDF_WEIGHT = 0.45
const BODY_SHINGLE_WEIGHT = 0.2
const NAME_DESC_WEIGHT = 0.2
const DETECTION_RULES_WEIGHT = 0.15

// detectionRuleOverlap blends exact rule-set overlap with token-level overlap.
const RULE_EXACT_MATCH_WEIGHT = 0.6
const RULE_TOKEN_OVERLAP_WEIGHT = 0.4

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function getTokenCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}

function buildTfIdfVector(doc: SkillDoc, corpus: TfidfCorpus): Map<string, number> {
  const vector = new Map<string, number>()
  const totalTokens = doc.bodyTokens.length
  const docCount = corpus.docCount

  if (totalTokens === 0 || docCount === 0) {
    return vector
  }

  const tokenCounts = getTokenCounts(doc.bodyTokens)

  for (const [token, count] of tokenCounts) {
    const df = corpus.docFreq.get(token)
    if (!df || df <= 0) continue

    const tf = count / totalTokens
    const idf = Math.log(docCount / df)
    const weight = tf * idf
    if (weight === 0) continue

    vector.set(token, weight)
  }

  return vector
}

function dotProduct(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0

  let dot = 0
  const [small, large] = a.size < b.size ? [a, b] : [b, a]
  for (const [token, weight] of small) {
    dot += weight * (large.get(token) ?? 0)
  }

  return dot
}

function vectorNorm(vector: Map<string, number>): number {
  let sumSquares = 0
  for (const weight of vector.values()) {
    sumSquares += weight * weight
  }
  return Math.sqrt(sumSquares)
}

function buildShingleSet(tokens: string[], n: number): Set<string> {
  const shingles = new Set<string>()
  if (tokens.length < n || n <= 0) return shingles

  for (let i = 0; i <= tokens.length - n; i += 1) {
    shingles.add(tokens.slice(i, i + n).join(" "))
  }

  return shingles
}

function setIntersectionSize<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0

  let count = 0
  const [small, large] = a.size < b.size ? [a, b] : [b, a]
  for (const value of small) {
    if (large.has(value)) count += 1
  }
  return count
}

function normalizeRegex(rule: string): string {
  return rule.replace(/\s+/g, " ").trim()
}

export function buildTfidfCorpus(docs: SkillDoc[]): TfidfCorpus {
  const docFreq = new Map<string, number>()

  for (const doc of docs) {
    const uniqueTokens = new Set(doc.bodyTokens)
    for (const token of uniqueTokens) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1)
    }
  }

  return {
    docCount: docs.length,
    docFreq,
  }
}

export function tfidfCosine(a: SkillDoc, b: SkillDoc, corpus: TfidfCorpus): number {
  const vectorA = buildTfIdfVector(a, corpus)
  const vectorB = buildTfIdfVector(b, corpus)
  if (vectorA.size === 0 || vectorB.size === 0) return 0

  const normA = vectorNorm(vectorA)
  const normB = vectorNorm(vectorB)
  if (normA === 0 || normB === 0) return 0

  const similarity = dotProduct(vectorA, vectorB) / (normA * normB)
  return clamp01(similarity)
}

export function shingleJaccard(a: string[], b: string[], n: number = 4): number {
  const setA = buildShingleSet(a, n)
  const setB = buildShingleSet(b, n)
  if (setA.size === 0 && setB.size === 0) return 0

  const intersection = setIntersectionSize(setA, setB)
  const union = setA.size + setB.size - intersection
  if (union === 0) return 0

  return clamp01(intersection / union)
}

export function tokenJaccard(a: string[], b: string[]): number {
  const setA = new Set(a)
  const setB = new Set(b)
  if (setA.size === 0 && setB.size === 0) return 0

  const intersection = setIntersectionSize(setA, setB)
  const union = setA.size + setB.size - intersection
  if (union === 0) return 0

  return clamp01(intersection / union)
}

export function detectionRuleOverlap(a: SkillDoc, b: SkillDoc): number {
  const normalizedA = a.detectionRules.map(normalizeRegex)
  const normalizedB = b.detectionRules.map(normalizeRegex)
  const setA = new Set(normalizedA)
  const setB = new Set(normalizedB)

  const maxRuleCount = Math.max(normalizedA.length, normalizedB.length)
  const sharedExact = setIntersectionSize(setA, setB)
  const exactMatch = maxRuleCount === 0 ? 0 : sharedExact / maxRuleCount
  const tokenOverlap = tokenJaccard(a.ruleTokens, b.ruleTokens)

  return clamp01(exactMatch * RULE_EXACT_MATCH_WEIGHT + tokenOverlap * RULE_TOKEN_OVERLAP_WEIGHT)
}

export function computeSimilarity(a: SkillDoc, b: SkillDoc, corpus: TfidfCorpus): SimilarityScore {
  const bodyTfidf = clamp01(tfidfCosine(a, b, corpus))
  const bodyShingle = clamp01(shingleJaccard(a.bodyTokens, b.bodyTokens, 4))
  const nameDesc = clamp01(tokenJaccard(a.nameDescTokens, b.nameDescTokens))
  const detectionRules = clamp01(detectionRuleOverlap(a, b))

  const composite = clamp01(
    bodyTfidf * BODY_TFIDF_WEIGHT +
      bodyShingle * BODY_SHINGLE_WEIGHT +
      nameDesc * NAME_DESC_WEIGHT +
      detectionRules * DETECTION_RULES_WEIGHT,
  )

  return {
    composite,
    bodyTfidf,
    bodyShingle,
    nameDesc,
    detectionRules,
  }
}

export function computeAllPairs(docs: SkillDoc[], corpus: TfidfCorpus): SimilarityPair[] {
  const pairs: SimilarityPair[] = []

  for (let i = 0; i < docs.length; i += 1) {
    const skillA = docs[i]
    if (!skillA) continue

    for (let j = i + 1; j < docs.length; j += 1) {
      const skillB = docs[j]
      if (!skillB) continue

      pairs.push({
        skillA: skillA.name,
        skillB: skillB.name,
        score: computeSimilarity(skillA, skillB, corpus),
      })
    }
  }

  pairs.sort((left, right) => right.score.composite - left.score.composite)
  return pairs
}
