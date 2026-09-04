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
await fireSessionEvent(plugin, "session.deleted")

console.log(
  JSON.stringify({
    vulnerableMatches: vulnerable.matches,
    safeMatches: safe.summary.total,
    bulkDisplayedMatches: bulk.matches.length,
    bulkTotalMatches: bulk.summary.total,
  }),
)
