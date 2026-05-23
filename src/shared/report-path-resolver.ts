import { join } from "node:path"

export class ReportPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ReportPathError"
  }
}

export interface ReportPathOptions {
  /** Contract name, e.g. "VulnerableVault" */
  contractName: string
  /** If not provided, use new Date() */
  date?: Date
  /** Canonical output directory (from config or default) */
  outputDir: string
  /** Optional run_id for run-scoped naming */
  runId?: string
  /** Optional caller-supplied report revision. Base report is revision 1. */
  revision?: number
}

export interface ResolvedReportPath {
  /** "VulnerableVault-security-audit-2026-02-21.md" */
  filename: string
  /** Full absolute path */
  filePath: string
  /** The directory used */
  outputDir: string
  /** runId if provided, else filename (deterministic identity) */
  canonicalId: string
}

export function formatReportDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function sanitizeContractName(name: string): string {
  const sanitized = name
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return sanitized || "unnamed-contract"
}

export function resolveReportPath(options: ReportPathOptions): ResolvedReportPath {
  const { contractName, date, outputDir, runId, revision } = options

  if (!contractName || contractName.trim() === "") {
    throw new ReportPathError("contractName must not be empty")
  }
  if (!outputDir || outputDir.trim() === "") {
    throw new ReportPathError("outputDir must not be empty")
  }
  if (revision != null && (!Number.isInteger(revision) || revision < 2)) {
    throw new ReportPathError("revision must be an integer greater than or equal to 2")
  }

  const resolvedDate = date ?? new Date()
  const dateStr = formatReportDate(resolvedDate)
  const sanitizedName = sanitizeContractName(contractName)
  const runIdSuffix = runId ? `-${runId.substring(0, 8)}` : ""
  const revisionSuffix = revision == null ? "" : `-r${revision}`
  const filename = `${sanitizedName}-security-audit-${dateStr}${runIdSuffix}${revisionSuffix}.md`
  const filePath = join(outputDir, filename)
  const canonicalId = runId ?? filename

  return {
    filename,
    filePath,
    outputDir,
    canonicalId,
  }
}
