import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readJsonBodyCapped, ScvdClient, type ScvdFinding, ScvdNetworkError } from "./scvd-client"

type MockResponseInit = {
  ok?: boolean
  status?: number
  json?: unknown
  text?: string
}

function createMockResponse(init: MockResponseInit): Response {
  const body = init.text ?? JSON.stringify(init.json ?? {})
  return new Response(body, {
    status: init.status ?? (init.ok === false ? 500 : 200),
    headers: { "content-type": "application/json" },
  })
}

function sampleFinding(id: string): ScvdFinding {
  return {
    scvd_id: id,
    doc_id: `doc-${id}`,
    title: `Finding ${id}`,
    description_md: "Reentrancy can occur due to external call before state update.",
    severity: "High",
    taxonomy: { swc: ["SWC-107"], cwe: ["CWE-841"] },
    repo: { url: "https://github.com/example/repo" },
    sections: { recommendation_md: "Use CEI." },
  }
}

describe("ScvdClient", () => {
  const originalFetch = globalThis.fetch

  function setMockFetch(
    implementation: (
      input: string | URL | Request,
      init?: RequestInit | BunFetchRequestInit,
    ) => Promise<Response>,
  ): void {
    const wrapped = Object.assign(implementation, {
      preconnect: originalFetch.preconnect,
    }) as typeof fetch

    globalThis.fetch = wrapped
  }

  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("fetchStats parses stats response", async () => {
    setMockFetch(async () =>
      createMockResponse({
        json: {
          total: 7769,
          by_severity: { High: 1200, Medium: 3000 },
          last_updated: "2026-02-16T00:00:00.000Z",
        },
      }),
    )

    const client = new ScvdClient("https://api.scvd.dev")
    const stats = await client.fetchStats()

    expect(stats.total).toBe(7769)
    expect(stats.by_severity.High).toBe(1200)
    expect(stats.last_updated).toBe("2026-02-16T00:00:00.000Z")
  })

  test("fetchStats parses the schema-0.1 stats response (totals + by_severity array)", async () => {
    setMockFetch(async () =>
      createMockResponse({
        json: {
          totals: { findings: 7769, reports: 213 },
          by_severity: [
            { level: "High", count: 2639 },
            { level: "Medium", count: 2490 },
          ],
          top_swc: [{ swc: "SWC-135", count: 1927 }],
        },
      }),
    )

    const client = new ScvdClient("https://api.scvd.dev")
    const stats = await client.fetchStats()

    expect(stats.total).toBe(7769)
    expect(stats.by_severity.High).toBe(2639)
    expect(stats.by_severity.Medium).toBe(2490)
    expect(stats.last_updated).toBe("")
  })

  test("fetchStats throws descriptive message on HTTP error", async () => {
    setMockFetch(async () => createMockResponse({ status: 503, json: { error: "down" } }))

    const client = new ScvdClient("https://api.scvd.dev")
    try {
      await client.fetchStats()
      expect.unreachable("Expected fetchStats to throw on HTTP error")
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      expect(message).toContain("Failed to fetch SCVD stats")
      expect(message).toContain("503")
    }
  })

  test("fetchFindings sends cursor and parses the schema-0.1 items envelope", async () => {
    const urls: string[] = []
    setMockFetch(async (input) => {
      urls.push(String(input))
      return createMockResponse({
        json: { items: [sampleFinding("SCVD-1"), sampleFinding("SCVD-2")], next_cursor: "next99" },
      })
    })

    const client = new ScvdClient("https://api.scvd.dev/")
    const page = await client.fetchFindings({ severity: "High", limit: 2, cursor: "abc123" })

    expect(page.findings).toHaveLength(2)
    expect(page.findings[0]?.scvd_id).toBe("SCVD-1")
    expect(page.nextCursor).toBe("next99")
    expect(urls[0]).toContain("/findings?")
    expect(urls[0]).toContain("severity=High")
    expect(urls[0]).toContain("limit=2")
    expect(urls[0]).toContain("cursor=abc123")
  })

  test("fetchFindings falls back to full_markdown when description_md is null", async () => {
    setMockFetch(async () =>
      createMockResponse({
        json: {
          items: [
            {
              scvd_id: "SCVD-X",
              doc_id: "doc-X",
              title: "Finding X",
              description_md: null,
              full_markdown: "### Full body\nDetails here.",
              severity: "High",
              repo: { url: "https://github.com/example/repo" },
              taxonomy: { swc: ["SWC-107"], cwe: [] },
              sections: {},
            },
          ],
        },
      }),
    )

    const client = new ScvdClient("https://api.scvd.dev")
    const page = await client.fetchFindings({ limit: 1 })

    expect(page.findings).toHaveLength(1)
    expect(page.findings[0]?.description_md).toContain("Full body")
  })

  test("fetchFindings still parses a legacy bare-array response", async () => {
    setMockFetch(async () => createMockResponse({ json: [sampleFinding("SCVD-9")] }))

    const client = new ScvdClient("https://api.scvd.dev")
    const page = await client.fetchFindings({ limit: 1 })

    expect(page.findings).toHaveLength(1)
    expect(page.findings[0]?.scvd_id).toBe("SCVD-9")
    expect(page.nextCursor).toBeUndefined()
  })

  test("fetchFindings throws ScvdNetworkError on network failure", async () => {
    setMockFetch(async () => {
      throw new Error("network unreachable")
    })

    const client = new ScvdClient("https://api.scvd.dev")
    try {
      await client.fetchFindings({ limit: 10 })
      expect.unreachable("Expected fetchFindings to throw on network error")
    } catch (error) {
      expect(error).toBeInstanceOf(ScvdNetworkError)
      const message = error instanceof Error ? error.message : ""
      expect(message).toContain("network unreachable")
    }
  })

  test("fetchAllFindings follows next_cursor and reports progress", async () => {
    let callCount = 0
    const firstPage = Array.from({ length: 100 }).map((_, index) =>
      sampleFinding(`SCVD-${index + 1}`),
    )

    setMockFetch(async (input) => {
      const url = String(input)

      if (url.includes("/findings")) {
        callCount += 1
        if (callCount === 1) {
          return createMockResponse({ json: { items: firstPage, next_cursor: "c1" } })
        }
        if (callCount === 2) {
          return createMockResponse({
            json: { items: [sampleFinding("SCVD-101")], next_cursor: "c2" },
          })
        }
        return createMockResponse({ json: { items: [], next_cursor: null } })
      }

      return createMockResponse({ json: { items: [] } })
    })

    const progress: number[] = []
    const client = new ScvdClient("https://api.scvd.dev")
    const findings = await client.fetchAllFindings((count) => progress.push(count))

    expect(findings).toHaveLength(101)
    expect(findings[0]?.scvd_id).toBe("SCVD-1")
    expect(findings[100]?.scvd_id).toBe("SCVD-101")
    expect(progress).toEqual([100, 101])
  })

  test("abort signal is forwarded to fetch", async () => {
    const abortController = new AbortController()
    const signals: Array<AbortSignal | null> = []

    setMockFetch(async (_input, init) => {
      const signal = init && "signal" in init ? init.signal : null
      signals.push(signal ?? null)
      return createMockResponse({
        json: {
          total: 1,
          by_severity: { High: 1 },
          last_updated: "2026-02-16T00:00:00.000Z",
        },
      })
    })

    const client = new ScvdClient("https://api.scvd.dev", abortController.signal)
    await client.fetchStats()

    expect(signals).toHaveLength(1)
    expect(signals[0]).toBe(abortController.signal)
  })
})

describe("readJsonBodyCapped", () => {
  test("parses a within-budget JSON response", async () => {
    const response = new Response(JSON.stringify({ total: 3 }))
    const body = (await readJsonBodyCapped(response, "https://scvd.test/stats", 1024)) as {
      total: number
    }
    expect(body.total).toBe(3)
  })

  test("rejects an oversized response instead of buffering it unbounded (WS-6)", async () => {
    const response = new Response("x".repeat(4096))
    await expect(
      readJsonBodyCapped(response, "https://scvd.test/findings", 512),
    ).rejects.toBeInstanceOf(ScvdNetworkError)
  })

  test("rejects a null-body response instead of an unbounded json() fallback (adj_27)", async () => {
    const response = new Response(null, { status: 200 })
    await expect(
      readJsonBodyCapped(response, "https://scvd.test/stats", 512),
    ).rejects.toBeInstanceOf(ScvdNetworkError)
  })
})
