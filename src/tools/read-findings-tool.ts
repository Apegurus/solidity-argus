import { type ToolContext, tool } from "@opencode-ai/plugin"
import { materializeReportInput } from "../features/persistent-state/findings-materializer"
import { resolveProjectDir } from "../shared/project-utils"
import type { ReportInput } from "../state/schemas"

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
  const reportInput = await materializeReportInput(runId, projectDir)

  const result: ReadFindingsResult = {
    success: true,
    source: "report-input.json",
    reportInput,
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
