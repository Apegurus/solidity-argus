import { randomUUID } from "node:crypto"
import type { ToolContext } from "@opencode-ai/plugin"
import { z } from "zod"
import ArgusPlugin from "../../../src/index"
import type { PredictedFinding } from "../types"

const PatternMatchSchema = z.object({
  pattern: z.string(),
  severity: z.enum(["Critical", "High", "Medium", "Low", "Informational"]),
  file: z.string(),
  lines: z.tuple([z.number(), z.number()]),
})
const PatternResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  patternsChecked: z.number().int().nonnegative(),
  matches: z.array(PatternMatchSchema),
})
const PatternsSchema = z.array(z.string())

type PluginInstance = Awaited<ReturnType<typeof ArgusPlugin>>
type EventInput = Parameters<NonNullable<PluginInstance["event"]>>[0]

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

function mapPredictions(matches: z.infer<typeof PatternMatchSchema>[]): PredictedFinding[] {
  return matches.map((match) => ({
    check: match.pattern,
    severity: match.severity,
    confidence: "Medium",
    tier: "lead",
    file: match.file,
    lines: match.lines,
    source: "pattern",
  }))
}

const plugin = await ArgusPlugin({ directory: projectDir } as Parameters<typeof ArgusPlugin>[0])
await fireSessionEvent(plugin, "session.created")
try {
  const patternTool = plugin.tool?.argus_check_patterns
  if (!patternTool) throw new Error("argus_check_patterns tool is unavailable")

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
  process.stdout.write(JSON.stringify({ predicted: mapPredictions(scanResult.matches) }))
} finally {
  await fireSessionEvent(plugin, "session.deleted")
}
