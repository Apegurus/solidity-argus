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
})
