import { describe, expect, it } from "bun:test"
import { confirm } from "./tui-prompts"

describe("tui-prompts (non-interactive)", () => {
  it("confirm returns default in non-interactive mode", async () => {
    expect(await confirm("Continue?", true)).toBe(true)
    expect(await confirm("Continue?", false)).toBe(false)
  })
})
