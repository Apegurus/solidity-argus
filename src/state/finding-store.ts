import crypto from "node:crypto"
import { isAbsolute, normalize, relative } from "node:path"
import { normalizeText } from "./finding-fingerprint"
import type { AuditState, Finding, FindingSeverity } from "./types"

function normalizeStorePath(filePath: string, projectDir: string): string {
  if (!filePath || !projectDir) return filePath
  const n = normalize(filePath)
  if (!isAbsolute(n)) return n.replace(/^\.\//, "")
  const rel = relative(projectDir, n)
  return rel.startsWith("..") ? n : rel
}

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
  const projectDir = state.projectDir

  function generateObservationId(check: string, file: string, lines: [number, number]): string {
    return crypto
      .createHash("sha256")
      .update(`${normalizeText(check)}:${normalizeText(file)}:${lines[0]}-${lines[1]}`)
      .digest("hex")
      .substring(0, 16)
  }

  const hydratedFindings = state.findings.filter(isValidHydrationFinding)

  function addFinding(finding: Omit<Finding, "id">): Finding {
    const normalizedFile = normalizeStorePath(finding.file, projectDir)
    const normalized =
      normalizedFile !== finding.file ? { ...finding, file: normalizedFile } : finding
    const id = generateObservationId(normalized.check, normalized.file, normalized.lines)

    const existing = hydratedFindings.find((f) => f.id === id)
    if (existing) {
      return existing
    }

    const newFinding: Finding = {
      ...normalized,
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
    const normalizedCheck = normalizeText(check)
    const normalizedFile = normalizeText(file)
    return hydratedFindings.some(
      (finding) =>
        normalizeText(finding.check) === normalizedCheck &&
        normalizeText(finding.file) === normalizedFile &&
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

