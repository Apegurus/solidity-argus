import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { createAuditArtifactResolver } from "../shared/audit-artifact-resolver"
import { SCHEMA_VERSION } from "../state/schemas"
import type { Finding, FindingSeverity } from "../state/types"

export const SEVERITY_ID_PREFIX: Record<FindingSeverity, string> = {
  Critical: "CRIT",
  High: "HIGH",
  Medium: "MED",
  Low: "LOW",
  Informational: "INFO",
}

export const LEAD_ID_PREFIX = "LEAD"

export interface FindingIdRegistryFile {
  run_id: string
  schema_version: string
  assignments: Record<string, string>
}

function prefixOf(displayId: string): string {
  const idx = displayId.lastIndexOf("-")
  return idx === -1 ? displayId : displayId.slice(0, idx)
}

function numberOf(displayId: string): number {
  const idx = displayId.lastIndexOf("-")
  if (idx === -1) return Number.NaN
  return Number.parseInt(displayId.slice(idx + 1), 10)
}

// Citable IDs must survive regeneration so embedded cross-references stay valid. A
// prior assignment is reused verbatim when its prefix still matches the finding's
// current bucket (severity tier, or LEAD); otherwise the finding takes the next free
// number for that prefix. New findings are numbered in render order, so a fresh run
// still reads CRIT-1, CRIT-2… top-to-bottom, while later revisions keep existing
// numbers pinned even when ordering shifts or earlier-sorting findings appear. Values
// are bare ("CRIT-1"); callers wrap them as "[CRIT-1]" at render time.
export function assignStableFindingIds(
  confirmed: Finding[],
  leads: Finding[],
  existing: Record<string, string>,
): Map<string, string> {
  const ordered: Array<{ identity: string; prefix: string }> = [
    ...confirmed.map((finding) => ({
      identity: finding.id,
      prefix: SEVERITY_ID_PREFIX[finding.severity],
    })),
    ...leads.map((finding) => ({ identity: finding.id, prefix: LEAD_ID_PREFIX })),
  ]

  const usedByPrefix = new Map<string, Set<number>>()
  const assignments = new Map<string, string>()

  const assign = (identity: string, prefix: string, n: number): void => {
    assignments.set(identity, `${prefix}-${n}`)
    const set = usedByPrefix.get(prefix) ?? new Set<number>()
    set.add(n)
    usedByPrefix.set(prefix, set)
  }

  for (const { identity, prefix } of ordered) {
    if (assignments.has(identity)) continue
    const prior = existing[identity]
    if (!prior || prefixOf(prior) !== prefix) continue
    const n = numberOf(prior)
    if (Number.isInteger(n) && n > 0 && !usedByPrefix.get(prefix)?.has(n)) {
      assign(identity, prefix, n)
    }
  }

  for (const { identity, prefix } of ordered) {
    if (assignments.has(identity)) continue
    const used = usedByPrefix.get(prefix)
    let n = 1
    while (used?.has(n)) n += 1
    assign(identity, prefix, n)
  }

  return assignments
}

export async function loadFindingIdRegistry(
  runId: string,
  projectDir: string,
): Promise<Record<string, string>> {
  try {
    const file = createAuditArtifactResolver(runId, projectDir).paths().findingIdMapFile
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<FindingIdRegistryFile>
    if (parsed && typeof parsed.assignments === "object" && parsed.assignments !== null) {
      return parsed.assignments as Record<string, string>
    }
  } catch {
    // Missing or unreadable registry: a fresh assignment pass starts from scratch.
  }
  return {}
}

export async function persistFindingIdRegistry(
  runId: string,
  projectDir: string,
  assignments: Map<string, string>,
): Promise<void> {
  try {
    const file = createAuditArtifactResolver(runId, projectDir).paths().findingIdMapFile
    await mkdir(dirname(file), { recursive: true })
    const payload: FindingIdRegistryFile = {
      run_id: runId,
      schema_version: SCHEMA_VERSION,
      assignments: Object.fromEntries(assignments),
    }
    await writeFile(file, JSON.stringify(payload, null, 2))
  } catch {
    // Best-effort: a failed registry write must never block report emission.
  }
}
