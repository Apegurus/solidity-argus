export type FindingSeverity = "Critical" | "High" | "Medium" | "Low" | "Informational"
export type ArgusAgentName =
  | "argus"
  | "sentinel"
  | "pythia"
  | "audit-specialist"
  | "scribe"
  | "unknown"
export type AuditPhase =
  | "reconnaissance"
  | "scanning"
  | "manual-review"
  | "attack-surface"
  | "research"
  | "testing"
  | "reporting"
  | "complete"

export interface Finding {
  id: string
  check: string // detector name e.g. "reentrancy-eth"
  severity: FindingSeverity
  confidence: "High" | "Medium" | "Low"
  description: string
  file: string // relative file path
  lines: [number, number] // [start, end]
  source: "slither" | "manual" | "pattern" | "scvd" | "solodit" | "fuzz"
  reported_by_agent?: ArgusAgentName
  reported_by_session_id?: string
  issue_fingerprint?: string
  observation_fingerprint?: string
  observation_id?: string
  observation_ids?: string[]
  reported_by_agents?: string[]
  sources?: string[]
  observation_count?: number
  impact?: string
  recommendation?: string
  proofOfConcept?: string
  remediation?: string
  exploitReference?: string
  provenance?: {
    timestamp: number
    toolVersion?: string
    phase?: AuditPhase
  }
}

export interface SoloditResult {
  query: string
  timestamp: number
  resultCount: number
  topResults: Array<{
    title: string
    severity: string
    url: string
    protocol: string
  }>
}

export interface FuzzCounterexample {
  testName: string
  inputs: string[]
  revertReason?: string
  runs: number
  seed?: number
  timestamp: number
}

export interface ContractProfile {
  name: string
  filePath: string
  functions: Array<{
    name: string
    visibility: string
    mutability: string
    modifiers: string[]
  }>
  stateVars: Array<{
    name: string
    type: string
    visibility: string
  }>
  inheritance: string[]
  accessControlPattern?: "ownable" | "access-control" | "custom" | "none"
  externalCalls: string[]
  riskIndicators: string[]
  error?: string
}

export interface ToolExecution {
  tool: string
  startTime: number
  endTime?: number
  success: boolean
  findingsCount: number
  findingCounts?: FindingCounts
}

export interface FindingCounts {
  rawObservations?: number
  recordedFindings?: number
  dedupedFindings?: number
  actionableFindings?: number
  nonActionableFindings?: number
}

export interface CoverageAttemptState {
  status: "pending" | "run" | "skipped" | "failed"
  attemptedAt?: number
  reason?: string
}

export interface AuditState {
  sessionId: string
  projectDir: string
  contractsReviewed: string[]
  findings: Finding[]
  toolsExecuted: ToolExecution[]
  currentPhase: AuditPhase
  scope: string[]
  startTime: number
  soloditResults?: SoloditResult[]
  fuzzCounterexamples?: FuzzCounterexample[]
  patternVersion?: string
  skillsLoaded?: string[]
  unavailableTools?: string[]
  reportGenerated?: boolean
  findingCounts?: FindingCounts
  knowledgeSynced?: { success: boolean; timestamp: number }
  coverageAttempt?: CoverageAttemptState
  coverageReport?: {
    files: Array<{
      path: string
      linesPct: number
      statementsPct: number
      branchesPct: number
      functionsPct: number
    }>
  }
  gasHotspots?: Array<{ contract: string; function: string; avgGas: number }>
  proxyContracts?: Array<{ file: string; proxyType: string; indicators: string[] }>
}

export interface PersistentAuditState extends AuditState {
  savedAt: number
  version: string
  filePath: string
  /** Whether this snapshot was projected from events or loaded from a prior snapshot */
  source_of_truth?: "events" | "snapshot"
  /** Sequence number of the last event included in this snapshot */
  last_event_seq?: number
  /** Hash of the event stream for staleness detection */
  event_stream_hash?: string
}
