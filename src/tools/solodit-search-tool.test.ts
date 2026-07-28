import { expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { _testExports, executeSoloditSearch, type SoloditFetch } from "./solodit-search-tool"

const { buildTrpcInput, mapTrpcFinding, truncateDescription, parseFinding, parseTrpcData } =
  _testExports

function createContext(): ToolContext {
  return {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "argus",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: new AbortController().signal,
    metadata() {},
    async ask() {
      return
    },
  }
}

test("buildTrpcInput returns valid JSON with query embedded", () => {
  const input = buildTrpcInput("reentrancy")
  const parsed = JSON.parse(input) as Record<string, string>
  expect(typeof parsed["0"]).toBe("string")
  const inner = JSON.parse(parsed["0"] ?? "")
  expect(Array.isArray(inner)).toBe(true)
  expect(inner[2]).toBe("reentrancy")
})

test("mapTrpcFinding maps impact to severity and truncates content", () => {
  const finding = mapTrpcFinding({
    title: "Bug",
    slug: "bug-123",
    impact: "HIGH",
    content: "A".repeat(600),
    protocol_name: "Compound",
  })
  expect(finding.title).toBe("Bug")
  expect(finding.severity).toBe("HIGH")
  expect(finding.description.length).toBeLessThanOrEqual(503)
  expect(finding.protocol).toBe("Compound")
})

test("truncateDescription leaves short strings unchanged", () => {
  expect(truncateDescription("short")).toBe("short")
})

test("parseFinding sanitizes partial objects", () => {
  const f = parseFinding({ title: "P" })
  expect(f.title).toBe("P")
  expect(f.severity).toBe("")
  expect(f.slug).toBe("")
})

test("parseTrpcData handles standard JSON and malformed payloads", () => {
  expect(parseTrpcData('{"findings":[{"title":"A"}]}')).toEqual({ findings: [{ title: "A" }] })
  expect(parseTrpcData("not-json")).toEqual({})
})

test("executeSoloditSearch uses direct tRPC results", async () => {
  const mockFetch: SoloditFetch = async () =>
    new Response(
      JSON.stringify([
        {
          result: {
            data: `({findings: [{title: "Valid", impact: "HIGH", content: "ok", protocol_name: "P", slug: "valid-1"}]})`,
          },
        },
      ]),
      { status: 200 },
    )

  const result = await executeSoloditSearch({ query: "valid" }, createContext(), mockFetch)
  expect(result.error).toBeUndefined()
  expect(result.totalFound).toBe(1)
  expect(result.results[0]?.title).toBe("Valid")
})

test("executeSoloditSearch rejects an oversized tRPC response before parsing it", async () => {
  const mockFetch: SoloditFetch = async () => new Response("x".repeat(1_048_577))

  const result = await executeSoloditSearch({ query: "oversized" }, createContext(), mockFetch)

  expect(result.results).toEqual([])
  expect(result.error).toContain("exceeded the 1048576-byte cap")
})

test("executeSoloditSearch parses the live devalue response shape without evaluating code", async () => {
  const liveShape = `(function(a){a[0]={wardens_warden:{handle:"Cyfrin"}};return {findings:[{id:45750n,kind:"MARKDOWN",impact:"HIGH",title:"[H-01] Reentrancy",content:"External call before state update",report_date:new Date(1729036800000),slug:"reentrancy-live-shape",protocol_name:"Example",issues_issue_finders:[a[0]]}]}}([]))`
  const mockFetch: SoloditFetch = async () =>
    new Response(JSON.stringify([{ result: { data: liveShape } }]), { status: 200 })

  const result = await executeSoloditSearch({ query: "reentrancy" }, createContext(), mockFetch)

  expect(result.error).toBeUndefined()
  expect(result.totalFound).toBe(1)
  expect(result.results[0]).toMatchObject({
    title: "[H-01] Reentrancy",
    severity: "HIGH",
    description: "External call before state update",
    protocol: "Example",
    url: "https://solodit.cyfrin.io/issues/reentrancy-live-shape",
  })
})
