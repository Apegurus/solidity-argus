import { describe, expect, it } from "bun:test"
import { safeCreateHook } from "./safe-create-hook"

describe("safeCreateHook", () => {
  describe("non-critical hooks (default behavior)", () => {
    it("returns the hook when factory succeeds", () => {
      const hook = { execute: () => "result" }
      const result = safeCreateHook(() => hook, "test-hook")
      expect(result).toBe(hook)
    })

    it("returns undefined and swallows error when factory throws (non-critical)", () => {
      const result = safeCreateHook(() => {
        throw new Error("factory failed")
      }, "test-hook")
      expect(result).toBeUndefined()
    })

    it("returns undefined and swallows error when critical is explicitly false", () => {
      const result = safeCreateHook(
        () => {
          throw new Error("factory failed")
        },
        "test-hook",
        { critical: false },
      )
      expect(result).toBeUndefined()
    })
  })

  describe("critical hooks", () => {
    it("returns the hook when factory succeeds (critical)", () => {
      const hook = { execute: () => "result" }
      const result = safeCreateHook(() => hook, "critical-hook", { critical: true })
      expect(result).toBe(hook)
    })

    it("re-throws error when factory throws and critical is true", () => {
      expect(() => {
        safeCreateHook(
          () => {
            throw new Error("critical factory failed")
          },
          "critical-hook",
          { critical: true },
        )
      }).toThrow("critical factory failed")
    })

    it("re-throws non-Error values when factory throws and critical is true", () => {
      expect(() => {
        safeCreateHook(
          () => {
            throw "string error"
          },
          "critical-hook",
          { critical: true },
        )
      }).toThrow()
    })
  })
})
