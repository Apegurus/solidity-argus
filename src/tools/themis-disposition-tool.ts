import { type ToolContext, tool } from "@opencode-ai/plugin"

type ThemisDispositionStatus = "approved" | "remediated" | "overridden"

type ThemisDispositionArgs = {
  status: ThemisDispositionStatus
  verdict_json: string
  notes?: string
  justification?: string
}

function parseVerdict(verdictJson: string): unknown {
  try {
    return JSON.parse(verdictJson)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid Themis verdict JSON: ${message}`)
  }
}

export function executeThemisDisposition(args: ThemisDispositionArgs, context: ToolContext) {
  context.metadata({ title: `Themis disposition: ${args.status}` })
  return {
    success: true,
    themisDisposition: {
      status: args.status,
      verdict: parseVerdict(args.verdict_json),
      ...(args.notes ? { notes: args.notes } : {}),
      ...(args.justification ? { justification: args.justification } : {}),
    },
  }
}

export const themisDispositionTool = tool({
  description:
    "Record Argus' resolved disposition for a Themis quality-gate verdict: approved, remediated, or overridden.",
  args: {
    status: tool.schema.enum(["approved", "remediated", "overridden"]),
    verdict_json: tool.schema.string(),
    notes: tool.schema.string().optional(),
    justification: tool.schema.string().optional(),
  },
  async execute(args, context) {
    return JSON.stringify(executeThemisDisposition(args, context))
  },
})
