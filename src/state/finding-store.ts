import crypto from "node:crypto"
import type { AuditState, Finding, FindingSeverity } from "./types"

export interface FindingStore {
  addFinding(finding: Omit<Finding, "id">): Finding
  getFindings(filter?: { severity?: FindingSeverity; source?: Finding["source"] }): Finding[]
  hasFinding(check: string, file: string, lines: [number, number]): boolean
  serialize(): string
}

function isValidHydrationFinding(f: unknown): f is Finding {
  if (typeof f !== "object" || f === null) return false
  const obj = f as Record<string, unknown>
  return (
    typeof obj.check === "string" &&
    obj.check.length > 0 &&
    typeof obj.file === "string" &&
    obj.file.length > 0 &&
    Array.isArray(obj.lines) &&
    obj.lines.length === 2 &&
    typeof obj.lines[0] === "number" &&
    typeof obj.lines[1] === "number"
  )
}

export function createFindingStore(state: AuditState): FindingStore {
  function generateObservationId(check: string, file: string, lines: [number, number]): string {
    return crypto
      .createHash("sha256")
      .update(`${check}:${file}:${lines[0]}-${lines[1]}`)
      .digest("hex")
      .substring(0, 16)
  }

  const hydratedFindings = state.findings.filter(isValidHydrationFinding)

  function addFinding(finding: Omit<Finding, "id">): Finding {
    const id = generateObservationId(finding.check, finding.file, finding.lines)

    const newFinding: Finding = {
      ...finding,
      id,
    }

    state.findings.push(newFinding)
    hydratedFindings.push(newFinding)

    return newFinding
  }

  function getFindings(filter?: {
    severity?: FindingSeverity
    source?: Finding["source"]
  }): Finding[] {
    const findings = hydratedFindings.slice()

    if (!filter) {
      return findings
    }

    return findings.filter((finding) => {
      if (filter.severity && finding.severity !== filter.severity) {
        return false
      }
      if (filter.source && finding.source !== filter.source) {
        return false
      }
      return true
    })
  }

  function hasFinding(check: string, file: string, lines: [number, number]): boolean {
    return hydratedFindings.some(
      (finding) =>
        finding.check === check &&
        finding.file === file &&
        finding.lines[0] === lines[0] &&
        finding.lines[1] === lines[1],
    )
  }

  function serialize(): string {
    const findings = hydratedFindings.slice()
    const contractCount = state.contractsReviewed.length
    const findingCount = findings.length

    // Count by severity
    const severityCounts: Record<FindingSeverity, number> = {
      Critical: 0,
      High: 0,
      Medium: 0,
      Low: 0,
      Informational: 0,
    }

    findings.forEach((finding) => {
      severityCounts[finding.severity]++
    })

    // Build severity string
    const severityParts: string[] = []
    if (severityCounts.Critical > 0) {
      severityParts.push(`${severityCounts.Critical} Critical`)
    }
    if (severityCounts.High > 0) {
      severityParts.push(`${severityCounts.High} High`)
    }
    if (severityCounts.Medium > 0) {
      severityParts.push(`${severityCounts.Medium} Medium`)
    }
    if (severityCounts.Low > 0) {
      severityParts.push(`${severityCounts.Low} Low`)
    }
    if (severityCounts.Informational > 0) {
      severityParts.push(`${severityCounts.Informational} Informational`)
    }

    const severityStr = severityParts.length > 0 ? ` (${severityParts.join(", ")})` : ""

    return `Contracts: ${contractCount}, Findings: ${findingCount}${severityStr}, Phase: ${state.currentPhase}`
  }

  return {
    addFinding,
    getFindings,
    hasFinding,
    serialize,
  }
}
