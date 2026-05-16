import { afterEach, describe, expect, mock, test } from "bun:test"
import { checkRemoteVersion } from "../../src/cli/commands/doctor"

const ORIGINAL_FETCH = globalThis.fetch

function replaceFetch(
  fn: (url: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>,
): void {
  globalThis.fetch = fn as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
})

describe("checkRemoteVersion", () => {
  test("returns up-to-date when local matches remote", async () => {
    replaceFetch(
      mock(async () => new Response(JSON.stringify({ version: "1.2.3" }), { status: 200 })),
    )

    const r = await checkRemoteVersion({ localVersion: "1.2.3" })

    expect(r.status).toBe("up-to-date")
    if (r.status !== "up-to-date") throw new Error("expected up-to-date")
    expect(r.remoteVersion).toBe("1.2.3")
  })

  test("returns outdated when remote is newer", async () => {
    replaceFetch(
      mock(async () => new Response(JSON.stringify({ version: "2.0.0" }), { status: 200 })),
    )

    const r = await checkRemoteVersion({ localVersion: "1.2.3" })

    expect(r.status).toBe("outdated")
    if (r.status !== "outdated") throw new Error("expected outdated")
    expect(r.remoteVersion).toBe("2.0.0")
  })

  test("returns ahead when local is newer than remote", async () => {
    replaceFetch(
      mock(async () => new Response(JSON.stringify({ version: "1.0.0" }), { status: 200 })),
    )

    const r = await checkRemoteVersion({ localVersion: "1.2.3" })

    expect(r.status).toBe("ahead")
  })

  test("returns skipped on network failure", async () => {
    replaceFetch(
      mock(async () => {
        throw new Error("network down")
      }),
    )

    const r = await checkRemoteVersion({ localVersion: "1.2.3" })

    expect(r.status).toBe("skipped")
  })

  test("returns skipped on non-200 response", async () => {
    replaceFetch(mock(async () => new Response("not found", { status: 404 })))

    const r = await checkRemoteVersion({ localVersion: "1.2.3" })

    expect(r.status).toBe("skipped")
  })

  test("returns skipped on malformed JSON", async () => {
    replaceFetch(mock(async () => new Response("not json", { status: 200 })))

    const r = await checkRemoteVersion({ localVersion: "1.2.3" })

    expect(r.status).toBe("skipped")
  })

  test("respects timeout (does not hang on slow fetch)", async () => {
    replaceFetch((_, init) => {
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) return reject(new Error("aborted"))
        signal?.addEventListener("abort", () => reject(new Error("aborted")))
        setTimeout(
          () => resolve(new Response(JSON.stringify({ version: "1.0.0" }), { status: 200 })),
          10_000,
        )
      })
    })
    const start = Date.now()

    const r = await checkRemoteVersion({ localVersion: "1.2.3", timeoutMs: 100 })
    const elapsed = Date.now() - start

    expect(r.status).toBe("skipped")
    expect(elapsed).toBeLessThan(500)
  })
})
