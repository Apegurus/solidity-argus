import { describe, expect, test } from "bun:test"
import { ARGUS_PROMPT } from "./argus-prompt"
import { SCRIBE_PROMPT } from "./scribe-prompt"
import { SENTINEL_PROMPT } from "./sentinel-prompt"

describe("Argus skill boundary prompt guidance", () => {
  test("Argus prompt distinguishes argus_skill_load from task.load_skills", () => {
    expect(ARGUS_PROMPT).toContain("argus_skill_load")
    expect(ARGUS_PROMPT).toContain("task.load_skills")
    expect(ARGUS_PROMPT).toMatch(/generic OpenCode subagent runtime skills/i)
  })

  test("Sentinel prompt forbids generic skill for Argus audit knowledge", () => {
    expect(SENTINEL_PROMPT).toContain("argus_skill_load")
    expect(SENTINEL_PROMPT).toContain("NEVER call the generic OpenCode `skill` tool")
  })

  test("Scribe prompt forbids generic skill for report audit knowledge", () => {
    expect(SCRIBE_PROMPT).toContain("argus_skill_load")
    expect(SCRIBE_PROMPT).toContain("NEVER call the generic OpenCode `skill` tool")
  })
})
