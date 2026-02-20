import { describe, expect, it } from "bun:test"
import { clusterFindings, DEFAULT_CLUSTER_CONFIG, type ClusterFinding } from "./cluster"

function makeFinding(overrides: Partial<ClusterFinding>): ClusterFinding {
  return {
    title: "x",
    severity: "medium",
    description: "alpha beta gamma",
    category: "general",
    source_pdf: "sample.pdf",
    ...overrides,
  }
}

describe("cluster", () => {
  it("exposes expected default config", () => {
    expect(DEFAULT_CLUSTER_CONFIG).toEqual({
      linkThreshold: 0.6,
      cohesionMinSimilarity: 0.65,
      minClusterSize: 2,
    })
  })

  it("returns empty result for empty input", () => {
    const result = clusterFindings([])

    expect(result.clusters).toEqual([])
    expect(result.singletons).toEqual([])
    expect(result.stats).toEqual({
      totalFindings: 0,
      totalClusters: 0,
      totalSingletons: 0,
      categoryCounts: {},
      largestCluster: 0,
      avgClusterSize: 0,
    })
  })

  it("treats a single finding as singleton", () => {
    const finding = makeFinding({ title: "single", description: "alpha beta gamma" })
    const result = clusterFindings([finding])

    expect(result.clusters).toHaveLength(0)
    expect(result.singletons).toHaveLength(1)
    expect(result.singletons[0]?.title).toBe("single")
    expect(result.stats.totalSingletons).toBe(1)
  })

  it("clusters two identical findings together", () => {
    const findings = [
      makeFinding({ title: "duplicate", description: "alpha beta gamma" }),
      makeFinding({ title: "duplicate", description: "alpha beta gamma" }),
    ]

    const result = clusterFindings(findings)

    expect(result.clusters).toHaveLength(1)
    expect(result.singletons).toHaveLength(0)

    const cluster = result.clusters[0]
    expect(cluster?.size).toBe(2)
    expect(cluster?.members).toHaveLength(2)
    expect(cluster?.avgInternalSimilarity).toBeCloseTo(1)
    expect(cluster?.medoidIndex).toBeGreaterThanOrEqual(0)
    expect(cluster?.medoidIndex).toBeLessThan(2)
    expect(cluster?.topTokens).toContain("alpha")
    expect(cluster?.topTokens).toContain("beta")
    expect(cluster?.topTokens).toContain("gamma")
  })

  it("keeps completely different findings as singletons", () => {
    const findings = [
      makeFinding({ title: "first", description: "alpha beta gamma" }),
      makeFinding({ title: "second", description: "oracle stale price" }),
    ]

    const result = clusterFindings(findings)

    expect(result.clusters).toHaveLength(0)
    expect(result.singletons).toHaveLength(2)
  })

  it("uses transitive closure to build connected components", () => {
    const findings = [
      makeFinding({ title: "a", description: "alpha beta gamma" }),
      makeFinding({ title: "b", description: "alpha beta gamma delta" }),
      makeFinding({ title: "c", description: "alpha beta delta epsilon" }),
    ]

    const result = clusterFindings(findings, {
      ...DEFAULT_CLUSTER_CONFIG,
      linkThreshold: 0.6,
      cohesionMinSimilarity: 0.6,
    })

    expect(result.clusters).toHaveLength(1)
    expect(result.clusters[0]?.size).toBe(3)
    expect(result.singletons).toHaveLength(0)
  })

  it("separates clusters by category", () => {
    const findings = [
      makeFinding({ title: "r1", category: "reentrancy", description: "alpha beta gamma" }),
      makeFinding({ title: "r2", category: "reentrancy", description: "alpha beta gamma" }),
      makeFinding({ title: "o1", category: "oracle", description: "stale price window" }),
      makeFinding({ title: "o2", category: "oracle", description: "stale price window" }),
    ]

    const result = clusterFindings(findings)
    const categories = result.clusters.map((cluster) => cluster.category).sort()

    expect(result.clusters).toHaveLength(2)
    expect(result.singletons).toHaveLength(0)
    expect(categories).toEqual(["oracle", "reentrancy"])
  })

  it("peels low-cohesion outliers into singletons", () => {
    const findings = [
      makeFinding({ title: "core-a", description: "alpha beta gamma" }),
      makeFinding({ title: "core-b", description: "alpha beta gamma delta" }),
      makeFinding({ title: "outlier", description: "alpha beta delta epsilon" }),
    ]

    const result = clusterFindings(findings)

    expect(result.clusters).toHaveLength(1)
    expect(result.clusters[0]?.size).toBe(2)
    expect(result.singletons).toHaveLength(1)
    expect(result.singletons[0]?.title).toBe("outlier")
  })

  it("selects the most representative medoid in a larger cluster", () => {
    const findings = [
      makeFinding({ title: "center", description: "alpha beta gamma delta epsilon" }),
      makeFinding({ title: "edge-1", description: "alpha beta gamma delta zeta" }),
      makeFinding({ title: "edge-2", description: "alpha beta gamma epsilon eta" }),
      makeFinding({ title: "edge-3", description: "alpha beta delta epsilon theta" }),
    ]

    const result = clusterFindings(findings, {
      ...DEFAULT_CLUSTER_CONFIG,
      linkThreshold: 0.5,
      cohesionMinSimilarity: 0.5,
    })
    const cluster = result.clusters[0]

    expect(result.clusters).toHaveLength(1)
    expect(cluster?.size).toBe(4)
    expect(cluster?.medoid.title).toBe("center")
    expect(cluster?.avgInternalSimilarity).toBeGreaterThanOrEqual(0.5)
  })

  it("respects config overrides for link threshold", () => {
    const findings = [
      makeFinding({ description: "alpha beta gamma" }),
      makeFinding({ description: "alpha beta delta" }),
    ]

    const strict = clusterFindings(findings)
    expect(strict.clusters).toHaveLength(0)

    const relaxed = clusterFindings(findings, {
      ...DEFAULT_CLUSTER_CONFIG,
      linkThreshold: 0.5,
      cohesionMinSimilarity: 0.5,
    })

    expect(relaxed.clusters).toHaveLength(1)
    expect(relaxed.clusters[0]?.size).toBe(2)
    expect(relaxed.singletons).toHaveLength(0)
  })

  it("computes aggregate stats accurately", () => {
    const findings = [
      makeFinding({ category: "access-control", title: "a1", description: "alpha beta gamma" }),
      makeFinding({ category: "access-control", title: "a2", description: "alpha beta gamma" }),
      makeFinding({ category: "access-control", title: "a3", description: "isolated unique signal" }),
      makeFinding({ category: "oracle", title: "o1", description: "oracle stale price" }),
      makeFinding({ category: "oracle", title: "o2", description: "oracle stale price" }),
    ]

    const result = clusterFindings(findings)

    expect(result.stats.totalFindings).toBe(5)
    expect(result.stats.totalClusters).toBe(2)
    expect(result.stats.totalSingletons).toBe(1)
    expect(result.stats.categoryCounts).toEqual({
      "access-control": 3,
      oracle: 2,
    })
    expect(result.stats.largestCluster).toBe(2)
    expect(result.stats.avgClusterSize).toBe(2)
  })

  it("extracts top tokens by frequency across cluster members", () => {
    const findings = [
      makeFinding({ title: "t1", description: "alpha beta gamma" }),
      makeFinding({ title: "t2", description: "alpha beta delta" }),
      makeFinding({ title: "t3", description: "alpha beta epsilon" }),
    ]

    const result = clusterFindings(findings, {
      ...DEFAULT_CLUSTER_CONFIG,
      linkThreshold: 0.5,
      cohesionMinSimilarity: 0.5,
    })

    expect(result.clusters).toHaveLength(1)
    expect(result.clusters[0]?.topTokens.slice(0, 2)).toEqual(["alpha", "beta"])
  })
})
