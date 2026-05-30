import { describe, expect, test } from "bun:test"
import { AUDIT_SPECIALIST_PROMPT } from "../../src/agents/audit-specialist-prompt"

const promptText = AUDIT_SPECIALIST_PROMPT

describe("audit-specialist prompt rubric instructions", () => {
  test("includes the rubric load instruction", () => {
    expect(promptText).toContain("refutation-rubric")
  })

  test("instructs walking all 4 gates", () => {
    expect(promptText).toMatch(/Refutation/)
    expect(promptText).toMatch(/Reachability/)
    expect(promptText).toMatch(/Trigger/)
    expect(promptText).toMatch(/Impact/)
  })

  test("instructs populating confidence_score and rubric_verdict", () => {
    expect(promptText).toContain("confidence_score")
    expect(promptText).toContain("rubric_verdict")
  })

  test("forbids fabricated refutation quotes", () => {
    expect(promptText).toMatch(/Fabricat\w+/)
  })

  test("uses the correct argus_skill_load parameter name (name, not skill)", () => {
    expect(promptText).toContain('argus_skill_load({ name: "refutation-rubric" })')
    expect(promptText).not.toContain('{ skill: "refutation-rubric" }')
  })

  test("rubric instructions DO instruct recording with REJECTED_DEMOTED verdict", () => {
    expect(promptText).toContain("REJECTED_DEMOTED")
    expect(promptText).toMatch(/confidence_score\s*[≤<=]+\s*30/)
  })

  test("FINDINGS VS LEADS section no longer says 'do not persist'", () => {
    expect(promptText).not.toMatch(/do not persist it/i)
  })

  test("FINDINGS VS LEADS section explicitly states every candidate is persisted", () => {
    expect(promptText).toMatch(/Every candidate is persisted|nothing is silently dropped/i)
  })

  test("rubric instructions are appended exactly once (no duplicate include)", () => {
    const matches = promptText.match(/Refutation Rubric \(REQUIRED\)/g) ?? []
    expect(matches.length).toBe(1)
  })
})
