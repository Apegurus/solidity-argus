import { describe, expect, it } from "bun:test"
import { getRequiredAuditSkills, normalizeSkillName, resolveArgusSkills, resolveSkillRoots } from "./argus-skill-resolver"

describe("argus-skill-resolver", () => {
  it("normalizes legacy and namespaced skill names", () => {
    expect(normalizeSkillName("vulnerability-patterns/reentrancy")).toBe("reentrancy")
    expect(normalizeSkillName("building-secure-contracts/token-integration-analyzer")).toBe(
      "token-integration-analyzer"
    )
    expect(normalizeSkillName("protocol-patterns/amm-dex")).toBe("amm-dex")
  })

  it("always includes bundled skill root", () => {
    const roots = resolveSkillRoots(process.cwd())
    expect(roots.some((root) => root.source === "bundled")).toBe(true)
  })

  it("resolves required Argus audit skills", () => {
    const skills = resolveArgusSkills(process.cwd())
    for (const requiredSkill of getRequiredAuditSkills()) {
      expect(skills.has(requiredSkill)).toBe(true)
    }
  })
})
