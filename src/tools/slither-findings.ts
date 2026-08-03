import { createHash } from "node:crypto"
import type { Finding, FindingSeverity } from "../state/types"

export type SlitherPayload = {
  readonly success?: boolean
  readonly error?: string | null
  readonly results?: {
    readonly detectors?: readonly SlitherDetector[]
  }
}

type SlitherDetector = {
  readonly check?: string
  readonly impact?: string
  readonly confidence?: string
  readonly description?: string
  readonly elements?: readonly {
    readonly source_mapping?: {
      readonly filename_relative?: string
      readonly lines?: number[]
    }
  }[]
}

function severity(impact?: string): FindingSeverity {
  switch (impact) {
    case "High":
    case "Medium":
    case "Low":
    case "Informational":
      return impact
    default:
      return "Informational"
  }
}

function confidence(value?: string): "High" | "Medium" | "Low" {
  switch (value) {
    case "High":
    case "Medium":
    case "Low":
      return value
    default:
      return "Low"
  }
}

function lines(values?: number[]): [number, number] {
  const start = values?.[0] ?? 1
  return [start, values?.at(-1) ?? start]
}

export function createSlitherFindingId(
  check: string,
  file: string,
  sourceLines: [number, number],
): string {
  return createHash("sha256")
    .update(`${check}:${file}:${sourceLines[0]}-${sourceLines[1]}`)
    .digest("hex")
    .slice(0, 16)
}

export function parseSlitherFindings(payload: SlitherPayload): Finding[] {
  return (payload.results?.detectors ?? []).map((detector) => {
    const file = detector.elements?.[0]?.source_mapping?.filename_relative ?? "unknown"
    const sourceLines = lines(detector.elements?.[0]?.source_mapping?.lines)
    const check = detector.check ?? "unknown-check"
    return {
      id: createSlitherFindingId(check, file, sourceLines),
      check,
      severity: severity(detector.impact),
      impact: detector.impact,
      confidence: confidence(detector.confidence),
      description: detector.description ?? "",
      file,
      lines: sourceLines,
      source: "slither",
    }
  })
}
