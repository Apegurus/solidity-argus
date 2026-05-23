import { describe, expect, test } from "bun:test"
import { ARGUS_PROMPT } from "./argus-prompt"
import { AUDIT_SPECIALIST_PROMPT } from "./audit-specialist-prompt"
import { SCRIBE_PROMPT } from "./scribe-prompt"
import { SENTINEL_PROMPT } from "./sentinel-prompt"
import { THEMIS_PROMPT } from "./themis-prompt"

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

  test("Argus prompt keeps direct reconnaissance bounded", () => {
    expect(ARGUS_PROMPT).toContain("Direct-Tool Budget")
    expect(ARGUS_PROMPT).toContain("8 total per user turn")
    expect(ARGUS_PROMPT).toContain("A broad audit request should produce early parallel delegation")
  })

  test("Sentinel prompt forbids generic skill for Argus audit knowledge", () => {
    expect(SENTINEL_PROMPT).toContain("argus_skill_load")
    expect(SENTINEL_PROMPT).toContain("NEVER call the generic OpenCode `skill` tool")
    expect(SENTINEL_PROMPT).toContain("reentrancy")
    expect(SENTINEL_PROMPT).toContain("access-control")
    expect(SENTINEL_PROMPT).toContain("oracle-manipulation")
    expect(SENTINEL_PROMPT).toContain("task.load_skills")
  })

  test("Sentinel prompt bounds large tool output", () => {
    expect(SENTINEL_PROMPT).toContain("5,000 characters")
    expect(SENTINEL_PROMPT).toContain("10 bullets")
    expect(SENTINEL_PROMPT).toContain("artifact path")
    expect(SENTINEL_PROMPT).toContain("do not paste the full output")
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

  test("Themis prompt treats audit-specialist findings as parity inputs", () => {
    expect(THEMIS_PROMPT).toContain("audit-specialist")
    expect(THEMIS_PROMPT).toContain('reported_by_agent: "audit-specialist"')
    expect(THEMIS_PROMPT).toContain("raw -> deduped -> report parity")
  })
})
