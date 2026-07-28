import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { z } from "zod"
import ArgusPlugin from "../../../src/index"
import type { PredictedFinding } from "../types"

const FindingSchema = z.object({
  check: z.string(),
  severity: z.enum(["Critical", "High", "Medium", "Low", "Informational"]),
  confidence: z.enum(["High", "Medium", "Low"]),
  confidence_score: z.number().optional(),
  rubric_verdict: z.enum(["CONFIRMED", "DEMOTED", "REJECTED_DEMOTED"]).optional(),
  file: z.string(),
  lines: z.tuple([z.number(), z.number()]),
  source: z.enum(["slither", "manual", "pattern", "scvd", "solodit", "fuzz"]),
})
const ReportInputSchema = z.object({ findings: z.array(FindingSchema) })
const ReadFindingsSchema = z.discriminatedUnion("truncated", [
  z.object({ truncated: z.literal(false), reportInput: ReportInputSchema }),
  z.object({ truncated: z.literal(true), compactReportInputFile: z.string() }),
])
const SessionStateSchema = z.object({ sessionId: z.string() })
const PatternsSchema = z.array(z.string())
const PatternResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  patternsChecked: z.number().int().nonnegative(),
})

type PluginInstance = Awaited<ReturnType<typeof ArgusPlugin>>
type EventInput = Parameters<NonNullable<PluginInstance["event"]>>[0]
type ToolAfterInput = Parameters<NonNullable<PluginInstance["tool.execute.after"]>>[0]
type ToolAfterOutput = Parameters<NonNullable<PluginInstance["tool.execute.after"]>>[1]

const projectDir = z.string().min(1).parse(process.argv[2])
const patterns = PatternsSchema.parse(JSON.parse(process.argv[3] ?? "[]"))
const sessionID = `ses-eval-${randomUUID()}`

function createContext(): ToolContext {
  return {
    sessionID,
    messageID: `message-${sessionID}`,
    agent: "argus",
    directory: projectDir,
    worktree: projectDir,
    abort: new AbortController().signal,
    metadata() {
      return
    },
    async ask() {
      return
    },
  }
}

async function fireSessionEvent(
  plugin: PluginInstance,
  type: "session.created" | "session.deleted",
): Promise<void> {
  const input = { event: { type, properties: { info: { id: sessionID } } } } as EventInput
  await plugin.event?.(input)
}

async function fireIdle(plugin: PluginInstance): Promise<void> {
  const input = { event: { type: "session.idle", properties: { sessionID } } } as EventInput
  await plugin.event?.(input)
}

function mapPredictions(findings: z.infer<typeof FindingSchema>[]): PredictedFinding[] {
  return findings.map((finding) => ({
    check: finding.check,
    severity: finding.severity,
    confidence: finding.confidence,
    confidence_score: finding.confidence_score,
    rubric_verdict: finding.rubric_verdict,
    tier: finding.rubric_verdict === "CONFIRMED" ? "finding" : "lead",
    file: finding.file,
    lines: finding.lines,
    source: finding.source,
  }))
}

const plugin = await ArgusPlugin({ directory: projectDir } as Parameters<typeof ArgusPlugin>[0])
await fireSessionEvent(plugin, "session.created")
try {
  const patternTool = plugin.tool?.argus_check_patterns
  if (!patternTool) throw new Error("argus_check_patterns tool is unavailable")
  const readFindingsTool = plugin.tool?.argus_read_findings
  if (!readFindingsTool) throw new Error("argus_read_findings tool is unavailable")

  const args = {
    target: projectDir,
    patterns: patterns.length > 0 ? patterns : undefined,
    include_scvd: false,
  }
  const displayedOutput = await patternTool.execute(args, createContext())
  const scanResult = PatternResultSchema.parse(JSON.parse(displayedOutput))
  if (!scanResult.success) throw new Error(scanResult.error ?? "pattern scan failed")
  if (scanResult.patternsChecked === 0) {
    throw new Error("pattern scan selected zero scanner patterns")
  }
  const afterInput: ToolAfterInput = {
    tool: "argus_check_patterns",
    sessionID,
    callID: `call-${sessionID}`,
    args,
  }
  const afterOutput: ToolAfterOutput = {
    title: "argus_check_patterns",
    output: displayedOutput,
    metadata: {},
  }
  await plugin["tool.execute.after"]?.(afterInput, afterOutput)
  await fireIdle(plugin)

  const statePath = join(projectDir, ".argus", "sessions", `state-${sessionID}.json`)
  const { sessionId: runId } = SessionStateSchema.parse(JSON.parse(readFileSync(statePath, "utf8")))
  const readOutput = ReadFindingsSchema.parse(
    JSON.parse(await readFindingsTool.execute({ run_id: runId }, createContext())),
  )
  const reportInput = readOutput.truncated
    ? ReportInputSchema.parse(JSON.parse(readFileSync(readOutput.compactReportInputFile, "utf8")))
    : readOutput.reportInput
  process.stdout.write(JSON.stringify({ predicted: mapPredictions(reportInput.findings) }))
} finally {
  await fireSessionEvent(plugin, "session.deleted")
}
