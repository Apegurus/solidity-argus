import { expect, test } from "bun:test"
import { SCRIBE_PROMPT } from "../../src/agents/scribe-prompt"

test("scribe prompt states raw observation accounting is mutually exclusive", () => {
  expect(SCRIBE_PROMPT).toContain("mutually exclusive")
  expect(SCRIBE_PROMPT).toContain("never both")
  expect(SCRIBE_PROMPT).toContain("observation_ids")
  expect(SCRIBE_PROMPT).toContain("dropped_observations")
})
