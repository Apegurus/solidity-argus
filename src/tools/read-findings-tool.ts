import { type ToolContext, tool } from "@opencode-ai/plugin"
import { materializeReportInput } from "../features/persistent-state/findings-materializer"
import { resolveProjectDir } from "../shared/project-utils"
import type { CanonicalFinding, CanonicalToolExecution, ReportInput } from "../state/schemas"

type ReadFindingsArgs = {
  run_id: string
}

type ReportFinding = Omit<
  CanonicalFinding,
  | "run_id"
  | "seq"
  | "schema_version"
  | "observation_id"
  | "issue_fingerprint"
  | "observation_fingerprint"
  | "reported_by_agent"
  | "reported_by_session_id"
>

type ReportToolExecution = Omit<CanonicalToolExecution, "run_id" | "schema_version">

type CompactReportInput = Omit<
  ReportInput,
  | "findings"
  | "toolsExecuted"
  | "run_id"
  | "seq"
  | "session_id"
  | "tool_call_id"
  | "source"
  | "schema_version"
> & {
  run_id: string
  findings: ReportFinding[]
  toolsExecuted: ReportToolExecution[]
}

type ReadFindingsResult = {
  success: boolean
  source: "report-input.json"
  reportInput: CompactReportInput
}

const FINDING_INTERNAL_KEYS: ReadonlySet<string> = new Set([
  "run_id",
  "seq",
  "schema_version",
  "observation_id",
  "issue_fingerprint",
  "observation_fingerprint",
  "reported_by_agent",
  "reported_by_session_id",
])

const TOOL_EXECUTION_INTERNAL_KEYS: ReadonlySet<string> = new Set(["run_id", "schema_version"])

function stripInternalKeys(obj: object, keysToStrip: ReadonlySet<string>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (!keysToStrip.has(key)) {
      result[key] = value
    }
  }
  return result
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

  const compactInput: CompactReportInput = {
    run_id: reportInput.run_id,
    projectDir: reportInput.projectDir,
    findings: reportInput.findings.map(
      (f) => stripInternalKeys(f, FINDING_INTERNAL_KEYS) as ReportFinding,
    ),
    toolsExecuted: reportInput.toolsExecuted.map(
      (t) => stripInternalKeys(t, TOOL_EXECUTION_INTERNAL_KEYS) as ReportToolExecution,
    ),
    scope: reportInput.scope,
    ...(reportInput.soloditResults && { soloditResults: reportInput.soloditResults }),
    ...(reportInput.fuzzCounterexamples && {
      fuzzCounterexamples: reportInput.fuzzCounterexamples,
    }),
    ...(reportInput.coverageReport && { coverageReport: reportInput.coverageReport }),
    ...(reportInput.gasHotspots && { gasHotspots: reportInput.gasHotspots }),
    ...(reportInput.proxyContracts && { proxyContracts: reportInput.proxyContracts }),
    ...(reportInput.patternVersion && { patternVersion: reportInput.patternVersion }),
    ...(reportInput.skillsLoaded && { skillsLoaded: reportInput.skillsLoaded }),
  }

  const result: ReadFindingsResult = {
    success: true,
    source: "report-input.json",
    reportInput: compactInput,
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
