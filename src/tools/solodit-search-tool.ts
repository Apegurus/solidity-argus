import { tool, type ToolContext } from "@opencode-ai/plugin";

const SOLODIT_MCP_SERVER = "solodit-mcp";
const SOLODIT_MCP_TOOL = "search_findings";
const DEFAULT_LIMIT = 10;
const DEFAULT_SOLODIT_PORT = 3000;
const SOLODIT_HTTP_TIMEOUT_MS = 10_000;

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

function parseSseData(body: string): unknown {
  for (const line of body.split("\n")) {
    if (line.startsWith("data: ")) {
      try {
        return JSON.parse(line.slice(6));
      } catch {
        continue;
      }
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function extractFindingsFromMcpResponse(envelope: unknown): SoloditFinding[] {
  if (typeof envelope !== "object" || envelope === null) return [];
  const result = (envelope as Record<string, unknown>).result;
  if (typeof result !== "object" || result === null) return [];

  const structured = (result as Record<string, unknown>).structuredContent;
  const reportsJson =
    typeof structured === "object" && structured !== null
      ? (structured as Record<string, unknown>).reportsJSON
      : undefined;

  if (typeof reportsJson === "string") {
    try {
      const parsed = JSON.parse(reportsJson);
      if (Array.isArray(parsed)) return parsed.map(parseFinding);
    } catch { /* fall through */ }
  }

  const content = (result as Record<string, unknown>).content;
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0] as Record<string, unknown> | undefined;
    if (typeof first?.text === "string") {
      try {
        const parsed = JSON.parse(first.text);
        if (Array.isArray(parsed)) return parsed.map(parseFinding);
      } catch { /* fall through */ }
    }
  }

  return [];
}

async function callSoloditHttp(
  query: string,
  limit: number,
  port: number = DEFAULT_SOLODIT_PORT,
): Promise<SoloditSearchResult> {
  try {
    const response = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: SOLODIT_MCP_TOOL, arguments: { query, limit } },
        id: 1,
      }),
      signal: AbortSignal.timeout(SOLODIT_HTTP_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { results: [], totalFound: 0, query, error: `Solodit HTTP ${response.status}` };
    }

    const body = await response.text();
    const envelope = parseSseData(body);
    const findings = extractFindingsFromMcpResponse(envelope);

    return { results: findings.slice(0, limit), totalFound: findings.length, query };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { results: [], totalFound: 0, query, error: `Solodit MCP unreachable: ${message}` };
  }
}

export async function executeSoloditSearch(
  args: SoloditSearchArgs,
  context: ToolContext,
  callMcpTool?: CallMcpTool,
  port: number = DEFAULT_SOLODIT_PORT,
): Promise<SoloditSearchResult> {
  const { query } = args;
  const limit = args.limit ?? DEFAULT_LIMIT;

  context.metadata({ title: `Solodit search: ${query}` });

  const mcpCaller =
    callMcpTool ?? (hasMcpCapability(context) ? context.callMcpTool : undefined);

  if (!mcpCaller) {
    return callSoloditHttp(query, limit, port);
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
  } catch {
    return callSoloditHttp(query, limit, port);
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
