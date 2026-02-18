import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test"
import { doctorCommand } from "./doctor"

describe("doctorCommand", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("ok", { status: 200 })),
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("has correct name and description", () => {
    expect(doctorCommand.name).toBe("doctor")
    expect(doctorCommand.description).toBeTruthy()
  })

  it("execute returns a number", async () => {
    const exitCode = await doctorCommand.execute([])
    expect(typeof exitCode).toBe("number")
    expect([0, 1]).toContain(exitCode)
  })
})
