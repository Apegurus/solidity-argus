import type { Plugin } from "@opencode-ai/plugin"
import { loadArgusConfig } from "./plugin-config"
import { createAuditState } from "./state/audit-state"
import { createConfigHandler } from "./hooks/config-handler"
import { createSystemPromptHook } from "./hooks/system-prompt-hook"
import { createCompactionHook } from "./hooks/compaction-hook"
import { createToolTrackingHook } from "./hooks/tool-tracking-hook"
import { createEventHook } from "./hooks/event-hook"
import { createKnowledgeSyncHook } from "./hooks/knowledge-sync-hook"
import { slitherTool } from "./tools/slither-tool"
import { forgeTestTool } from "./tools/forge-test-tool"
import { forgeFuzzTool } from "./tools/forge-fuzz-tool"
import { contractAnalyzerTool } from "./tools/contract-analyzer-tool"
import { patternCheckerTool } from "./tools/pattern-checker-tool"
import { soloditSearchTool } from "./tools/solodit-search-tool"
import { reportGeneratorTool } from "./tools/report-generator-tool"
import { syncKnowledgeTool } from "./tools/sync-knowledge-tool"

const ArgusPlugin: Plugin = async (ctx) => {
  const projectDir = ctx.directory ?? process.cwd()
  const argusConfig = loadArgusConfig(projectDir)

  const { state: auditState, store: findingStore } = createAuditState(projectDir)
  const { hook: eventHook, getAuditState, setAuditState } = createEventHook(ctx.directory)
  setAuditState(auditState)

  const systemPromptHook = createSystemPromptHook(getAuditState)
  const compactionHook = createCompactionHook(getAuditState)
  const toolTrackingHook = createToolTrackingHook(auditState, findingStore)

  const triggerAutoSync = createKnowledgeSyncHook(argusConfig)
  triggerAutoSync()

  return {
    tool: {
      argus_slither_analyze: slitherTool,
      argus_forge_test: forgeTestTool,
      argus_forge_fuzz: forgeFuzzTool,
      argus_analyze_contract: contractAnalyzerTool,
      argus_check_patterns: patternCheckerTool,
      argus_solodit_search: soloditSearchTool,
      argus_generate_report: reportGeneratorTool,
      argus_sync_knowledge: syncKnowledgeTool,
    },
    config: createConfigHandler(argusConfig),
    "experimental.chat.system.transform": async (_input, output) => {
      const currentSystem = output.system.join("\n\n")
      const transformedSystem = await systemPromptHook({
        system: currentSystem,
        cwd: projectDir,
      })
      output.system = [transformedSystem]
    },
    "experimental.session.compacting": async (_input, output) => {
      const currentSummary = output.context.join("\n")
      const compactedSummary = await compactionHook({ summary: currentSummary })
      output.context = [compactedSummary]
    },
    "tool.execute.after": async (input, output) => {
      await toolTrackingHook({
        tool: input.tool,
        args: input.args,
        result: output.output,
      })
    },
    event: eventHook,
  }
}

export default ArgusPlugin
