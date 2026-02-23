import { createHash } from "node:crypto"
import type { ArgusAgentName, FindingSeverity } from "./types"

type IssueFingerprintInput = {
  check: string
  file: string
  lines: [number, number]
  severity: FindingSeverity
}

type ObservationFingerprintInput = {
  issueFingerprint: string
  source: string
  reportedByAgent: ArgusAgentName
  toolCallId?: string
  sessionId?: string
  observationId?: string
}

function hash(parts: string[]): string {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex")
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}

export function computeIssueFingerprint(input: IssueFingerprintInput): string {
  return hash([
    normalizeText(input.check),
    normalizeText(input.file),
    String(input.lines[0]),
    String(input.lines[1]),
    input.severity,
  ])
}

export function computeObservationFingerprint(input: ObservationFingerprintInput): string {
  return hash([
    input.issueFingerprint,
    normalizeText(input.source),
    input.reportedByAgent,
    input.toolCallId ?? "",
    input.sessionId ?? "",
    input.observationId ?? "",
  ])
}
