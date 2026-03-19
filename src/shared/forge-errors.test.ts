import { describe, expect, test } from "bun:test"
import { type ToolContext } from "@opencode-ai/plugin"
import { classifyForgeError, FOUNDRY_NOT_FOUND_MESSAGE } from "./forge-errors"

function createContext(aborted = false): ToolContext {
  return {
    abort: { aborted } as AbortSignal,
    sessionID: "test-session",
    agent: "sentinel",
    metadata: () => {},
  } as unknown as ToolContext
}

describe("classifyForgeError", () => {
  test("returns abort message when context is aborted", () => {
    const result = classifyForgeError(new Error("whatever"), createContext(true), "forge test")
    expect(result).toBe("forge test aborted")
  })

  test("returns abort message for DOMException with AbortError name", () => {
    const error = new DOMException("The operation was aborted", "AbortError")
    const result = classifyForgeError(error, createContext(false), "forge fuzz")
    expect(result).toBe("forge fuzz aborted")
  })

  test("returns foundry not found for ENOENT", () => {
    const error = Object.assign(new Error("spawn forge ENOENT"), { code: "ENOENT" })
    const result = classifyForgeError(error, createContext(), "forge test")
    expect(result).toBe(FOUNDRY_NOT_FOUND_MESSAGE)
  })

  test("returns timeout message for ETIMEDOUT code", () => {
    const error = Object.assign(new Error("connection timed out"), { code: "ETIMEDOUT" })
    const result = classifyForgeError(error, createContext(), "forge coverage")
    expect(result).toBe("forge coverage timed out")
  })

  test("returns timeout message when error message contains 'timed out'", () => {
    const error = new Error("Command timed out after 60s")
    const result = classifyForgeError(error, createContext(), "forge gas analysis")
    expect(result).toBe("forge gas analysis timed out")
  })

  test("returns undefined for unrecognized errors", () => {
    const error = new Error("some random failure")
    const result = classifyForgeError(error, createContext(), "forge test")
    expect(result).toBeUndefined()
  })

  test("handles non-Error objects gracefully", () => {
    const result = classifyForgeError("string error", createContext(), "forge test")
    expect(result).toBeUndefined()
  })

  test("handles error with undefined message", () => {
    const error = { code: "ENOENT" } as unknown as Error
    const result = classifyForgeError(error, createContext(), "forge test")
    expect(result).toBe(FOUNDRY_NOT_FOUND_MESSAGE)
  })

  test("prefers abort detection over other error codes", () => {
    const error = Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    const result = classifyForgeError(error, createContext(true), "forge test")
    expect(result).toBe("forge test aborted")
  })
})
