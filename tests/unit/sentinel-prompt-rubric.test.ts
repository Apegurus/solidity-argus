import { describe, expect, test } from "bun:test"
import { SENTINEL_PROMPT } from "../../src/agents/sentinel-prompt"

const promptText = SENTINEL_PROMPT

describe("sentinel prompt rubric instructions", () => {
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
    // Phrase to be replaced — must not appear after Task 9
    expect(SENTINEL_PROMPT).not.toContain("drop the candidate")
    expect(SENTINEL_PROMPT).not.toContain("Do NOT call `argus_record_finding`")
  })

  test("rubric instructions DO instruct recording with REJECTED_DEMOTED verdict", () => {
    expect(SENTINEL_PROMPT).toContain("REJECTED_DEMOTED")
    expect(SENTINEL_PROMPT).toContain("rubric_verdict")
    expect(SENTINEL_PROMPT).toMatch(/confidence_score\s*[≤<=]+\s*30/)
  })

  test("exposes the machine-consumed source for verified pattern promotions", () => {
    expect(SENTINEL_PROMPT).toContain('source: "pattern"')
  })

  test("requires property-based PoC truthfulness for theft and drain claims", () => {
    expect(SENTINEL_PROMPT).toContain("attacker_net_gain")
    expect(SENTINEL_PROMPT).toContain("conservation")
    expect(SENTINEL_PROMPT).toContain("Passing tests are not proof")
  })

  test("keeps compiler-specific same-recipient reentrancy guidance out of the generic rubric", () => {
    expect(SENTINEL_PROMPT).not.toContain("Solidity >=0.8")
    expect(SENTINEL_PROMPT).not.toContain("same-recipient reentrancy safe pattern")
    expect(SENTINEL_PROMPT).toContain("Trace the recipient")
  })
})
