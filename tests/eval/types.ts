import type { Finding, FindingSeverity } from "../../src/state/types"

export interface GroundTruthFinding {
  id: string
  title: string
  severity: FindingSeverity
  file: string
  lines: [number, number]
  cwe?: string
  swc?: string
  source: {
    audit: string
    url?: string
    finding_number?: string | number
  }
  category?: string
  acceptance_criteria: string[]
}

export interface FixtureManifest {
  slug: string
  name: string
  description: string
  source: {
    name: string
    url?: string
    license: string
    commit?: string
  }
  project: {
    root: string
    contracts_glob: string
    foundry: boolean
  }
  expected_findings: GroundTruthFinding[]
}

export interface PredictedFinding {
  check: string
  severity: FindingSeverity
  confidence: "High" | "Medium" | "Low"
  confidence_score?: number
  file: string
  lines: [number, number]
  source: Finding["source"]
}

export interface MatchedPair {
  predicted: PredictedFinding
  groundTruth: GroundTruthFinding
  matchType: "exact_line" | "line_overlap" | "file_match"
}

export interface AuditResult {
  fixture_slug: string
  started_at: number
  finished_at: number
  predicted: PredictedFinding[]
  raw_predicted_count: number
  filtered_predicted_count: number
  tokens_used?: number
}

export interface RunMetrics {
  fixture_slug: string
  true_positives: number
  false_positives: number
  false_negatives: number
  precision: number
  recall: number
  f1: number
  wall_time_ms: number
  tokens_used?: number
  cost_usd?: number
  matches: MatchedPair[]
  unmatched_predicted: PredictedFinding[]
  unmatched_ground_truth: GroundTruthFinding[]
}

export interface RunOptions {
  fixture: FixtureManifest
  confidence_threshold?: number
  severity_threshold?: FindingSeverity
  cost_per_million_input_tokens_usd?: number
  cost_per_million_output_tokens_usd?: number
}

export interface AggregateMetrics {
  total_fixtures: number
  micro_precision: number
  micro_recall: number
  micro_f1: number
  macro_precision: number
  macro_recall: number
  macro_f1: number
  total_wall_time_ms: number
  total_tokens?: number
  total_cost_usd?: number
  per_fixture: RunMetrics[]
}
