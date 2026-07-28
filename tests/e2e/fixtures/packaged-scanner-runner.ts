import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import ArgusPlugin from "solidity-argus"
import { z } from "zod"

const MatchSchema = z.object({ pattern: z.string(), severity: z.string() })
const PatternResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  matches: z.array(MatchSchema),
  summary: z.object({ total: z.number() }),
  patternsChecked: z.number().int().nonnegative(),
})
const FindingSchema = z.object({
  check: z.string(),
  file: z.string(),
  severity: z.string(),
  source: z.string(),
})
const ReportInputSchema = z.object({ findings: z.array(FindingSchema) })
const ReadFindingsSchema = z.discriminatedUnion("truncated", [
  z.object({ truncated: z.literal(false), reportInput: ReportInputSchema }),
  z.object({ truncated: z.literal(true), compactReportInputFile: z.string() }),
])
const SessionStateSchema = z.object({ sessionId: z.string() })

type PluginInstance = Awaited<ReturnType<typeof ArgusPlugin>>
type EventInput = Parameters<NonNullable<PluginInstance["event"]>>[0]
type ToolAfterInput = Parameters<NonNullable<PluginInstance["tool.execute.after"]>>[0]
type ToolAfterOutput = Parameters<NonNullable<PluginInstance["tool.execute.after"]>>[1]

const projectDir = process.cwd()
const sessionID = "ses-packaged-scanner"

function createContext(): ToolContext {
  return {
    sessionID,
    messageID: "message-packaged-scanner",
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
  const input = {
    event: { type, properties: { info: { id: sessionID } } },
  } as EventInput
  await plugin.event?.(input)
}

async function fireIdle(plugin: PluginInstance): Promise<void> {
  const input = { event: { type: "session.idle", properties: { sessionID } } } as EventInput
  await plugin.event?.(input)
}

async function scan(
  plugin: PluginInstance,
  target: string,
  patterns: readonly string[],
  callID: string,
): Promise<z.infer<typeof PatternResultSchema>> {
  const patternTool = plugin.tool?.argus_check_patterns
  if (!patternTool) throw new Error("argus_check_patterns tool is unavailable")
  const args = { target, patterns: [...patterns], include_scvd: false }
  const displayedOutput = await patternTool.execute(args, createContext())
  const afterInput: ToolAfterInput = {
    tool: "argus_check_patterns",
    sessionID,
    callID,
    args,
  }
  const afterOutput: ToolAfterOutput = {
    title: "argus_check_patterns",
    output: displayedOutput,
    metadata: {},
  }
  await plugin["tool.execute.after"]?.(afterInput, afterOutput)
  const result = PatternResultSchema.parse(JSON.parse(displayedOutput))
  if (!result.success) throw new Error(result.error ?? "pattern scan failed")
  if (result.patternsChecked === 0) throw new Error("pattern scan selected zero scanner patterns")
  return result
}

const plugin = await ArgusPlugin({ directory: projectDir } as Parameters<typeof ArgusPlugin>[0])
await fireSessionEvent(plugin, "session.created")
const vulnerable = await scan(
  plugin,
  "controls/vulnerable",
  ["oracle-manipulation"],
  "call-vulnerable",
)
const safe = await scan(plugin, "controls/safe", ["access-control"], "call-safe")
const bulk = await scan(plugin, "controls/bulk", ["oracle-manipulation"], "call-bulk")
await fireIdle(plugin)

const statePath = join(projectDir, ".argus", "sessions", `state-${sessionID}.json`)
const { sessionId: runId } = SessionStateSchema.parse(JSON.parse(readFileSync(statePath, "utf8")))
const readFindingsTool = plugin.tool?.argus_read_findings
if (!readFindingsTool) throw new Error("argus_read_findings tool is unavailable")
const readOutput = ReadFindingsSchema.parse(
  JSON.parse(await readFindingsTool.execute({ run_id: runId }, createContext())),
)
const reportInput = readOutput.truncated
  ? ReportInputSchema.parse(JSON.parse(readFileSync(readOutput.compactReportInputFile, "utf8")))
  : readOutput.reportInput
const persistedRetainedFinding = reportInput.findings.find(
  (finding) =>
    finding.check === "pyth-oracle-validation-rule-1" && finding.file.endsWith("PythUnsafe.sol"),
)
if (!persistedRetainedFinding) throw new Error("retained Pyth finding was not persisted")
await fireSessionEvent(plugin, "session.deleted")

console.log(
  JSON.stringify({
    vulnerableMatches: vulnerable.matches,
    safeMatches: safe.summary.total,
    bulkDisplayedMatches: bulk.matches.length,
    bulkTotalMatches: bulk.summary.total,
    persistedPatternFindings: reportInput.findings.filter(
      (finding) => finding.check === "pyth-oracle-validation-rule-1",
    ).length,
    persistedRetainedFinding: {
      check: persistedRetainedFinding.check,
      severity: persistedRetainedFinding.severity,
      source: persistedRetainedFinding.source,
    },
  }),
)
