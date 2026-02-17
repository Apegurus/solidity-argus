import { tool, type ToolContext } from "@opencode-ai/plugin";

const SOLODIT_MCP_SERVER = "solodit-mcp";
const SOLODIT_MCP_TOOL = "search_findings";
const DEFAULT_LIMIT = 10;

type SoloditSearchArgs = {
  query: string;
  severity?: string[];
  limit?: number;
};

type SoloditFinding = {
  title: string;
  severity: string;
  description: string;
  protocol: string;
  url: string;
  remediation: string;
};

export type SoloditSearchResult = {
  results: SoloditFinding[];
  totalFound: number;
  query: string;
  error?: string;
};

export type CallMcpTool = (
  server: string,
  tool: string,
  args: Record<string, unknown>
) => Promise<unknown>;

type McpCapableContext = ToolContext & { callMcpTool: CallMcpTool };

function hasMcpCapability(ctx: ToolContext): ctx is McpCapableContext {
  return "callMcpTool" in ctx;
}

function parseFinding(raw: unknown): SoloditFinding {
  if (typeof raw !== "object" || raw === null) {
    return {
      title: "",
      severity: "",
      description: "",
      protocol: "",
      url: "",
      remediation: "",
    };
  }

  const obj = raw as Record<string, unknown>;
  return {
    title: typeof obj["title"] === "string" ? obj["title"] : "",
    severity: typeof obj["severity"] === "string" ? obj["severity"] : "",
    description: typeof obj["description"] === "string" ? obj["description"] : "",
    protocol: typeof obj["protocol"] === "string" ? obj["protocol"] : "",
    url: typeof obj["url"] === "string" ? obj["url"] : "",
    remediation: typeof obj["remediation"] === "string" ? obj["remediation"] : "",
  };
}

function parseFindings(response: unknown): SoloditFinding[] {
  if (!Array.isArray(response)) {
    return [];
  }
  return response.map(parseFinding);
}

export async function executeSoloditSearch(
  args: SoloditSearchArgs,
  context: ToolContext,
  callMcpTool?: CallMcpTool
): Promise<SoloditSearchResult> {
  const { query } = args;
  const limit = args.limit ?? DEFAULT_LIMIT;

  context.metadata({ title: `Solodit search: ${query}` });

  const mcpCaller =
    callMcpTool ?? (hasMcpCapability(context) ? context.callMcpTool : undefined);

  if (!mcpCaller) {
    return {
      results: [],
      totalFound: 0,
      query,
      error: `Solodit MCP not available. Add to opencode.json mcp section or ensure solodit-mcp is running. Use @solodit-mcp directly: search_findings({query: '${query}', limit: ${limit}})`,
    };
  }

  try {
    const mcpArgs: Record<string, unknown> = { query, limit };

    if (args.severity && args.severity.length > 0) {
      mcpArgs.filters = { severity: args.severity };
    }

    const response = await mcpCaller(SOLODIT_MCP_SERVER, SOLODIT_MCP_TOOL, mcpArgs);
    const findings = parseFindings(response);

    return {
      results: findings,
      totalFound: findings.length,
      query,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      results: [],
      totalFound: 0,
      query,
      error: `Solodit MCP error: ${message}`,
    };
  }
}

export const soloditSearchTool = tool({
  description:
    "Search Solodit audit findings database for known vulnerabilities and past audit results via the Solodit MCP server.",
  args: {
    query: tool.schema.string(),
    severity: tool.schema.array(tool.schema.string()).optional(),
    limit: tool.schema.number().optional(),
  },
  async execute(args, context) {
    const result = await executeSoloditSearch(args, context);
    return JSON.stringify(result);
  },
});
