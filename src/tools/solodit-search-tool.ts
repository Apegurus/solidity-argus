import type { ToolDefinition } from "@opencode-ai/plugin"
import { type ToolContext, tool } from "@opencode-ai/plugin"
import { createLogger } from "../shared/logger"
import { isSoloditAvailable } from "../solodit-lifecycle"

const logger = createLogger()

const SOLODIT_MCP_TOOLS = ["search", "search_findings"] as const
const DEFAULT_LIMIT = 10
export const DEFAULT_SOLODIT_PORT = 54173
const SOLODIT_HTTP_TIMEOUT_MS = 10_000
const SOLODIT_TRPC_TIMEOUT_MS = 15_000
const SOLODIT_TRPC_ENDPOINT = "https://solodit.cyfrin.io/api/trpc/findings.get"

type SoloditSearchArgs = {
  query: string
  limit?: number
}

export type SoloditFinding = {
  title: string
  slug: string
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

/** Fetch abstraction for testing */
export type SoloditFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Extract severity from common audit title prefixes like [H-01], [M-17], H-1:, M-2: */
function extractSeverityFromTitle(title: string): string {
  const match = title.match(/^\[?([HMhm])[-\s]?\d+\]?[:\s]/)
  if (match) {
    const letter = match[1]?.toUpperCase()
    if (letter === "H") return "High"
    if (letter === "M") return "Medium"
  }
  const prefixMatch = title.match(/^\[?(Critical|High|Medium|Low|Informational)\]?[:\s-]/i)
  if (prefixMatch) {
    const severity = prefixMatch[1]
    if (!severity) return ""
    const s = severity.toLowerCase()
    return s.charAt(0).toUpperCase() + s.slice(1)
  }
  return ""
}

const SOLODIT_BASE_URL = "https://solodit.cyfrin.io/issues"

function parseFinding(raw: unknown): SoloditFinding {
  if (typeof raw !== "object" || raw === null) {
    return {
      title: "",
      slug: "",
      severity: "",
      description: "",
      protocol: "",
      url: "",
      remediation: "",
    }
  }

  const obj = raw as Record<string, unknown>
  const title = typeof obj.title === "string" ? obj.title : ""
  const slug = typeof obj.slug === "string" ? obj.slug : ""
  const severity =
    typeof obj.severity === "string" && obj.severity.length > 0
      ? obj.severity
      : extractSeverityFromTitle(title)
  const url =
    typeof obj.url === "string" && obj.url.length > 0
      ? obj.url
      : slug.length > 0
        ? `${SOLODIT_BASE_URL}/${slug}`
        : ""

  return {
    title,
    slug,
    severity,
    description: typeof obj.description === "string" ? obj.description : title,
    protocol: typeof obj.protocol === "string" ? obj.protocol : "",
    url,
    remediation: typeof obj.remediation === "string" ? obj.remediation : "",
  }
}

function parseFindings(response: unknown): SoloditFinding[] {
  if (!Array.isArray(response)) return []
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
  return "error" in (response as Record<string, unknown>)
}

function buildMcpArgs(
  toolName: (typeof SOLODIT_MCP_TOOLS)[number],
  query: string,
  limit: number,
): Record<string, unknown> {
  if (toolName === "search") {
    return { keywords: query }
  }
  return { keywords: query, pageSize: limit }
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

// ---------------------------------------------------------------------------
// Primary path: MCP HTTP
// ---------------------------------------------------------------------------

async function callSoloditMcpHttp(
  query: string,
  limit: number,
  port: number,
  fetchImpl: SoloditFetch = fetch,
): Promise<SoloditSearchResult | null> {
  if (!isSoloditAvailable()) {
    logger.debug(`[solodit] MCP not available — skipping HTTP primary path`)
    return null
  }

  let lastError: string | undefined

  for (const toolName of SOLODIT_MCP_TOOLS) {
    try {
      const response = await fetchImpl(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: toolName, arguments: buildMcpArgs(toolName, query, limit) },
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

      const findings = parseFindingsFromAnyResponse(envelope)
      return { results: findings.slice(0, limit), totalFound: findings.length, query }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      lastError = `Solodit MCP unreachable: ${message}`
    }
  }

  logger.debug(
    `[solodit] MCP HTTP failed: ${lastError ?? "all tools failed"} — will try tRPC fallback`,
  )
  return null
}

// ---------------------------------------------------------------------------
// Fallback path: tRPC direct to solodit.cyfrin.io
// ---------------------------------------------------------------------------

function buildTrpcInput(query: string, page: number = 1): string {
  const inner = JSON.stringify([
    { filters: 1, page: 20 },
    {
      keywords: 2,
      firms: 3,
      tags: 4,
      forked: 5,
      impact: 6,
      user: -1,
      protocol: -1,
      reported: 10,
      reportedAfter: -1,
      protocolCategory: 13,
      minFinders: 14,
      maxFinders: 15,
      rarityScore: 16,
      qualityScore: 16,
      bookmarked: 17,
      read: 17,
      unread: 17,
      sortField: 18,
      sortDirection: 19,
    },
    query,
    [],
    [],
    [],
    [7, 8, 9],
    "HIGH",
    "MEDIUM",
    "LOW",
    { label: 11, value: 12 },
    "All time",
    "alltime",
    [],
    "1",
    "100",
    1,
    true,
    "Recency",
    "Desc",
    page,
  ])
  return JSON.stringify({ 0: inner })
}

function truncateDescription(content: string): string {
  return content.length > 500 ? `${content.slice(0, 500)}...` : content
}

function mapTrpcFinding(raw: unknown): SoloditFinding {
  if (typeof raw !== "object" || raw === null) {
    return {
      title: "",
      slug: "",
      severity: "",
      description: "",
      protocol: "",
      url: "",
      remediation: "",
    }
  }

  const finding = raw as Record<string, unknown>
  const slug = typeof finding.slug === "string" ? finding.slug : ""
  const content = typeof finding.content === "string" ? finding.content : ""

  return {
    title: typeof finding.title === "string" ? finding.title : "",
    slug,
    severity: typeof finding.impact === "string" ? finding.impact : "",
    description: truncateDescription(content),
    protocol: typeof finding.protocol_name === "string" ? finding.protocol_name : "",
    url: slug ? `https://solodit.cyfrin.io/issues/${slug}` : "",
    remediation: "",
  }
}

function parseTrpcData(dataStr: string): { findings?: unknown } {
  try {
    const jsonStr = dataStr
      .trim()
      .replace(/^\(/, "")
      .replace(/\)$/, "")
      .replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":')
    return JSON.parse(jsonStr) as { findings?: unknown }
  } catch {
    return {}
  }
}

async function callSoloditTrpc(
  query: string,
  limit: number,
  fetchImpl: SoloditFetch = fetch,
): Promise<SoloditSearchResult> {
  try {
    const input = buildTrpcInput(query)
    const url = `${SOLODIT_TRPC_ENDPOINT}?batch=1&input=${encodeURIComponent(input)}`
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        accept: "*/*",
        referer: "https://solodit.cyfrin.io/",
        origin: "https://solodit.cyfrin.io",
      },
      signal: AbortSignal.timeout(SOLODIT_TRPC_TIMEOUT_MS),
    })

    if (!response.ok) {
      return {
        results: [],
        totalFound: 0,
        query,
        error: `Solodit tRPC returned ${response.status}`,
      }
    }

    const responseText = await response.text()
    const batchResults = JSON.parse(responseText) as Array<Record<string, unknown>>
    const first = batchResults[0] as { result?: { data?: unknown } } | undefined
    const dataStr = typeof first?.result?.data === "string" ? first.result.data : ""

    if (!dataStr) {
      return {
        results: [],
        totalFound: 0,
        query,
        error: "Solodit tRPC response did not include result data",
      }
    }

    const parsed = parseTrpcData(dataStr)
    if (!Array.isArray(parsed.findings)) {
      return { results: [], totalFound: 0, query, error: "Failed to parse Solodit response" }
    }
    const findingsRaw = parsed.findings
    const findings = findingsRaw.map(mapTrpcFinding)
    return { results: findings.slice(0, limit), totalFound: findings.length, query }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    logger.debug(`[solodit] tRPC fallback error for query '${query}': ${message}`)
    return { results: [], totalFound: 0, query, error: `Solodit tRPC fallback failed: ${message}` }
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function executeSoloditSearch(
  args: SoloditSearchArgs,
  context: ToolContext,
  port: number = DEFAULT_SOLODIT_PORT,
  fetchImpl: SoloditFetch = fetch,
): Promise<SoloditSearchResult> {
  const { query } = args
  const limit = args.limit ?? DEFAULT_LIMIT

  context.metadata({ title: `Solodit search: ${query}` })

  // Primary: MCP HTTP to local solodit-mcp server
  const mcpResult = await callSoloditMcpHttp(query, limit, port, fetchImpl)
  if (mcpResult !== null && mcpResult.results.length > 0) {
    logger.debug(`[solodit] MCP HTTP returned ${mcpResult.results.length} findings for '${query}'`)
    return mcpResult
  }

  // Fallback: tRPC direct to solodit.cyfrin.io
  logger.debug(`[solodit] Falling back to tRPC for query: ${query}`)
  return callSoloditTrpc(query, limit, fetchImpl)
}

export function createSoloditSearchTool(port: number = DEFAULT_SOLODIT_PORT): ToolDefinition {
  return tool({
    description:
      "Search Solodit audit findings database for known vulnerabilities and past audit results.",
    args: {
      query: tool.schema.string(),
      limit: tool.schema.number().optional(),
    },
    async execute(args, context) {
      const result = await executeSoloditSearch(args, context, port)
      return JSON.stringify(result)
    },
  })
}

export const soloditSearchTool = createSoloditSearchTool()

// ---------------------------------------------------------------------------
// Test-only exports
// ---------------------------------------------------------------------------

export const _testExports = {
  buildTrpcInput,
  mapTrpcFinding,
  truncateDescription,
  callSoloditMcpHttp,
  callSoloditTrpc,
  parseSseData,
  extractFindingsFromMcpResponse,
  parseFindingsFromAnyResponse,
  parseFinding,
  buildMcpArgs,
  hasMcpError,
  parseTrpcData,
}
