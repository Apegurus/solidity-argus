import { expect, test } from "bun:test"
import { getPythiaPrompt, PYTHIA_PROMPT } from "./pythia-prompt"

test("getPythiaPrompt returns the prompt", () => {
  expect(getPythiaPrompt()).toBe(PYTHIA_PROMPT)
  expect(PYTHIA_PROMPT.length).toBeGreaterThan(500)
})

test("Pythia prompt forbids the generic OpenCode skill tool (Task 4 / Bug #4)", () => {
  expect(PYTHIA_PROMPT).toMatch(/NEVER.*generic OpenCode\s+`?skill`?\s+tool/i)
  expect(PYTHIA_PROMPT).toContain("argus_skill_load")
})
