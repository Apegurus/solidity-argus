import { describe, expect, it } from "bun:test"
import { createHookGuard } from "./hook-system"
import type { HookName } from "./types"

describe("createHookGuard", () => {
  it("returns true for all hooks when disabledHooks is empty", () => {
    const isHookEnabled = createHookGuard([])

    const allHooks: HookName[] = [
      "compaction",
      "tool-tracking",
      "event",
      "system-prompt",
      "audit-specialist-watchdog",
    ]

    allHooks.forEach((hook) => {
      expect(isHookEnabled(hook)).toBe(true)
    })
  })

  it("returns false for disabled hooks and true for enabled hooks", () => {
    const isHookEnabled = createHookGuard(["compaction", "event"])

    expect(isHookEnabled("compaction")).toBe(false)
    expect(isHookEnabled("event")).toBe(false)
    expect(isHookEnabled("tool-tracking")).toBe(true)
    expect(isHookEnabled("system-prompt")).toBe(true)
    expect(isHookEnabled("audit-specialist-watchdog")).toBe(true)
  })

  it("returns false for all hooks when all are disabled", () => {
    const isHookEnabled = createHookGuard([
      "compaction",
      "tool-tracking",
      "event",
      "system-prompt",
      "audit-specialist-watchdog",
    ])

    const allHooks: HookName[] = [
      "compaction",
      "tool-tracking",
      "event",
      "system-prompt",
      "audit-specialist-watchdog",
    ]

    allHooks.forEach((hook) => {
      expect(isHookEnabled(hook)).toBe(false)
    })
  })

  it("handles single disabled hook correctly", () => {
    const isHookEnabled = createHookGuard(["compaction"])

    expect(isHookEnabled("compaction")).toBe(false)
    expect(isHookEnabled("tool-tracking")).toBe(true)
  })
})
