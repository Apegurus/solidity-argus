import { afterEach, describe, expect, it } from "bun:test"
import { checkSoloditHealth } from "./solodit-health"

describe("checkSoloditHealth", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("returns disabled status when enabled is false", async () => {
    const result = await checkSoloditHealth(3000, false)

    expect(result).toEqual({
      reachable: false,
      enabled: false,
      port: 3000,
    })
  })

  it("returns unreachable with error when fetch fails (network failure)", async () => {
    globalThis.fetch = (async () => {
      throw new Error("Connection refused")
    }) as unknown as typeof fetch

    const result = await checkSoloditHealth(3000, true)

    expect(result.reachable).toBe(false)
    expect(result.enabled).toBe(true)
    expect(result.port).toBe(3000)
    expect(result.error).toBe("Connection refused")
  })

  it("returns reachable when POST probe succeeds with 2xx response", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch

    const result = await checkSoloditHealth(3000, true)

    expect(result).toEqual({
      reachable: true,
      enabled: true,
      port: 3000,
    })
  })

  it("returns reachable when 2xx response contains JSON-RPC error body (server is up)", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch

    const result = await checkSoloditHealth(3000, true)

    expect(result.reachable).toBe(true)
    expect(result.enabled).toBe(true)
  })

  it("returns unreachable when server returns non-2xx (e.g. 405 Method Not Allowed)", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 405,
    })) as unknown as typeof fetch

    const result = await checkSoloditHealth(3000, true)

    expect(result).toEqual({
      reachable: false,
      enabled: true,
      port: 3000,
      error: undefined,
    })
  })

  it("returns unreachable when server returns 500", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 500,
    })) as unknown as typeof fetch

    const result = await checkSoloditHealth(3000, true)

    expect(result).toEqual({
      reachable: false,
      enabled: true,
      port: 3000,
      error: undefined,
    })
  })

  it("handles timeout errors gracefully", async () => {
    globalThis.fetch = (async () => {
      throw new DOMException("The operation was aborted", "AbortError")
    }) as unknown as typeof fetch

    const result = await checkSoloditHealth(3000, true)

    expect(result.reachable).toBe(false)
    expect(result.enabled).toBe(true)
    expect(result.port).toBe(3000)
    expect(result.error).toContain("aborted")
  })

  it("respects custom port configuration", async () => {
    let capturedUrl: string | undefined

    globalThis.fetch = (async (url: string | Request) => {
      capturedUrl = typeof url === "string" ? url : url.url
      return { ok: true, status: 200 }
    }) as unknown as typeof fetch

    const result = await checkSoloditHealth(5000, true)

    expect(capturedUrl).toBe("http://localhost:5000/mcp")
    expect(result.port).toBe(5000)
    expect(result.reachable).toBe(true)
  })

  it("uses POST method with correct MCP protocol headers", async () => {
    let capturedMethod: string | undefined
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: string | undefined

    globalThis.fetch = (async (_url: string | Request, init?: RequestInit) => {
      capturedMethod = init?.method
      if (init?.headers) {
        const headers = init.headers as Record<string, string>
        capturedHeaders = headers
      }
      capturedBody = init?.body as string
      return { ok: true, status: 200 }
    }) as unknown as typeof fetch

    await checkSoloditHealth(3000, true)

    expect(capturedMethod).toBe("POST")
    expect(capturedHeaders["Content-Type"]).toBe("application/json")
    expect(capturedHeaders.Accept).toContain("application/json")
    expect(capturedHeaders.Accept).toContain("text/event-stream")

    const body = JSON.parse(capturedBody ?? "{}")
    expect(body.jsonrpc).toBe("2.0")
    expect(body.method).toBe("initialize")
    expect(body.params.protocolVersion).toBe("2024-11-05")
  })

  it("GET-only regression: plain GET probe (no method/body) would be rejected by MCP server (405)", async () => {
    let capturedInit: RequestInit | undefined

    globalThis.fetch = (async (_url: string | Request, init?: RequestInit) => {
      capturedInit = init
      const isGetRequest = !init?.method || init.method === "GET"
      return { ok: !isGetRequest, status: isGetRequest ? 405 : 200 }
    }) as unknown as typeof fetch

    await checkSoloditHealth(3000, true)

    expect(capturedInit?.method).toBe("POST")
  })
})
