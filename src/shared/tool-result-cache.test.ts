import { describe, expect, it } from "bun:test"
import { createToolResultCache, getToolResultCache } from "./tool-result-cache"

describe("createToolResultCache", () => {
  it("returns the stored result for a (sessionId, tool) pair", () => {
    const cache = createToolResultCache()
    cache.set("ses_1", "argus_check_patterns", '{"success":true}')

    expect(cache.take("ses_1", "argus_check_patterns")).toBe('{"success":true}')
  })

  it("take removes the entry so a second take returns undefined", () => {
    const cache = createToolResultCache()
    cache.set("ses_1", "argus_check_patterns", "payload")

    expect(cache.take("ses_1", "argus_check_patterns")).toBe("payload")
    expect(cache.take("ses_1", "argus_check_patterns")).toBeUndefined()
  })

  it("returns undefined for a missing key", () => {
    const cache = createToolResultCache()
    expect(cache.take("ses_x", "argus_forge_test")).toBeUndefined()
  })

  it("isolates entries by session and by tool", () => {
    const cache = createToolResultCache()
    cache.set("ses_1", "argus_check_patterns", "a")
    cache.set("ses_2", "argus_check_patterns", "b")
    cache.set("ses_1", "argus_forge_test", "c")

    expect(cache.take("ses_2", "argus_check_patterns")).toBe("b")
    expect(cache.take("ses_1", "argus_forge_test")).toBe("c")
    expect(cache.take("ses_1", "argus_check_patterns")).toBe("a")
  })

  it("keeps the most recent value when the same key is set twice", () => {
    const cache = createToolResultCache()
    cache.set("ses_1", "argus_check_patterns", "old")
    cache.set("ses_1", "argus_check_patterns", "new")

    expect(cache.take("ses_1", "argus_check_patterns")).toBe("new")
  })

  it("evicts the oldest entry when capacity is exceeded", () => {
    const cache = createToolResultCache(2)
    cache.set("ses", "t1", "1")
    cache.set("ses", "t2", "2")
    cache.set("ses", "t3", "3")

    expect(cache.take("ses", "t1")).toBeUndefined()
    expect(cache.take("ses", "t2")).toBe("2")
    expect(cache.take("ses", "t3")).toBe("3")
    expect(cache.size()).toBe(0)
  })

  it("re-setting an existing key refreshes its recency (not evicted as oldest)", () => {
    const cache = createToolResultCache(2)
    cache.set("ses", "t1", "1")
    cache.set("ses", "t2", "2")
    cache.set("ses", "t1", "1b")
    cache.set("ses", "t3", "3")

    expect(cache.take("ses", "t2")).toBeUndefined()
    expect(cache.take("ses", "t1")).toBe("1b")
    expect(cache.take("ses", "t3")).toBe("3")
  })
})

describe("getToolResultCache", () => {
  it("returns a stable process-wide singleton", () => {
    const a = getToolResultCache()
    const b = getToolResultCache()
    expect(a).toBe(b)
  })

  it("singleton round-trips set/take", () => {
    const cache = getToolResultCache()
    cache.set("ses_singleton", "argus_check_patterns", "round-trip")
    expect(cache.take("ses_singleton", "argus_check_patterns")).toBe("round-trip")
  })
})
