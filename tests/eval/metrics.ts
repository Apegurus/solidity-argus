import type {
  AggregateMetrics,
  AuditResult,
  FixtureManifest,
  GroundTruthFinding,
  MatchedPair,
  PredictedFinding,
  RunMetrics,
} from "./types"

const FINDING_SEVERITY_WEIGHT: Record<string, number> = {
  Critical: 5,
  High: 4,
  Medium: 3,
  Low: 2,
  Informational: 1,
}

function normalizeFile(file: string): string {
  return file.replace(/^\.\//, "").replace(/^\/+/, "").trim()
}

function linesOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1]
}

function rankMatchQuality(
  p: PredictedFinding,
  g: GroundTruthFinding,
): MatchedPair["matchType"] | null {
  if (normalizeFile(p.file) !== normalizeFile(g.file)) return null
  if (p.lines[0] === g.lines[0] && p.lines[1] === g.lines[1]) return "exact_line"
  if (linesOverlap(p.lines, g.lines)) return "line_overlap"
  return "file_match"
}

function severityFloor(
  sev: PredictedFinding["severity"],
  floor: PredictedFinding["severity"],
): boolean {
  return (FINDING_SEVERITY_WEIGHT[sev] ?? 0) >= (FINDING_SEVERITY_WEIGHT[floor] ?? 0)
}

interface MatchOptions {
  allow_file_match_fallback?: boolean
  severity_floor?: PredictedFinding["severity"]
}

export function matchFindings(
  predicted: PredictedFinding[],
  groundTruth: GroundTruthFinding[],
  options: MatchOptions = {},
): {
  matches: MatchedPair[]
  unmatched_predicted: PredictedFinding[]
  unmatched_ground_truth: GroundTruthFinding[]
} {
  const floor = options.severity_floor

  const filteredPredicted = floor
    ? predicted.filter((p) => severityFloor(p.severity, floor))
    : predicted
  const filteredGroundTruth = floor
    ? groundTruth.filter((g) => severityFloor(g.severity, floor))
    : groundTruth

  const matches: MatchedPair[] = []
  const usedPredicted = new Set<number>()
  const usedGroundTruth = new Set<number>()

  const candidates: Array<{
    pi: number
    gi: number
    quality: MatchedPair["matchType"]
    rank: number
  }> = []
  for (let pi = 0; pi < filteredPredicted.length; pi++) {
    const p = filteredPredicted[pi]
    if (!p) continue
    for (let gi = 0; gi < filteredGroundTruth.length; gi++) {
      const g = filteredGroundTruth[gi]
      if (!g) continue
      const quality = rankMatchQuality(p, g)
      if (!quality) continue
      if (quality === "file_match" && !options.allow_file_match_fallback) continue
      const rank = quality === "exact_line" ? 0 : quality === "line_overlap" ? 1 : 2
      candidates.push({ pi, gi, quality, rank })
    }
  }

  candidates.sort((a, b) => a.rank - b.rank)

  for (const candidate of candidates) {
    if (usedPredicted.has(candidate.pi) || usedGroundTruth.has(candidate.gi)) continue
    const p = filteredPredicted[candidate.pi]
    const g = filteredGroundTruth[candidate.gi]
    if (!p || !g) continue
    matches.push({ predicted: p, groundTruth: g, matchType: candidate.quality })
    usedPredicted.add(candidate.pi)
    usedGroundTruth.add(candidate.gi)
  }

  const unmatched_predicted = filteredPredicted.filter((_, pi) => !usedPredicted.has(pi))
  const unmatched_ground_truth = filteredGroundTruth.filter((_, gi) => !usedGroundTruth.has(gi))

  return { matches, unmatched_predicted, unmatched_ground_truth }
}

export function computeRunMetrics(
  fixture: FixtureManifest,
  audit: AuditResult,
  options: MatchOptions & { cost_usd?: number } = {},
): RunMetrics {
  const { matches, unmatched_predicted, unmatched_ground_truth } = matchFindings(
    audit.predicted,
    fixture.expected_findings,
    options,
  )

  const tp = matches.length
  const fp = unmatched_predicted.length
  const fn = unmatched_ground_truth.length

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)

  return {
    fixture_slug: fixture.slug,
    true_positives: tp,
    false_positives: fp,
    false_negatives: fn,
    precision,
    recall,
    f1,
    wall_time_ms: audit.finished_at - audit.started_at,
    tokens_used: audit.tokens_used,
    cost_usd: options.cost_usd,
    matches,
    unmatched_predicted,
    unmatched_ground_truth,
  }
}

export function aggregate(per_fixture: RunMetrics[]): AggregateMetrics {
  const total_tp = per_fixture.reduce((s, m) => s + m.true_positives, 0)
  const total_fp = per_fixture.reduce((s, m) => s + m.false_positives, 0)
  const total_fn = per_fixture.reduce((s, m) => s + m.false_negatives, 0)

  const micro_precision = total_tp + total_fp === 0 ? 0 : total_tp / (total_tp + total_fp)
  const micro_recall = total_tp + total_fn === 0 ? 0 : total_tp / (total_tp + total_fn)
  const micro_f1 =
    micro_precision + micro_recall === 0
      ? 0
      : (2 * micro_precision * micro_recall) / (micro_precision + micro_recall)

  const macro_precision =
    per_fixture.length === 0
      ? 0
      : per_fixture.reduce((s, m) => s + m.precision, 0) / per_fixture.length
  const macro_recall =
    per_fixture.length === 0
      ? 0
      : per_fixture.reduce((s, m) => s + m.recall, 0) / per_fixture.length
  const macro_f1 =
    per_fixture.length === 0 ? 0 : per_fixture.reduce((s, m) => s + m.f1, 0) / per_fixture.length

  const total_wall_time_ms = per_fixture.reduce((s, m) => s + m.wall_time_ms, 0)
  const tokenTotals = per_fixture
    .map((m) => m.tokens_used)
    .filter((t): t is number => typeof t === "number")
  const total_tokens =
    tokenTotals.length === per_fixture.length && tokenTotals.length > 0
      ? tokenTotals.reduce((s, t) => s + t, 0)
      : undefined
  const costTotals = per_fixture
    .map((m) => m.cost_usd)
    .filter((c): c is number => typeof c === "number")
  const total_cost_usd =
    costTotals.length === per_fixture.length && costTotals.length > 0
      ? costTotals.reduce((s, c) => s + c, 0)
      : undefined

  return {
    total_fixtures: per_fixture.length,
    micro_precision,
    micro_recall,
    micro_f1,
    macro_precision,
    macro_recall,
    macro_f1,
    total_wall_time_ms,
    total_tokens,
    total_cost_usd,
    per_fixture,
  }
}
