import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { stableHash } from "../state/projectors"
import { type ReportInput, SCHEMA_VERSION } from "../state/schemas"

type ReportManifestEntry = {
  revision: number
  filePath: string
  filename: string
  contentHash: string
  dedupedContentHash: string
  createdAt: number
}

type ReportManifest = {
  run_id: string
  schema_version: string
  updatedAt: number
  reports: ReportManifestEntry[]
}

export const SINGLE_WRITER_POLICY_VERSION = "1.0.0"

const REPORT_METADATA_REGEX = /<!-- argus:report_metadata (.+?) -->/

/**
 * Extract the run_id from report metadata embedded as an HTML comment.
 * Returns null if no metadata is found or run_id is missing.
 */
export function extractReportRunId(content: string): string | null {
  const match = content.match(REPORT_METADATA_REGEX)
  if (!match?.[1]) return null
  try {
    const metadata = JSON.parse(match[1])
    return typeof metadata.run_id === "string" ? metadata.run_id : null
  } catch {
    return null
  }
}

export function buildReportMetadataComment(runId: string): string {
  const metadata = {
    run_id: runId,
    policy_version: SINGLE_WRITER_POLICY_VERSION,
  }
  return `<!-- argus:report_metadata ${JSON.stringify(metadata)} -->`
}

export function emptyReportManifest(runId: string): ReportManifest {
  return {
    run_id: runId,
    schema_version: SCHEMA_VERSION,
    updatedAt: Date.now(),
    reports: [],
  }
}

export function readReportManifest(filePath: string, runId: string): ReportManifest {
  if (!existsSync(filePath)) return emptyReportManifest(runId)
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<ReportManifest>
    if (!parsed || parsed.run_id !== runId || !Array.isArray(parsed.reports)) {
      return emptyReportManifest(runId)
    }
    return {
      run_id: runId,
      schema_version:
        typeof parsed.schema_version === "string" ? parsed.schema_version : SCHEMA_VERSION,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
      reports: parsed.reports.filter(
        (entry): entry is ReportManifestEntry =>
          typeof entry === "object" &&
          entry !== null &&
          typeof entry.revision === "number" &&
          typeof entry.filePath === "string" &&
          typeof entry.filename === "string" &&
          typeof entry.contentHash === "string" &&
          typeof entry.dedupedContentHash === "string" &&
          typeof entry.createdAt === "number",
      ),
    }
  } catch {
    return emptyReportManifest(runId)
  }
}

export function reportRevisionFromFilename(filename: string): number {
  const match = filename.match(/-r(\d+)\.md$/)
  if (!match?.[1]) return 1
  const revision = Number.parseInt(match[1], 10)
  return Number.isInteger(revision) && revision >= 2 ? revision : 1
}

export function scanRunReports(
  outputDir: string,
  runId: string,
  dedupedContentHash: string,
): ReportManifestEntry[] {
  if (!existsSync(outputDir)) return []
  const entries: ReportManifestEntry[] = []
  for (const filename of readdirSync(outputDir)) {
    if (!filename.endsWith(".md")) continue
    const filePath = path.join(outputDir, filename)
    try {
      if (!statSync(filePath).isFile()) continue
      const content = readFileSync(filePath, "utf8")
      if (extractReportRunId(content) !== runId) continue
      entries.push({
        revision: reportRevisionFromFilename(filename),
        filePath,
        filename,
        contentHash: stableHash(content),
        dedupedContentHash,
        createdAt: statSync(filePath).mtimeMs,
      })
    } catch {}
  }
  return entries
}

export function mergeReportEntries(
  manifestEntries: ReportManifestEntry[],
  scannedEntries: ReportManifestEntry[],
): ReportManifestEntry[] {
  const byPath = new Map<string, ReportManifestEntry>()
  for (const entry of manifestEntries) {
    if (existsSync(entry.filePath)) byPath.set(entry.filePath, entry)
  }
  for (const entry of scannedEntries) {
    const existing = byPath.get(entry.filePath)
    byPath.set(
      entry.filePath,
      existing
        ? {
            ...entry,
            dedupedContentHash: existing.dedupedContentHash,
            createdAt: existing.createdAt,
          }
        : entry,
    )
  }
  return Array.from(byPath.values()).sort((a, b) =>
    a.revision === b.revision ? a.filePath.localeCompare(b.filePath) : a.revision - b.revision,
  )
}

export function upsertReportEntry(
  entries: ReportManifestEntry[],
  nextEntry: ReportManifestEntry,
): ReportManifestEntry[] {
  const byPath = new Map(entries.map((entry) => [entry.filePath, entry]))
  byPath.set(nextEntry.filePath, nextEntry)
  return Array.from(byPath.values()).sort((a, b) =>
    a.revision === b.revision ? a.filePath.localeCompare(b.filePath) : a.revision - b.revision,
  )
}

export async function writeReportManifest(
  filePath: string,
  manifest: ReportManifest,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await Bun.write(filePath, JSON.stringify({ ...manifest, updatedAt: Date.now() }, null, 2))
}

export function dedupedContentHash(input: ReportInput): string {
  return stableHash({
    findings: input.findings,
    dropped_observations: input.dropped_observations ?? [],
  })
}

export async function checkDuplicateWrite(
  filePath: string,
  runId: string,
): Promise<{ code: string; message: string } | null> {
  if (!existsSync(filePath)) return null
  try {
    const existingContent = await Bun.file(filePath).text()
    const existingRunId = extractReportRunId(existingContent)
    if (existingRunId === runId) {
      return {
        code: "DUPLICATE_WRITE_ATTEMPT",
        message: `Report for run_id "${runId}" already exists at ${filePath}. Single-writer policy (v${SINGLE_WRITER_POLICY_VERSION}) prevents duplicate writes for the same run. To publish a corrected report, call argus_generate_report with revision: 2 (writes a -r2 file); do not retry the base write.`,
      }
    }
  } catch {
    // Cannot read existing file; allow write
  }
  return null
}

export async function checkSafeForceOverwrite(
  filePath: string,
  runId: string,
): Promise<{ code: string; message: string } | null> {
  if (!existsSync(filePath)) return null
  try {
    const existingContent = await Bun.file(filePath).text()
    const existingRunId = extractReportRunId(existingContent)
    if (existingRunId === runId) return null
    return {
      code: "INSECURE_OVERWRITE_REFUSED",
      message:
        existingRunId == null
          ? `Refusing to force overwrite ${filePath}: existing file has no Argus report metadata.`
          : `Refusing to force overwrite ${filePath}: existing report belongs to run_id "${existingRunId}", not "${runId}".`,
    }
  } catch (err) {
    return {
      code: "INSECURE_OVERWRITE_REFUSED",
      message: `Refusing to force overwrite ${filePath}: existing file could not be read (${err instanceof Error ? err.message : String(err)}).`,
    }
  }
}
