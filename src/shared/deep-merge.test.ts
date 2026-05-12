import { describe, expect, it } from "bun:test"
import { deepMerge } from "./deep-merge"

describe("deepMerge", () => {
  it("should merge simple objects", () => {
    const obj1 = { a: 1, b: 2 }
    const obj2 = { c: 3 }
    const result = deepMerge(obj1, obj2)

    expect(result).toEqual({ a: 1, b: 2, c: 3 })
  })

  it("should override values from first object with second", () => {
    const obj1 = { a: 1, b: 2 }
    const obj2 = { b: 3, c: 4 }
    const result = deepMerge(obj1, obj2)

    expect(result).toEqual({ a: 1, b: 3, c: 4 })
  })

  it("should recursively merge nested objects", () => {
    const obj1 = { a: { x: 1, y: 2 }, b: 3 }
    const obj2 = { a: { y: 20, z: 30 }, c: 4 }
    const result = deepMerge(obj1, obj2)

    expect(result).toEqual({
      a: { x: 1, y: 20, z: 30 },
      b: 3,
      c: 4,
    })
  })

  it("should concatenate and deduplicate arrays", () => {
    const obj1 = { items: [1, 2, 3] }
    const obj2 = { items: [3, 4, 5] }
    const result = deepMerge(obj1, obj2) as Record<string, unknown>

    expect(result.items).toEqual([1, 2, 3, 4, 5])
  })

  it("should handle array deduplication with strings", () => {
    const obj1 = { tags: ["a", "b", "c"] }
    const obj2 = { tags: ["c", "d", "e"] }
    const result = deepMerge(obj1, obj2) as Record<string, unknown>

    expect(result.tags).toEqual(["a", "b", "c", "d", "e"])
  })

  it("should skip undefined values from second object", () => {
    const obj1 = { a: 1, b: 2 }
    const obj2 = { b: undefined, c: 3 }
    const result = deepMerge(obj1, obj2)

    expect(result).toEqual({ a: 1, b: 2, c: 3 })
  })

  it("should handle deeply nested objects", () => {
    const obj1 = {
      level1: {
        level2: {
          level3: { value: 1 },
        },
      },
    }
    const obj2 = {
      level1: {
        level2: {
          level3: { value: 2, extra: "data" },
        },
      },
    }
    const result = deepMerge(obj1, obj2)

    expect(result).toEqual({
      level1: {
        level2: {
          level3: { value: 2, extra: "data" },
        },
      },
    })
  })

  it("should handle mixed nested objects and arrays", () => {
    const obj1 = {
      config: {
        items: [1, 2],
        settings: { debug: true },
      },
    }
    const obj2 = {
      config: {
        items: [2, 3],
        settings: { verbose: true },
      },
    }
    const result = deepMerge(obj1, obj2)

    expect(result).toEqual({
      config: {
        items: [1, 2, 3],
        settings: { debug: true, verbose: true },
      },
    })
  })

  it("should handle empty objects", () => {
    const obj1 = { a: 1 }
    const obj2 = {}
    const result = deepMerge(obj1, obj2)

    expect(result).toEqual({ a: 1 })
  })

  it("should handle null and non-object values", () => {
    const obj1 = { a: 1, b: null }
    const obj2 = { b: 2, c: 3 }
    const result = deepMerge(obj1, obj2)

    expect(result).toEqual({ a: 1, b: 2, c: 3 })
  })

  it("should not mutate original objects", () => {
    const obj1 = { a: { x: 1 } }
    const obj2 = { a: { y: 2 } }
    const obj1Copy = JSON.parse(JSON.stringify(obj1))

    deepMerge(obj1, obj2)

    expect(obj1).toEqual(obj1Copy)
  })

  it("should handle array deduplication with objects (by reference)", () => {
    const obj1 = { ids: [1, 2, 3] }
    const obj2 = { ids: [3, 4, 5] }
    const result = deepMerge(obj1, obj2) as Record<string, unknown>

    expect(result.ids).toEqual([1, 2, 3, 4, 5])
  })

  it("should not collide primitive dedup keys across types", () => {
    const obj1 = { values: [1, "1"] }
    const obj2 = { values: ["1", 1, true, "true"] }
    const result = deepMerge(obj1, obj2) as Record<string, unknown>

    expect(result.values).toEqual([1, "1", true, "true"])
  })

  it("should not throw when deduplicating arrays with circular objects", () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    const obj1 = { values: [circular] }
    const obj2 = { values: [circular] }

    expect(() => deepMerge(obj1, obj2)).not.toThrow()
    const result = deepMerge(obj1, obj2) as Record<string, unknown>
    expect(result.values).toHaveLength(1)
  })
})
