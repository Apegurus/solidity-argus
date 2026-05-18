import { describe, expect, test } from "bun:test"
import { ARGUS_PROMPT } from "./argus-prompt"
import { AUDIT_SPECIALIST_PROMPT } from "./audit-specialist-prompt"
import { SCRIBE_PROMPT } from "./scribe-prompt"
import { SENTINEL_PROMPT } from "./sentinel-prompt"

describe("Argus skill boundary prompt guidance", () => {
  test("Argus prompt distinguishes argus_skill_load from task.load_skills", () => {
    expect(ARGUS_PROMPT).toContain("argus_skill_load")
    expect(ARGUS_PROMPT).toContain("task.load_skills")
    expect(ARGUS_PROMPT).toMatch(/generic OpenCode subagent runtime skills/i)
  })

  test("Argus prompt documents audit-specialist deep and adversarial orchestration", () => {
    expect(ARGUS_PROMPT).toContain("audit-specialist")
    expect(ARGUS_PROMPT).toContain("deep/adversarial")
    expect(ARGUS_PROMPT).toContain("math-precision")
    expect(ARGUS_PROMPT).toContain("vector-scan")
  })

  test("Sentinel prompt forbids generic skill for Argus audit knowledge", () => {
    expect(SENTINEL_PROMPT).toContain("argus_skill_load")
    expect(SENTINEL_PROMPT).toContain("NEVER call the generic OpenCode `skill` tool")
  })

  test("Scribe prompt forbids generic skill for report audit knowledge", () => {
    expect(SCRIBE_PROMPT).toContain("argus_skill_load")
    expect(SCRIBE_PROMPT).toContain("NEVER call the generic OpenCode `skill` tool")
  })

  test("Audit Specialist prompt requires profile skills through argus_skill_load", () => {
    expect(AUDIT_SPECIALIST_PROMPT).toContain("Run specialist profile")
    expect(AUDIT_SPECIALIST_PROMPT).toContain("argus_skill_load")
    expect(AUDIT_SPECIALIST_PROMPT).toContain("attack-vector-deck")
    expect(AUDIT_SPECIALIST_PROMPT).toContain("LEAD")
    expect(AUDIT_SPECIALIST_PROMPT).toContain("NEVER call the generic OpenCode `skill` tool")
  })
})
