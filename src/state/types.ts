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
  source: "slither" | "manual" | "pattern" | "scvd";
  remediation?: string;
  exploitReference?: string;
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
}
