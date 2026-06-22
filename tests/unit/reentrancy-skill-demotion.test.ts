import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..")
const REENTRANCY_SKILL = readFileSync(
  path.join(REPO_ROOT, "skills/vulnerability-patterns/reentrancy/SKILL.md"),
  "utf8",
)

test("same-recipient reentrancy demotion requires fresh storage state after reentry", () => {
  const demotionSection = REENTRANCY_SKILL.slice(
    REENTRANCY_SKILL.indexOf("## Same-Recipient Reentrancy Demotion"),
    REENTRANCY_SKILL.indexOf("## Detection Heuristics"),
  )

  expect(demotionSection).toContain("cached balance")
  expect(demotionSection).toContain("fresh storage")
  expect(demotionSection).toContain("after reentry")
})
