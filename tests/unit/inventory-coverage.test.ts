import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { resolveArgusSkills } from "../../src/skills/argus-skill-resolver"

const REPO_ROOT = join(import.meta.dir, "..", "..")

test("INVENTORY.md lists every bundled skill (drift guard)", () => {
  const inventory = readFileSync(join(REPO_ROOT, "skills", "INVENTORY.md"), "utf8")
  const bundled = [...resolveArgusSkills(REPO_ROOT).values()].filter(
    (skill) => skill.source === "bundled",
  )

  const missing = bundled.filter((skill) => !inventory.includes(skill.name)).map((s) => s.name)

  expect(missing).toEqual([])
})
