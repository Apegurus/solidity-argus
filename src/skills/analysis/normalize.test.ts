import { describe, expect, it } from "bun:test"
import { normalizeSkill } from "./normalize"

describe("normalize", () => {
  it("parses minimal SKILL.md with name and empty body", () => {
    const content = `---
name: reentrancy
---`

    const doc = normalizeSkill(content)

    expect(doc).not.toBeNull()
    expect(doc?.name).toBe("reentrancy")
    expect(doc?.description).toBe("")
    expect(doc?.category).toBeUndefined()
    expect(doc?.detectionRules).toEqual([])
    expect(doc?.bodyText).toBe("")
    expect(doc?.bodyTokens).toEqual([])
    expect(doc?.ruleTokens).toEqual([])
  })

  it("parses full SKILL.md fields including detection_rules", () => {
    const content = `---
name: unchecked-low-level-call
description: Detect low-level call return value misuse
category: vulnerability-pattern
detection_rules:
  - regex: '\\.call\\{value:'
    severity: High
  - regex: 'delegatecall\\('
    severity: Medium
---

# Unchecked Calls
Use checks after call result.`

    const doc = normalizeSkill(content)

    expect(doc).not.toBeNull()
    expect(doc?.name).toBe("unchecked-low-level-call")
    expect(doc?.description).toBe("Detect low-level call return value misuse")
    expect(doc?.category).toBe("vulnerability-pattern")
    expect(doc?.detectionRules).toEqual(["\\.call\\{value:", "delegatecall\\("])
  })

  it("strips fenced code blocks from body text", () => {
    const content = `---
name: reentrancy
description: Reentrancy patterns
---

Before code.

\`\`\`
function withdraw() external {
  msg.sender.call{value: 1}("");
}
\`\`\`

After code.`

    const doc = normalizeSkill(content)

    expect(doc).not.toBeNull()
    expect(doc?.bodyText).toContain("before code")
    expect(doc?.bodyText).toContain("after code")
    expect(doc?.bodyText).not.toContain("withdraw")
    expect(doc?.bodyText).not.toContain("call")
  })

  it("strips html comments from body", () => {
    const content = `---
name: tx-origin
description: tx origin auth
---

Visible text.
<!-- hidden guidance that should be ignored -->
More visible text.`

    const doc = normalizeSkill(content)

    expect(doc).not.toBeNull()
    expect(doc?.bodyText).toContain("visible text")
    expect(doc?.bodyText).toContain("more visible text")
    expect(doc?.bodyText).not.toContain("hidden guidance")
  })

  it("removes stopwords from body tokens", () => {
    const content = `---
name: stopwords-check
description: test
---

The contract function checks owner balance during transfer logic.`

    const doc = normalizeSkill(content)

    expect(doc).not.toBeNull()
    expect(doc?.bodyTokens).not.toContain("the")
    expect(doc?.bodyTokens).not.toContain("contract")
    expect(doc?.bodyTokens).not.toContain("function")
    expect(doc?.bodyTokens).not.toContain("during")
    expect(doc?.bodyTokens).toContain("checks")
    expect(doc?.bodyTokens).toContain("owner")
    expect(doc?.bodyTokens).toContain("balance")
    expect(doc?.bodyTokens).toContain("transfer")
    expect(doc?.bodyTokens).toContain("logic")
  })

  it("filters short tokens shorter than 3 chars", () => {
    const content = `---
name: short-token-check
description: test
---

ax be cat dog e2e id op secure xyz`

    const doc = normalizeSkill(content)

    expect(doc).not.toBeNull()
    expect(doc?.bodyTokens).not.toContain("ax")
    expect(doc?.bodyTokens).not.toContain("be")
    expect(doc?.bodyTokens).not.toContain("id")
    expect(doc?.bodyTokens).not.toContain("op")
    expect(doc?.bodyTokens).toContain("cat")
    expect(doc?.bodyTokens).toContain("dog")
    expect(doc?.bodyTokens).toContain("e2e")
    expect(doc?.bodyTokens).toContain("secure")
    expect(doc?.bodyTokens).toContain("xyz")
  })

  it("extracts detection rule regexes correctly", () => {
    const content = `---
name: regex-extract
description: test
detection_rules:
  - regex: 'tx\\.origin'
    severity: High
  - regex: '\\.call\\{value:'
    severity: High
---`

    const doc = normalizeSkill(content)

    expect(doc).not.toBeNull()
    expect(doc?.detectionRules).toEqual(["tx\\.origin", "\\.call\\{value:"])
  })

  it("extracts rule tokens from regex literals", () => {
    const content = `---
name: regex-tokenize
description: test
detection_rules:
  - regex: '\\.call\\{value:'
    severity: High
---`

    const doc = normalizeSkill(content)

    expect(doc).not.toBeNull()
    expect(doc?.ruleTokens).toEqual(["call", "value"])
  })

  it("returns null for content without frontmatter", () => {
    const doc = normalizeSkill("# Heading\nNo frontmatter")
    expect(doc).toBeNull()
  })

  it("returns null for empty content", () => {
    const doc = normalizeSkill("")
    expect(doc).toBeNull()
  })
})
