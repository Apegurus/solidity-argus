import { tokenJaccard } from "./similarity"
import { STOPWORDS } from "./stopwords"

export interface ClusterFinding {
  title: string
  severity: string
  description: string
  category: string
  source_pdf: string
  source_name?: string
}

export interface FindingCluster {
  id: number
  category: string
  members: ClusterFinding[]
  medoid: ClusterFinding
  medoidIndex: number
  topTokens: string[]
  avgInternalSimilarity: number
  size: number
}

export interface ClusterConfig {
  linkThreshold: number
  cohesionMinSimilarity: number
  minClusterSize: number
}

export interface ClusterResult {
  clusters: FindingCluster[]
  singletons: ClusterFinding[]
  stats: {
    totalFindings: number
    totalClusters: number
    totalSingletons: number
    categoryCounts: Record<string, number>
    largestCluster: number
    avgClusterSize: number
  }
}

export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
  linkThreshold: 0.6,
  cohesionMinSimilarity: 0.65,
  minClusterSize: 2,
}

class UnionFind {
  parent: number[]
  rank: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, index) => index)
    this.rank = Array.from({ length: n }, () => 0)
  }
  find(x: number): number {
    const parent = this.parent[x] ?? x
    if (parent === x) return x
    const root = this.find(parent)
    this.parent[x] = root
    return root
  }
  union(x: number, y: number): boolean {
    const rootX = this.find(x)
    const rootY = this.find(y)
    if (rootX === rootY) return false
    const rankX = this.rank[rootX] ?? 0
    const rankY = this.rank[rootY] ?? 0
    if (rankX < rankY) {
      this.parent[rootX] = rootY
      return true
    }

    if (rankX > rankY) {
      this.parent[rootY] = rootX
      return true
    }

    this.parent[rootY] = rootX
    this.rank[rootX] = rankX + 1
    return true
  }
  components(): Map<number, number[]> {
    const groups = new Map<number, number[]>()
    for (let index = 0; index < this.parent.length; index += 1) {
      const root = this.find(index)
      const group = groups.get(root) ?? []
      group.push(index)
      groups.set(root, group)
    }
    return groups
  }
}

function tokenize(text: string): string[] {
  if (!text) return []
  const deduped = new Set<string>()
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/g)) {
    if (token.length < 3) continue
    if (STOPWORDS.has(token)) continue
    deduped.add(token)
  }
  return Array.from(deduped)
}

function computeTokenSets(findings: ClusterFinding[]): Set<string>[] {
  return findings.map((finding) => new Set(tokenize(`${finding.title} ${finding.description}`)))
}

function buildSimilarityMatrix(tokenSets: Set<string>[]): number[][] {
  const tokenArrays = tokenSets.map((set) => [...set])
  const matrix: number[][] = Array.from({ length: tokenSets.length }, () =>
    Array.from({ length: tokenSets.length }, () => 0),
  )
  for (let i = 0; i < tokenSets.length; i += 1) {
    const rowI = matrix[i]
    if (rowI) rowI[i] = 1
    for (let j = i + 1; j < tokenSets.length; j += 1) {
      const similarity = tokenJaccard(tokenArrays[i] ?? [], tokenArrays[j] ?? [])
      if (rowI) rowI[j] = similarity
      const rowJ = matrix[j]
      if (rowJ) rowJ[i] = similarity
    }
  }
  return matrix
}

function medoidForMembers(memberIndices: number[], similarityMatrix: number[][]): number {
  if (memberIndices.length === 0) return -1
  if (memberIndices.length === 1) return memberIndices[0] ?? -1
  let bestIndex = memberIndices[0] ?? -1
  let bestAvgSimilarity = -1
  for (const candidateIndex of memberIndices) {
    let total = 0
    for (const otherIndex of memberIndices) {
      if (candidateIndex === otherIndex) continue
      total += similarityMatrix[candidateIndex]?.[otherIndex] ?? 0
    }

    const avg = total / (memberIndices.length - 1)
    if (avg > bestAvgSimilarity) {
      bestAvgSimilarity = avg
      bestIndex = candidateIndex
    }
  }
  return bestIndex
}

function averageInternalSimilarity(memberIndices: number[], similarityMatrix: number[][]): number {
  if (memberIndices.length < 2) return 0
  let total = 0
  let pairs = 0
  for (let i = 0; i < memberIndices.length; i += 1) {
    const left = memberIndices[i] ?? -1

    for (let j = i + 1; j < memberIndices.length; j += 1) {
      const right = memberIndices[j] ?? -1
      total += similarityMatrix[left]?.[right] ?? 0
      pairs += 1
    }
  }
  return total / pairs
}

function topTokensForMembers(memberIndices: number[], tokenSets: Set<string>[]): string[] {
  const counts = new Map<string, number>()
  for (const memberIndex of memberIndices) {
    const tokenSet = tokenSets[memberIndex]
    if (!tokenSet) continue
    for (const token of tokenSet) {
      counts.set(token, (counts.get(token) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .sort((left, right) => {
      const countDelta = right[1] - left[1]
      if (countDelta !== 0) return countDelta
      return left[0].localeCompare(right[0])
    })
    .slice(0, 10)
    .map(([token]) => token)
}

function pushSingletons(
  target: ClusterFinding[],
  bucket: ClusterFinding[],
  indices: number[],
): void {
  for (const index of indices) {
    const finding = bucket[index]
    if (finding) target.push(finding)
  }
}

/**
 * Groups related findings per category using token Jaccard links and
 * union-find connected components, then peels low-cohesion outliers.
 */
export function clusterFindings(
  findings: ClusterFinding[],
  config: ClusterConfig = DEFAULT_CLUSTER_CONFIG,
): ClusterResult {
  const clusters: FindingCluster[] = []
  const singletons: ClusterFinding[] = []
  const categoryCounts: Record<string, number> = {}
  const buckets = new Map<string, ClusterFinding[]>()
  for (const finding of findings) {
    categoryCounts[finding.category] = (categoryCounts[finding.category] ?? 0) + 1
    const bucket = buckets.get(finding.category)
    if (bucket) {
      bucket.push(finding)
    } else {
      buckets.set(finding.category, [finding])
    }
  }
  const orderedCategories = Array.from(buckets.keys()).sort((left, right) =>
    left.localeCompare(right),
  )
  let nextClusterId = 1
  for (const category of orderedCategories) {
    const bucket = buckets.get(category) ?? []
    if (bucket.length < config.minClusterSize) {
      singletons.push(...bucket)
      continue
    }
    const tokenSets = computeTokenSets(bucket)
    const similarityMatrix = buildSimilarityMatrix(tokenSets)
    const uf = new UnionFind(bucket.length)
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        if ((similarityMatrix[i]?.[j] ?? 0) < config.linkThreshold) continue
        uf.union(i, j)
      }
    }
    for (const memberIndices of uf.components().values()) {
      if (memberIndices.length < config.minClusterSize) {
        pushSingletons(singletons, bucket, memberIndices)
        continue
      }
      const initialMedoid = medoidForMembers(memberIndices, similarityMatrix)
      const keptIndices: number[] = []
      const peeledIndices: number[] = []
      for (const index of memberIndices) {
        if (index === initialMedoid) {
          keptIndices.push(index)
          continue
        }
        const similarityToMedoid = similarityMatrix[initialMedoid]?.[index] ?? 0
        if (similarityToMedoid >= config.cohesionMinSimilarity) {
          keptIndices.push(index)
        } else {
          peeledIndices.push(index)
        }
      }
      pushSingletons(singletons, bucket, peeledIndices)
      if (keptIndices.length < config.minClusterSize) {
        pushSingletons(singletons, bucket, keptIndices)
        continue
      }
      const finalMedoid = medoidForMembers(keptIndices, similarityMatrix)
      const members = keptIndices
        .map((index) => bucket[index])
        .filter((finding): finding is ClusterFinding => Boolean(finding))
      if (members.length < config.minClusterSize) {
        singletons.push(...members)
        continue
      }
      const medoidIndex = Math.max(0, keptIndices.indexOf(finalMedoid))
      const medoid = members.at(medoidIndex)
      if (!medoid) throw new Error("Medoid index out of bounds — this should not happen")
      clusters.push({
        id: nextClusterId,
        category,
        members,
        medoid,
        medoidIndex,
        topTokens: topTokensForMembers(keptIndices, tokenSets),
        avgInternalSimilarity: averageInternalSimilarity(keptIndices, similarityMatrix),
        size: members.length,
      })
      nextClusterId += 1
    }
  }
  const largestCluster = clusters.reduce((max, cluster) => Math.max(max, cluster.size), 0)
  const avgClusterSize =
    clusters.length === 0
      ? 0
      : clusters.reduce((total, cluster) => total + cluster.size, 0) / clusters.length
  return {
    clusters,
    singletons,
    stats: {
      totalFindings: findings.length,
      totalClusters: clusters.length,
      totalSingletons: singletons.length,
      categoryCounts,
      largestCluster,
      avgClusterSize,
    },
  }
}
