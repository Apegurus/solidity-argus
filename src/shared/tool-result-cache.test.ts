import { describe, expect, it } from "bun:test"
import { createToolResultCache, getToolResultCache } from "./tool-result-cache"

describe("createToolResultCache", () => {
  it("returns a stored result whose prefix matches the query", () => {
    const cache = createToolResultCache()
    cache.set("ses_1", "argus_check_patterns", '{"success":true}')

    expect(cache.takeMatch("ses_1", "argus_check_patterns", '{"success')).toBe('{"success":true}')
  })

  it("matches any stored result when the prefix is empty", () => {
    const cache = createToolResultCache()
    cache.set("ses_1", "argus_check_patterns", "payload")

    expect(cache.takeMatch("ses_1", "argus_check_patterns", "")).toBe("payload")
  })

  it("consumes the matched entry so a second takeMatch returns undefined", () => {
    const cache = createToolResultCache()
    cache.set("ses_1", "argus_check_patterns", "payload")

    expect(cache.takeMatch("ses_1", "argus_check_patterns", "pay")).toBe("payload")
    expect(cache.takeMatch("ses_1", "argus_check_patterns", "pay")).toBeUndefined()
  })

  it("returns undefined for a missing key", () => {
    const cache = createToolResultCache()
    expect(cache.takeMatch("ses_x", "argus_forge_test", "")).toBeUndefined()
  })

  it("does not consume an entry when the prefix does not match", () => {
    const cache = createToolResultCache()
    cache.set("ses_1", "argus_skill_load", "alpha-result")

    expect(cache.takeMatch("ses_1", "argus_skill_load", "beta")).toBeUndefined()
    expect(cache.size()).toBe(1)
    expect(cache.takeMatch("ses_1", "argus_skill_load", "alpha")).toBe("alpha-result")
  })

  it("isolates entries by session and by tool", () => {
    const cache = createToolResultCache()
    cache.set("ses_1", "argus_check_patterns", "a")
    cache.set("ses_2", "argus_check_patterns", "b")
    cache.set("ses_1", "argus_forge_test", "c")

    expect(cache.takeMatch("ses_2", "argus_check_patterns", "")).toBe("b")
    expect(cache.takeMatch("ses_1", "argus_forge_test", "")).toBe("c")
    expect(cache.takeMatch("ses_1", "argus_check_patterns", "")).toBe("a")
  })

  it("recovers each parallel same-key result by its own distinct prefix", () => {
    const cache = createToolResultCache()
    const a = '{"call":"a","matches":["reentrancy"]}'
    const b = '{"call":"b","matches":["access-control","oracle"]}'
    cache.set("ses_1", "argus_check_patterns", a)
    cache.set("ses_1", "argus_check_patterns", b)

    expect(cache.takeMatch("ses_1", "argus_check_patterns", '{"call":"b"')).toBe(b)
    expect(cache.size()).toBe(1)
    expect(cache.takeMatch("ses_1", "argus_check_patterns", '{"call":"a"')).toBe(a)
    expect(cache.size()).toBe(0)
  })

  it("returns the longest super-string when several entries share the prefix", () => {
    const cache = createToolResultCache()
    cache.set("ses_1", "argus_solodit_search", "AAAA")
    cache.set("ses_1", "argus_solodit_search", "AAAA-longer-full-result")

    expect(cache.takeMatch("ses_1", "argus_solodit_search", "AAAA")).toBe("AAAA-longer-full-result")
    expect(cache.takeMatch("ses_1", "argus_solodit_search", "AAAA")).toBe("AAAA")
  })

  it("evicts the oldest entry when capacity is exceeded", () => {
    const cache = createToolResultCache(2)
    cache.set("ses", "t1", "1")
    cache.set("ses", "t2", "2")
    cache.set("ses", "t3", "3")

    expect(cache.takeMatch("ses", "t1", "")).toBeUndefined()
    expect(cache.takeMatch("ses", "t2", "")).toBe("2")
    expect(cache.takeMatch("ses", "t3", "")).toBe("3")
    expect(cache.size()).toBe(0)
  })
})

describe("getToolResultCache", () => {
  it("returns a stable process-wide singleton", () => {
    const a = getToolResultCache()
    const b = getToolResultCache()
    expect(a).toBe(b)
  })

  it("singleton round-trips set/takeMatch", () => {
    const cache = getToolResultCache()
    cache.set("ses_singleton", "argus_check_patterns", "round-trip")
    expect(cache.takeMatch("ses_singleton", "argus_check_patterns", "round")).toBe("round-trip")
  })
})
