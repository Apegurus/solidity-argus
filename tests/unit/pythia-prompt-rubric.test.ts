import { describe, expect, test } from "bun:test"
import { PYTHIA_PROMPT } from "../../src/agents/pythia-prompt"

const promptText = PYTHIA_PROMPT

describe("pythia prompt rubric instructions", () => {
  test("includes the rubric load instruction", () => {
    expect(promptText).toContain("refutation-rubric")
  })

  test("instructs walking all 4 gates", () => {
    expect(promptText).toMatch(/Refutation/)
    expect(promptText).toMatch(/Reachability/)
    expect(promptText).toMatch(/Trigger/)
    expect(promptText).toMatch(/Impact/)
  })

  test("instructs populating confidence_score", () => {
    expect(promptText).toContain("confidence_score")
  })

  test("forbids fabricated refutation quotes", () => {
    expect(promptText).toMatch(/Fabricat\w+/)
  })

  test("uses the correct argus_skill_load parameter name (name, not skill)", () => {
    expect(promptText).toContain('argus_skill_load({ name: "refutation-rubric" })')
    expect(promptText).not.toContain('{ skill: "refutation-rubric" }')
  })

  test("rubric instructions do NOT instruct dropping the candidate on REJECTED", () => {
    expect(PYTHIA_PROMPT).not.toContain("drop the candidate")
    expect(PYTHIA_PROMPT).not.toContain("Do NOT call `argus_record_finding`")
  })

  test("rubric instructions DO instruct recording with REJECTED_DEMOTED verdict", () => {
    expect(PYTHIA_PROMPT).toContain("REJECTED_DEMOTED")
    expect(PYTHIA_PROMPT).toContain("rubric_verdict")
    expect(PYTHIA_PROMPT).toMatch(/confidence_score\s*[≤<=]+\s*30/)
  })
})
