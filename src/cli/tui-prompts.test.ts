import { describe, expect, it } from "bun:test"
import { confirm, select, text } from "./tui-prompts"

describe("tui-prompts (non-interactive)", () => {
  it("confirm returns default in non-interactive mode", async () => {
    expect(await confirm("Continue?", true)).toBe(true)
    expect(await confirm("Continue?", false)).toBe(false)
  })

  it("select returns default option in non-interactive mode", async () => {
    const result = await select("Choose:", ["a", "b", "c"], 1)
    expect(result).toBe("b")
  })

  it("select returns first option when default index is 0", async () => {
    const result = await select("Choose:", ["first", "second"], 0)
    expect(result).toBe("first")
  })

  it("text returns default in non-interactive mode", async () => {
    expect(await text("Name?", "default-name")).toBe("default-name")
  })

  it("text returns empty string when no default", async () => {
    expect(await text("Name?")).toBe("")
  })
})
