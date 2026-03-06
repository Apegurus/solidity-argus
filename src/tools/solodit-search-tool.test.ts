import { afterEach, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import * as lifecycle from "../solodit-lifecycle"
import {
  _testExports,
  DEFAULT_SOLODIT_PORT,
  executeSoloditSearch,
  type SoloditFetch,
  type SoloditSearchResult,
  soloditSearchTool,
} from "./solodit-search-tool"

const {
  buildTrpcInput,
  mapTrpcFinding,
  truncateDescription,
  parseSseData,
  extractFindingsFromMcpResponse,
  parseFindingsFromAnyResponse,
  parseFinding,
  buildMcpArgs,
  hasMcpError,
} = _testExports

function createContext(): {
  context: ToolContext
  metadataCalls: Array<{ title?: string }>
} {
  const metadataCalls: Array<{ title?: string }> = []
  const abortController = new AbortController()
  const context: ToolContext = {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "argus",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: abortController.signal,
    metadata(input) {
      metadataCalls.push({ title: input.title })
    },
    async ask() {
      return
    },
  }
  return { context, metadataCalls }
}

afterEach(() => {
  lifecycle._resetSoloditState()
})

test("DEFAULT_SOLODIT_PORT is 54173", () => {
  expect(DEFAULT_SOLODIT_PORT).toBe(54173)
})

test("buildTrpcInput returns valid JSON with query embedded", () => {
  const input = buildTrpcInput("reentrancy")
  const parsed = JSON.parse(input) as Record<string, string>
  expect(typeof parsed["0"]).toBe("string")
  const inner = JSON.parse(parsed["0"] ?? "")
  expect(Array.isArray(inner)).toBe(true)
  expect(inner[2]).toBe("reentrancy")
})

test("mapTrpcFinding maps impact to severity and truncates content", () => {
  const raw = {
    title: "Bug",
    slug: "bug-123",
    impact: "HIGH",
    content: "A".repeat(600),
    protocol_name: "Compound",
  }
  const finding = mapTrpcFinding(raw)
  expect(finding.title).toBe("Bug")
  expect(finding.severity).toBe("HIGH")
  expect(finding.description.length).toBeLessThanOrEqual(503)
  expect(finding.protocol).toBe("Compound")
  expect(finding.url).toBe("https://solodit.cyfrin.io/issues/bug-123")
})

test("mapTrpcFinding handles null gracefully", () => {
  expect(mapTrpcFinding(null).title).toBe("")
})

test("truncateDescription leaves short strings unchanged", () => {
  expect(truncateDescription("short")).toBe("short")
})

test("truncateDescription truncates long strings", () => {
  const result = truncateDescription("X".repeat(600))
  expect(result.length).toBe(503)
  expect(result.endsWith("...")).toBe(true)
})

test("parseSseData extracts JSON from SSE", () => {
  expect(parseSseData('event: message\ndata: {"r":true}\n')).toEqual({ r: true })
})

test("parseSseData falls back to plain JSON", () => {
  expect(parseSseData('{"p":"j"}')).toEqual({ p: "j" })
})
test("parseSseData returns null for invalid", () => {
  expect(parseSseData("nope")).toBeNull()
})

test("extractFindingsFromMcpResponse extracts from structuredContent", () => {
  const envelope = {
    result: {
      structuredContent: { reportsJSON: JSON.stringify([{ title: "A", severity: "High" }]) },
    },
  }
  expect(extractFindingsFromMcpResponse(envelope)).toHaveLength(1)
})

test("extractFindingsFromMcpResponse returns empty for non-object", () => {
  expect(extractFindingsFromMcpResponse(null)).toEqual([])
})

test("parseFindingsFromAnyResponse handles direct array", () => {
  expect(parseFindingsFromAnyResponse([{ title: "A" }])).toHaveLength(1)
})

test("parseFinding sanitizes partial objects", () => {
  const f = parseFinding({ title: "P" })
  expect(f.title).toBe("P")
  expect(f.severity).toBe("")
  expect(f.slug).toBe("")
})

test("buildMcpArgs returns keywords for search", () => {
  expect(buildMcpArgs("search", "r", 10)).toEqual({ keywords: "r" })
})
test("buildMcpArgs returns keywords+pageSize for search_findings", () => {
  expect(buildMcpArgs("search_findings", "o", 5)).toEqual({ keywords: "o", pageSize: 5 })
})
test("hasMcpError detects error", () => {
  expect(hasMcpError({ error: {} })).toBe(true)
  expect(hasMcpError(null)).toBe(false)
})

test("soloditSearchTool uses tool() helper contract", () => {
  expect(soloditSearchTool.description.length).toBeGreaterThan(0)
  expect(typeof soloditSearchTool.execute).toBe("function")
})

test("soloditSearchTool.execute returns JSON string", async () => {
  const { context } = createContext()
  const output = await soloditSearchTool.execute({ query: "reentrancy" }, context)
  const parsed = JSON.parse(output) as SoloditSearchResult
  expect(parsed.query).toBe("reentrancy")
  expect(parsed.results).toBeInstanceOf(Array)
})

test("MCP HTTP primary when soloditAvailable=true", async () => {
  const { context } = createContext()
  lifecycle._setSoloditAvailable(true)
  const urls: string[] = []
  const mockFetch: SoloditFetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString()
    urls.push(url)
    return new Response(
      `event: message\ndata: ${JSON.stringify({ result: { structuredContent: { reportsJSON: JSON.stringify([{ title: "MCP Finding", severity: "High" }]) } } })}\n`,
      { status: 200 },
    )
  }
  const result = await executeSoloditSearch({ query: "reentrancy" }, context, 54173, mockFetch)
  expect(result.results).toHaveLength(1)
  expect(result.results[0]?.title).toBe("MCP Finding")
  expect(urls.some((u) => u.includes("localhost:54173/mcp"))).toBe(true)
})

test("falls back to tRPC when MCP returns empty", async () => {
  const { context } = createContext()
  lifecycle._setSoloditAvailable(true)
  const urls: string[] = []
  const mockFetch: SoloditFetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString()
    urls.push(url)
    if (url.includes("localhost"))
      return new Response(`data: ${JSON.stringify({ result: { content: [{ text: "[]" }] } })}\n`, {
        status: 200,
      })
    return new Response(
      JSON.stringify([
        {
          result: {
            data: `({findings: [{title: "tRPC", impact: "HIGH", content: "", protocol_name: "A", slug: "s"}]})`,
          },
        },
      ]),
      { status: 200 },
    )
  }
  const result = await executeSoloditSearch({ query: "oracle" }, context, 54173, mockFetch)
  expect(urls.some((u) => u.includes("solodit.cyfrin.io"))).toBe(true)
  expect(result.results[0]?.title).toBe("tRPC")
})

test("skips MCP when soloditAvailable=false", async () => {
  const { context } = createContext()
  const urls: string[] = []
  const mockFetch: SoloditFetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString()
    urls.push(url)
    return new Response(
      JSON.stringify([
        {
          result: {
            data: `({findings: [{title: "Direct", impact: "M", content: "", protocol_name: "", slug: "d"}]})`,
          },
        },
      ]),
      { status: 200 },
    )
  }
  const result = await executeSoloditSearch({ query: "flash loan" }, context, 54173, mockFetch)
  expect(urls.every((u) => !u.includes("localhost"))).toBe(true)
  expect(result.results[0]?.title).toBe("Direct")
})

test("falls back to tRPC when MCP HTTP 500", async () => {
  const { context } = createContext()
  lifecycle._setSoloditAvailable(true)
  const mockFetch: SoloditFetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url.includes("localhost")) return new Response("err", { status: 500 })
    return new Response(
      JSON.stringify([
        {
          result: {
            data: `({findings: [{title: "FB", impact: "L", content: "", protocol_name: "", slug: "f"}]})`,
          },
        },
      ]),
      { status: 200 },
    )
  }
  const result = await executeSoloditSearch({ query: "overflow" }, context, 54173, mockFetch)
  expect(result.results[0]?.title).toBe("FB")
})

test("falls back to tRPC when MCP throws", async () => {
  const { context } = createContext()
  lifecycle._setSoloditAvailable(true)
  const mockFetch: SoloditFetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url.includes("localhost")) throw new Error("Connection refused")
    return new Response(
      JSON.stringify([
        {
          result: {
            data: `({findings: [{title: "AT", impact: "H", content: "", protocol_name: "", slug: "a"}]})`,
          },
        },
      ]),
      { status: 200 },
    )
  }
  const result = await executeSoloditSearch({ query: "access" }, context, 54173, mockFetch)
  expect(result.results[0]?.title).toBe("AT")
})

test("error when both MCP and tRPC fail", async () => {
  const { context } = createContext()
  lifecycle._setSoloditAvailable(true)
  const mockFetch: SoloditFetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url.includes("localhost")) throw new Error("refused")
    return new Response("err", { status: 503 })
  }
  const result = await executeSoloditSearch({ query: "test" }, context, 54173, mockFetch)
  expect(result.results).toHaveLength(0)
  expect(result.error).toContain("503")
})

test("error when tRPC has no data", async () => {
  const { context } = createContext()
  const mockFetch: SoloditFetch = async () =>
    new Response(JSON.stringify([{ result: {} }]), { status: 200 })
  const result = await executeSoloditSearch({ query: "test" }, context, 54173, mockFetch)
  expect(result.results).toHaveLength(0)
  expect(result.error).toContain("did not include result data")
})

test("applies default limit (10)", async () => {
  const { context } = createContext()
  const findings = Array.from({ length: 15 }, (_, i) => ({
    title: `f-${i}`,
    impact: "L",
    content: "",
    protocol_name: "",
    slug: `s-${i}`,
  }))
  const mockFetch: SoloditFetch = async () =>
    new Response(
      JSON.stringify([{ result: { data: `({findings: ${JSON.stringify(findings)}})` } }]),
      { status: 200 },
    )
  const result = await executeSoloditSearch({ query: "delegatecall" }, context, 54173, mockFetch)
  expect(result.results).toHaveLength(10)
  expect(result.totalFound).toBe(15)
})

test("applies custom limit", async () => {
  const { context } = createContext()
  const findings = Array.from({ length: 15 }, (_, i) => ({
    title: `f-${i}`,
    impact: "L",
    content: "",
    protocol_name: "",
    slug: `s-${i}`,
  }))
  const mockFetch: SoloditFetch = async () =>
    new Response(
      JSON.stringify([{ result: { data: `({findings: ${JSON.stringify(findings)}})` } }]),
      { status: 200 },
    )
  const result = await executeSoloditSearch(
    { query: "delegatecall", limit: 25 },
    context,
    54173,
    mockFetch,
  )
  expect(result.results).toHaveLength(15)
  expect(result.totalFound).toBe(15)
})

test("returns all findings regardless of severity", async () => {
  const { context } = createContext()
  const findings = [
    { title: "A", impact: "HIGH", content: "", protocol_name: "", slug: "a" },
    { title: "B", impact: "LOW", content: "", protocol_name: "", slug: "b" },
    { title: "C", impact: "", content: "", protocol_name: "", slug: "c" },
  ]
  const mockFetch: SoloditFetch = async () =>
    new Response(
      JSON.stringify([{ result: { data: `({findings: ${JSON.stringify(findings)}})` } }]),
      { status: 200 },
    )
  const result = await executeSoloditSearch({ query: "overflow" }, context, 54173, mockFetch)
  expect(result.results).toHaveLength(3)
  expect(result.totalFound).toBe(3)
})

test("falls back to tRPC when MCP returns error envelope", async () => {
  const { context } = createContext()
  lifecycle._setSoloditAvailable(true)
  const mockFetch: SoloditFetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url.includes("localhost"))
      return new Response(`data: ${JSON.stringify({ error: { code: -32601 } })}\n`, { status: 200 })
    return new Response(
      JSON.stringify([
        {
          result: {
            data: `({findings: [{title: "EE", impact: "H", content: "", protocol_name: "", slug: "e"}]})`,
          },
        },
      ]),
      { status: 200 },
    )
  }
  const result = await executeSoloditSearch({ query: "reentrancy" }, context, 54173, mockFetch)
  expect(result.results[0]?.title).toBe("EE")
})
