export type FindingSeverity = "Critical" | "High" | "Medium" | "Low" | "Informational";
export type AuditPhase = "reconnaissance" | "scanning" | "manual-review" | "attack-surface" | "research" | "testing" | "reporting" | "complete";

export interface Finding {
  id: string; // unique hash: check+file+lines
  check: string; // detector name e.g. "reentrancy-eth"
  severity: FindingSeverity;
  confidence: "High" | "Medium" | "Low";
  description: string;
  file: string; // relative file path
  lines: [number, number]; // [start, end]
  source: "slither" | "manual" | "pattern" | "scvd" | "solodit" | "fuzz";
  remediation?: string;
  exploitReference?: string;
  provenance?: {
    timestamp: number;
    toolVersion?: string;
    phase?: AuditPhase;
  };
}

export interface SoloditResult {
  query: string;
  timestamp: number;
  resultCount: number;
  topResults: Array<{
    title: string;
    severity: string;
    url: string;
    protocol: string;
  }>;
}

export interface FuzzCounterexample {
  testName: string;
  inputs: string[];
  revertReason?: string;
  runs: number;
  seed?: number;
  timestamp: number;
}

export interface ContractProfile {
  name: string;
  filePath: string;
  functions: Array<{
    name: string;
    visibility: string;
    mutability: string;
    modifiers: string[];
  }>;
  stateVars: Array<{
    name: string;
    type: string;
    visibility: string;
  }>;
  inheritance: string[];
  accessControlPattern?: "ownable" | "access-control" | "custom" | "none";
  externalCalls: string[];
  riskIndicators: string[];
  error?: string;
}

export interface ToolExecution {
  tool: string;
  startTime: number;
  endTime?: number;
  success: boolean;
  findingsCount: number;
}

export interface AuditState {
  sessionId: string;
  projectDir: string;
  contractsReviewed: string[];
  findings: Finding[];
  toolsExecuted: ToolExecution[];
  currentPhase: AuditPhase;
  scope: string[];
  startTime: number;
  soloditResults?: SoloditResult[];
  fuzzCounterexamples?: FuzzCounterexample[];
  patternVersion?: string;
  skillsLoaded?: string[];
  unavailableTools?: string[];
}

export interface PersistentAuditState extends AuditState {
  savedAt: number;
  version: string;
  filePath: string;
}
