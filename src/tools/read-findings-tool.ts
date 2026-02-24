import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { type ToolContext, tool } from "@opencode-ai/plugin"
import { createAuditArtifactResolver } from "../shared/audit-artifact-resolver"
import { resolveProjectDir } from "../shared/project-utils"
import { type ReportInput, validateReportInput } from "../state/schemas"

type ReadFindingsArgs = {
  run_id: string
}

type ReadFindingsResult = {
  success: boolean
  source: "report-input.json"
  reportInput: ReportInput
}

export async function executeReadFindings(
  args: ReadFindingsArgs,
  context: ToolContext,
): Promise<string> {
  const runId = args.run_id
  if (!runId || runId.trim().length === 0) {
    throw new Error("run_id is required")
  }

  const projectDir = resolveProjectDir(context)
  const resolver = createAuditArtifactResolver(runId, projectDir)
  const reportInputFile = resolver.paths().reportInputFile

  if (!existsSync(reportInputFile)) {
    throw new Error(
      `No materialized report-input.json found for run ${runId} at ${reportInputFile}. Ensure materializeReportInput was called before reading.`,
    )
  }

  const raw = await readFile(reportInputFile, "utf-8")
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Corrupted report-input.json for run ${runId}: invalid JSON`)
  }

  const validation = validateReportInput(parsed)
  if (!validation.success) {
    const errors = validation.errors.map((e) => `${e.field}: ${e.message}`).join("; ")
    throw new Error(`report-input.json failed schema validation for run ${runId}: ${errors}`)
  }

  const result: ReadFindingsResult = {
    success: true,
    source: "report-input.json",
    reportInput: validation.data,
  }

  return JSON.stringify(result)
}

export const readFindingsTool = tool({
  description:
    "Read the materialized ReportInput artifact from disk for a given run. Returns the canonical findings, tools executed, scope, and all enrichment data. Scribe should call this before generating the report.",
  args: {
    run_id: tool.schema.string().describe("The run ID to read findings for."),
  },
  async execute(args, context) {
    return executeReadFindings(args, context)
  },
})
