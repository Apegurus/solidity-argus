import { describe, expect, it } from "bun:test"
import { createContextMonitor } from "./context-monitor"

describe("createContextMonitor", () => {
  it("estimates tokens as chars/4", () => {
    const monitor = createContextMonitor()
    expect(monitor.estimateTokens("abcd")).toBe(1)
    expect(monitor.estimateTokens("abcde")).toBe(2)
    expect(monitor.estimateTokens("")).toBe(0)
  })

  it("returns no reminder below 70% threshold", () => {
    const monitor = createContextMonitor({ maxTokens: 1000 })
    const text = "a".repeat(2000)
    const status = monitor.getContextStatus(text, null)

    expect(status.usage).toBe(0.5)
    expect(status.reminder).toBeNull()
    expect(status.shouldCompact).toBe(false)
  })

  it("returns reminder at 70% threshold", () => {
    const monitor = createContextMonitor({ maxTokens: 1000 })
    const text = "a".repeat(3000)
    const status = monitor.getContextStatus(text, null)

    expect(status.usage).toBe(0.75)
    expect(status.reminder).toContain("Context at 75%")
    expect(status.shouldCompact).toBe(false)
  })

  it("triggers compaction at 85% threshold", () => {
    const monitor = createContextMonitor({ maxTokens: 1000 })
    const text = "a".repeat(3600)
    const status = monitor.getContextStatus(text, null)

    expect(status.usage).toBe(0.9)
    expect(status.reminder).toContain("Compaction triggered")
    expect(status.shouldCompact).toBe(true)
  })

  it("uses default maxTokens of 200k", () => {
    const monitor = createContextMonitor()
    const text = "a".repeat(400)
    const status = monitor.getContextStatus(text, null)

    expect(status.usage).toBe(100 / 200_000)
    expect(status.reminder).toBeNull()
  })
})
