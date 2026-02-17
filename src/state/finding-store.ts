import type { Finding, FindingSeverity, AuditState } from "./types";
import { createHash } from "crypto";

export interface FindingStore {
  addFinding(finding: Omit<Finding, "id">): Finding;
  getFindings(filter?: {
    severity?: FindingSeverity;
    source?: Finding["source"];
  }): Finding[];
  hasFinding(check: string, file: string, lines: [number, number]): boolean;
  serialize(): string;
}

/**
 * Creates a finding store with deduplication by check+file+lines
 * Deduplication key: `${check}:${file}:${lines[0]}-${lines[1]}`
 */
export function createFindingStore(state: AuditState): FindingStore {
  const findingMap = new Map<string, Finding>();

  function generateId(
    check: string,
    file: string,
    lines: [number, number]
  ): string {
    const key = `${check}:${file}:${lines[0]}-${lines[1]}`;
    // Use deterministic hash for stable IDs
    return createHash("sha256").update(key).digest("hex").substring(0, 16);
  }

  function addFinding(finding: Omit<Finding, "id">): Finding {
    const id = generateId(finding.check, finding.file, finding.lines);

    // Check if finding already exists (deduplication)
    if (findingMap.has(id)) {
      return findingMap.get(id)!;
    }

    const newFinding: Finding = {
      ...finding,
      id,
    };

    findingMap.set(id, newFinding);
    state.findings.push(newFinding);

    return newFinding;
  }

  function getFindings(filter?: {
    severity?: FindingSeverity;
    source?: Finding["source"];
  }): Finding[] {
    if (!filter) {
      return Array.from(findingMap.values());
    }

    return Array.from(findingMap.values()).filter((finding) => {
      if (filter.severity && finding.severity !== filter.severity) {
        return false;
      }
      if (filter.source && finding.source !== filter.source) {
        return false;
      }
      return true;
    });
  }

  function hasFinding(
    check: string,
    file: string,
    lines: [number, number]
  ): boolean {
    const id = generateId(check, file, lines);
    return findingMap.has(id);
  }

  function serialize(): string {
    const findings = Array.from(findingMap.values());
    const contractCount = state.contractsReviewed.length;
    const findingCount = findings.length;

    // Count by severity
    const severityCounts: Record<FindingSeverity, number> = {
      Critical: 0,
      High: 0,
      Medium: 0,
      Low: 0,
      Informational: 0,
    };

    findings.forEach((finding) => {
      severityCounts[finding.severity]++;
    });

    // Build severity string
    const severityParts: string[] = [];
    if (severityCounts.Critical > 0) {
      severityParts.push(`${severityCounts.Critical} Critical`);
    }
    if (severityCounts.High > 0) {
      severityParts.push(`${severityCounts.High} High`);
    }
    if (severityCounts.Medium > 0) {
      severityParts.push(`${severityCounts.Medium} Medium`);
    }
    if (severityCounts.Low > 0) {
      severityParts.push(`${severityCounts.Low} Low`);
    }
    if (severityCounts.Informational > 0) {
      severityParts.push(`${severityCounts.Informational} Informational`);
    }

    const severityStr =
      severityParts.length > 0 ? ` (${severityParts.join(", ")})` : "";

    return `Contracts: ${contractCount}, Findings: ${findingCount}${severityStr}, Phase: ${state.currentPhase}`;
  }

  return {
    addFinding,
    getFindings,
    hasFinding,
    serialize,
  };
}
