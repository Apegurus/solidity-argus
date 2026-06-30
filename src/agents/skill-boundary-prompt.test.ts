import { describe, expect, test } from "bun:test"
import { ARGUS_PROMPT } from "./argus-prompt"
import { AUDIT_SPECIALIST_PROMPT } from "./audit-specialist-prompt"
import { PYTHIA_PROMPT } from "./pythia-prompt"
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

  test("Argus prompt requires one audit-specialist profile per task", () => {
    expect(ARGUS_PROMPT).toContain("one specialist profile per Task")
    expect(ARGUS_PROMPT).toContain("Never bundle multiple profiles")
    expect(ARGUS_PROMPT).toContain("Routers, position routers")
    expect(ARGUS_PROMPT).toContain("periphery")
  })

  test("Argus prompt keeps direct reconnaissance bounded", () => {
    expect(ARGUS_PROMPT).toContain("Direct-Tool Budget")
    expect(ARGUS_PROMPT).toContain("8 total per user turn")
    expect(ARGUS_PROMPT).toContain("A broad audit request should produce early parallel delegation")
  })

  test("Argus prompt gives Critical and High findings an independent verification budget", () => {
    expect(ARGUS_PROMPT).toContain("Critical/High Verification Budget")
    expect(ARGUS_PROMPT).toContain("does not count against the Direct-Tool Budget")
    expect(ARGUS_PROMPT).toContain("exploit property and conservation assumptions")
  })

  test("Argus prompt fails closed when Task delegation is unavailable", () => {
    expect(ARGUS_PROMPT).toContain("If the `Task` tool is unavailable")
    expect(ARGUS_PROMPT).toContain("do not emulate Scribe or Themis")
    expect(ARGUS_PROMPT).toContain(
      'requires an actual `Task(subagent_type="themis", ...)` dispatch',
    )
  })

  test("Argus prompt does not tell the orchestrator to bypass Scribe report tools", () => {
    expect(ARGUS_PROMPT).toContain("Do not call `argus_generate_report` yourself")
    expect(ARGUS_PROMPT).not.toContain(
      "If Scribe fails a second time, call `argus_generate_report` yourself",
    )
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

  test("Scribe prompt keeps reporting inside the persisted artifact boundary", () => {
    expect(SCRIBE_PROMPT).not.toContain("argus_skill_load")
    expect(SCRIBE_PROMPT).toContain("Do not call the generic OpenCode `skill` tool")
    expect(SCRIBE_PROMPT).toContain("Scribe synthesizes the durable findings")
  })

  test("Audit Specialist prompt requires profile skills through argus_skill_load", () => {
    expect(AUDIT_SPECIALIST_PROMPT).toContain("Run specialist profile")
    expect(AUDIT_SPECIALIST_PROMPT).toContain("argus_skill_load")
    expect(AUDIT_SPECIALIST_PROMPT).toContain("attack-vector-deck")
    expect(AUDIT_SPECIALIST_PROMPT).toContain("LEAD")
    expect(AUDIT_SPECIALIST_PROMPT).toContain("NEVER call the generic OpenCode `skill` tool")
  })

  test("Audit Specialist prompt includes anti-loop checkpoints and structured handoff", () => {
    expect(AUDIT_SPECIALIST_PROMPT).toContain("exactly one active profile")
    expect(AUDIT_SPECIALIST_PROMPT).toContain("CHECKPOINT")
    expect(AUDIT_SPECIALIST_PROMPT).toContain("Do not repeat the same function")
    expect(AUDIT_SPECIALIST_PROMPT).toContain("Each candidate gets exactly one verdict line")
    expect(AUDIT_SPECIALIST_PROMPT).toContain("findings_recorded_ids")
    expect(AUDIT_SPECIALIST_PROMPT).toContain("leads_not_recorded")
  })

  test("Scribe prompt requires strict report generation policies", () => {
    expect(SCRIBE_PROMPT).toContain('preflight_policy: "strict-fail"')
    expect(SCRIBE_PROMPT).toContain('quality_gate_policy: "strict-fail"')
    expect(SCRIBE_PROMPT).toContain("outside the audited scope")
  })

  test("Sentinel and Pythia prompts require remediation fallbacks and bounded source reads", () => {
    expect(SENTINEL_PROMPT).toContain("Retry coverage with `ir_minimum: true`")
    expect(PYTHIA_PROMPT).toContain("bounded source read")
    expect(PYTHIA_PROMPT).toContain("Do not record a precedent-only finding")
  })

  test("Themis prompt treats audit-specialist findings as parity inputs", () => {
    expect(THEMIS_PROMPT).toContain("audit-specialist")
    expect(THEMIS_PROMPT).toContain('reported_by_agent: "audit-specialist"')
    expect(THEMIS_PROMPT).toContain("raw -> deduped -> report parity")
  })

  test("Themis prompt exposes a single machine-readable verdict contract", () => {
    expect(THEMIS_PROMPT).toContain("Return exactly one JSON verdict")
    expect(THEMIS_PROMPT).toContain("No prose after the JSON verdict")
  })
})
