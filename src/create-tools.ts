import type { ToolDefinition } from "@opencode-ai/plugin"
import type { ArgusConfig } from "./config/types"
import { slitherTool } from "./tools/slither-tool"
import { forgeTestTool } from "./tools/forge-test-tool"
import { forgeFuzzTool } from "./tools/forge-fuzz-tool"
import { contractAnalyzerTool } from "./tools/contract-analyzer-tool"
import { patternCheckerTool } from "./tools/pattern-checker-tool"
import { createSoloditSearchTool } from "./tools/solodit-search-tool"
import { reportGeneratorTool } from "./tools/report-generator-tool"
import { syncKnowledgeTool } from "./tools/sync-knowledge-tool"
import { argusSkillLoadTool } from "./tools/argus-skill-load-tool"

export function createTools(
  config: ArgusConfig,
): Record<string, ToolDefinition> {
  const tools: Record<string, ToolDefinition> = {
    argus_slither_analyze: slitherTool,
    argus_forge_test: forgeTestTool,
    argus_forge_fuzz: forgeFuzzTool,
    argus_analyze_contract: contractAnalyzerTool,
    argus_check_patterns: patternCheckerTool,
    argus_skill_load: argusSkillLoadTool,
    argus_generate_report: reportGeneratorTool,
    argus_sync_knowledge: syncKnowledgeTool,
  }

  if (config.solodit?.enabled !== false) {
    tools.argus_solodit_search = createSoloditSearchTool(config.solodit?.port ?? 3000)
  }

  return tools
}
