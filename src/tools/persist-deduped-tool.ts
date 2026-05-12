import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { type ToolContext, tool } from "@opencode-ai/plugin"
import { createAuditArtifactResolver } from "../shared/audit-artifact-resolver"
import { createLogger } from "../shared/logger"
import { resolveProjectDir } from "../shared/project-utils"
import { isNonEmptyString } from "../shared/type-guards"
import type { CanonicalFinding } from "../state/schemas"
import { SCHEMA_VERSION } from "../state/schemas"

type PersistDedupedArgs = {
  run_id: string
  deduped_findings: string
}

export interface DedupedFindingsArtifact {
  run_id: string
  schema_version: string
  deduped_at: number
  deduped_by: string
  findings_count: number
  findings: CanonicalFinding[]
}

export async function executePersistDeduped(
  args: PersistDedupedArgs,
  context: ToolContext,
): Promise<string> {
  const logger = createLogger()

  if (!isNonEmptyString(args.run_id)) {
    return JSON.stringify({ success: false, error: "run_id is required" })
  }
  if (!isNonEmptyString(args.deduped_findings)) {
    return JSON.stringify({ success: false, error: "deduped_findings is required" })
  }

  let findings: CanonicalFinding[]
  try {
    const parsed = JSON.parse(args.deduped_findings)
    findings = Array.isArray(parsed) ? parsed : parsed.findings
    if (!Array.isArray(findings)) {
      return JSON.stringify({
        success: false,
        error: "deduped_findings must be a JSON array or an object with a findings array",
      })
    }
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  const projectDir = resolveProjectDir(context)
  const resolver = createAuditArtifactResolver(args.run_id, projectDir)
  const dedupedPath = resolver.paths().dedupedFindingsFile

  const artifact: DedupedFindingsArtifact = {
    run_id: args.run_id,
    schema_version: SCHEMA_VERSION,
    deduped_at: Date.now(),
    deduped_by: context.agent ?? "scribe",
    findings_count: findings.length,
    findings,
  }

  await mkdir(dirname(dedupedPath), { recursive: true })
  await writeFile(dedupedPath, JSON.stringify(artifact, null, 2))
  logger.debug(`Persisted ${findings.length} deduped findings to ${dedupedPath}`)

  return JSON.stringify({
    success: true,
    path: dedupedPath,
    findings_count: findings.length,
    schema_version: SCHEMA_VERSION,
  })
}

export const persistDedupedTool = tool({
  description:
    "Persist deduplicated and enriched findings to disk as the source-of-truth JSON artifact. Call this BEFORE argus_generate_report so the report tool can read from disk instead of requiring inline data.",
  args: {
    run_id: tool.schema.string().describe("The canonical run ID from <argus-context>."),
    deduped_findings: tool.schema
      .string()
      .describe(
        "Serialized JSON array of deduplicated and enriched findings. Each finding should have: check, severity, confidence, description, file, lines, source, impact, recommendation.",
      ),
  },
  async execute(args, context) {
    return executePersistDeduped(args, context)
  },
})
