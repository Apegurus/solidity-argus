import type { ToolDefinition } from "@opencode-ai/plugin"
import type { ArgusConfig } from "./config/types"
import { argusSkillLoadTool } from "./tools/argus-skill-load-tool"
import { contractAnalyzerTool } from "./tools/contract-analyzer-tool"
import { forgeCoverageTool } from "./tools/forge-coverage-tool"
import { forgeFuzzTool } from "./tools/forge-fuzz-tool"
import { forgeTestTool } from "./tools/forge-test-tool"
import { gasAnalysisTool } from "./tools/gas-analysis-tool"
import { patternCheckerTool } from "./tools/pattern-checker-tool"
import { persistDedupedTool } from "./tools/persist-deduped-tool"
import { proxyDetectionTool } from "./tools/proxy-detection-tool"
import { readFindingsTool } from "./tools/read-findings-tool"
import { recordFindingTool } from "./tools/record-finding-tool"
import { reportGeneratorTool } from "./tools/report-generator-tool"
import { slitherTool } from "./tools/slither-tool"
import { createSoloditSearchTool } from "./tools/solodit-search-tool"
import { syncKnowledgeTool } from "./tools/sync-knowledge-tool"

export function createTools(config: ArgusConfig): Record<string, ToolDefinition> {
  const tools: Record<string, ToolDefinition> = {
    argus_slither_analyze: slitherTool,
    argus_forge_test: forgeTestTool,
    argus_gas_analysis: gasAnalysisTool,
    argus_forge_fuzz: forgeFuzzTool,
    argus_forge_coverage: forgeCoverageTool,
    argus_analyze_contract: contractAnalyzerTool,
    argus_check_patterns: patternCheckerTool,
    argus_proxy_detection: proxyDetectionTool,
    argus_skill_load: argusSkillLoadTool,
    argus_record_finding: recordFindingTool,
    argus_read_findings: readFindingsTool,
    argus_persist_deduped: persistDedupedTool,
    argus_generate_report: reportGeneratorTool,
    argus_sync_knowledge: syncKnowledgeTool,
  }

  if (config.solodit?.enabled !== false) {
    tools.argus_solodit_search = createSoloditSearchTool()
  }

  return tools
}
