import type { ToolDefinition } from "@opencode-ai/plugin"
import { type ToolContext, tool } from "@opencode-ai/plugin"
import { createLogger } from "../shared/logger"
import { soloditAvailable } from "../solodit-lifecycle"

const logger = createLogger()

const SOLODIT_MCP_SERVER = "solodit-mcp"
const SOLODIT_MCP_TOOLS = ["search", "search_findings"] as const
const DEFAULT_LIMIT = 10
const DEFAULT_SOLODIT_PORT = 3000
const SOLODIT_HTTP_TIMEOUT_MS = 10_000

type SoloditSearchArgs = {
  query: string
  severity?: string[]
  limit?: number
}

type SoloditFinding = {
  title: string
  severity: string
  description: string
  protocol: string
  url: string
  remediation: string
}

export type SoloditSearchResult = {
  results: SoloditFinding[]
  totalFound: number
  query: string
  error?: string
}

export type CallMcpTool = (
  server: string,
  tool: string,
  args: Record<string, unknown>,
) => Promise<unknown>

type McpCapableContext = ToolContext & { callMcpTool: CallMcpTool }

function hasMcpCapability(ctx: ToolContext): ctx is McpCapableContext {
  return "callMcpTool" in ctx
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
    }
  }

  const obj = raw as Record<string, unknown>
  return {
    title: typeof obj.title === "string" ? obj.title : "",
    severity: typeof obj.severity === "string" ? obj.severity : "",
    description: typeof obj.description === "string" ? obj.description : "",
    protocol: typeof obj.protocol === "string" ? obj.protocol : "",
    url: typeof obj.url === "string" ? obj.url : "",
    remediation: typeof obj.remediation === "string" ? obj.remediation : "",
  }
}

function parseFindings(response: unknown): SoloditFinding[] {
  if (!Array.isArray(response)) {
    return []
  }
  return response.map(parseFinding)
}

function parseFindingsFromAnyResponse(response: unknown): SoloditFinding[] {
  const direct = parseFindings(response)
  if (direct.length > 0) return direct

  if (typeof response === "object" && response !== null) {
    const findings = (response as Record<string, unknown>).findings
    if (Array.isArray(findings)) return findings.map(parseFinding)
  }

  return extractFindingsFromMcpResponse(response)
}

function hasMcpError(response: unknown): boolean {
  if (typeof response !== "object" || response === null) return false
  const obj = response as Record<string, unknown>
  return "error" in obj
}

function normalizeImpacts(
  severity?: string[],
): Array<"HIGH" | "MEDIUM" | "LOW" | "GAS"> | undefined {
  if (!severity || severity.length === 0) return undefined
  const allowed = new Set(["HIGH", "MEDIUM", "LOW", "GAS"] as const)
  const impacts = severity
    .map((s) => s.toUpperCase())
    .filter((s): s is "HIGH" | "MEDIUM" | "LOW" | "GAS" =>
      allowed.has(s as "HIGH" | "MEDIUM" | "LOW" | "GAS"),
    )
  return impacts.length > 0 ? impacts : undefined
}

function buildMcpArgs(
  toolName: (typeof SOLODIT_MCP_TOOLS)[number],
  query: string,
  limit: number,
  severity?: string[],
): Record<string, unknown> {
  if (toolName === "search") {
    return { keywords: query }
  }

  const impact = normalizeImpacts(severity)
  return {
    keywords: query,
    ...(impact ? { impact } : {}),
    pageSize: limit,
  }
}

function filterFindingsBySeverity(
  findings: SoloditFinding[],
  severities?: string[],
): SoloditFinding[] {
  if (!severities || severities.length === 0) return findings

  const allowed = new Set(severities.map((s) => s.toLowerCase()))
  return findings.filter((finding) => allowed.has(finding.severity.toLowerCase()))
}

function parseSseData(body: string): unknown {
  for (const line of body.split("\n")) {
    if (line.startsWith("data: ")) {
      try {
        return JSON.parse(line.slice(6))
      } catch {}
    }
  }
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

function extractFindingsFromMcpResponse(envelope: unknown): SoloditFinding[] {
  if (typeof envelope !== "object" || envelope === null) return []
  const result = (envelope as Record<string, unknown>).result
  if (typeof result !== "object" || result === null) return []

  const structured = (result as Record<string, unknown>).structuredContent
  const reportsJson =
    typeof structured === "object" && structured !== null
      ? (structured as Record<string, unknown>).reportsJSON
      : undefined

  if (typeof reportsJson === "string") {
    try {
      const parsed = JSON.parse(reportsJson)
      if (Array.isArray(parsed)) return parsed.map(parseFinding)
    } catch {
      logger.debug("Failed to parse Solodit structured response")
    }
  }

  const content = (result as Record<string, unknown>).content
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0] as Record<string, unknown> | undefined
    if (typeof first?.text === "string") {
      try {
        const parsed = JSON.parse(first.text)
        if (Array.isArray(parsed)) return parsed.map(parseFinding)
      } catch {
        logger.debug("Failed to parse Solodit content text")
      }
    }
  }

  return []
}

async function callSoloditHttp(
  query: string,
  limit: number,
  severities?: string[],
  port: number = DEFAULT_SOLODIT_PORT,
): Promise<SoloditSearchResult> {
  let lastError: string | undefined

  for (const toolName of SOLODIT_MCP_TOOLS) {
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
          params: { name: toolName, arguments: buildMcpArgs(toolName, query, limit, severities) },
          id: 1,
        }),
        signal: AbortSignal.timeout(SOLODIT_HTTP_TIMEOUT_MS),
      })

      if (!response.ok) {
        lastError = `Solodit HTTP ${response.status}`
        continue
      }

      const body = await response.text()
      const envelope = parseSseData(body)

      if (hasMcpError(envelope)) {
        continue
      }

      const findings = filterFindingsBySeverity(parseFindingsFromAnyResponse(envelope), severities)

      return { results: findings.slice(0, limit), totalFound: findings.length, query }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      lastError = `Solodit MCP unreachable: ${message}`
    }
  }

  return { results: [], totalFound: 0, query, error: lastError ?? "Solodit MCP call failed" }
}

export async function executeSoloditSearch(
  args: SoloditSearchArgs,
  context: ToolContext,
  callMcpTool?: CallMcpTool,
  port: number = DEFAULT_SOLODIT_PORT,
): Promise<SoloditSearchResult> {
  const { query } = args
  const limit = args.limit ?? DEFAULT_LIMIT

  context.metadata({ title: `Solodit search: ${query}` })

  // Belt-and-suspenders: check if Solodit MCP is available, with 3s retry
  // Skip check in test environment
  if (!soloditAvailable && process.env.NODE_ENV !== "test") {
    // Wait up to 3s for monitoring to flip the flag
    for (let i = 0; i < 3 && !soloditAvailable; i++) {
      await Bun.sleep(1000)
    }
    if (!soloditAvailable) {
      return {
        results: [],
        totalFound: 0,
        query,
        error: "Solodit MCP not available — server did not start. Results limited to local patterns.",
      }
    }
  }

  const mcpCaller = callMcpTool ?? (hasMcpCapability(context) ? context.callMcpTool : undefined)

  if (!mcpCaller) {
    return callSoloditHttp(query, limit, args.severity, port)
  }

  let hadMcpError = false
  for (const toolName of SOLODIT_MCP_TOOLS) {
    try {
      const response = await mcpCaller(
        SOLODIT_MCP_SERVER,
        toolName,
        buildMcpArgs(toolName, query, limit, args.severity),
      )

      if (hasMcpError(response)) {
        hadMcpError = true
        continue
      }

      const findings = filterFindingsBySeverity(
        parseFindingsFromAnyResponse(response),
        args.severity,
      )

      return {
        results: findings.slice(0, limit),
        totalFound: findings.length,
        query,
      }
    } catch {
      hadMcpError = true
    }
  }

  const fallback = await callSoloditHttp(query, limit, args.severity, port)
  if (fallback.error || hadMcpError) {
    return fallback
  }

  return fallback
}

export function createSoloditSearchTool(port: number = DEFAULT_SOLODIT_PORT): ToolDefinition {
  return tool({
    description:
      "Search Solodit audit findings database for known vulnerabilities and past audit results via the Solodit MCP server.",
    args: {
      query: tool.schema.string(),
      severity: tool.schema.array(tool.schema.string()).optional(),
      limit: tool.schema.number().optional(),
    },
    async execute(args, context) {
      const result = await executeSoloditSearch(args, context, undefined, port)
      return JSON.stringify(result)
    },
  })
}

export const soloditSearchTool = createSoloditSearchTool()
