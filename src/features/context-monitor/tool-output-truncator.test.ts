import { describe, expect, it } from "bun:test"
import { createToolOutputTruncator } from "./tool-output-truncator"

describe("createToolOutputTruncator", () => {
  it("passes through small output unchanged", () => {
    const truncate = createToolOutputTruncator()
    const input = "Short output"
    expect(truncate(input)).toBe(input)
  })

  it("truncates output exceeding max chars", () => {
    const truncate = createToolOutputTruncator({ maxChars: 2000 })
    const input = "x".repeat(5000)
    const result = truncate(input)

    expect(result.length).toBeLessThan(5000)
    expect(result).toContain("[Truncated:")
    expect(result).toContain("5,000")
    expect(result).toContain("2,000")
  })

  it("uses default 50k max chars", () => {
    const truncate = createToolOutputTruncator()
    const input = "x".repeat(60_000)
    const result = truncate(input)

    expect(result).toContain("[Truncated:")
  })

  it("does not truncate at exactly max chars", () => {
    const truncate = createToolOutputTruncator({ maxChars: 2000 })
    const input = "x".repeat(2000)
    expect(truncate(input)).toBe(input)
  })

  it("enforces minimum of 1000 chars", () => {
    const truncate = createToolOutputTruncator({ maxChars: 10 })
    const input = "x".repeat(2000)
    const result = truncate(input)

    expect(result.length).toBeGreaterThan(1000)
  })
})
