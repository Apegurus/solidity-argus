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

  it("returns unreachable with error when fetch fails", async () => {
    globalThis.fetch = (async () => {
      throw new Error("Connection refused")
    }) as unknown as typeof fetch

    const result = await checkSoloditHealth(3000, true)

    expect(result.reachable).toBe(false)
    expect(result.enabled).toBe(true)
    expect(result.port).toBe(3000)
    expect(result.error).toBe("Connection refused")
  })

  it("returns reachable when fetch succeeds with ok response", async () => {
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

  it("returns unreachable when fetch succeeds but response is not ok", async () => {
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
    globalThis.fetch = (async (url: string | Request) => {
      const urlStr = typeof url === "string" ? url : url.url
      expect(urlStr).toBe("http://localhost:5000/mcp")
      return { ok: true, status: 200 }
    }) as unknown as typeof fetch

    const result = await checkSoloditHealth(5000, true)

    expect(result.port).toBe(5000)
    expect(result.reachable).toBe(true)
  })
})
