import { describe, expect, test } from "bun:test"
import { normalizeSeverity, parseFindingsFromPageText } from "./audit-pdf-extract-lib"

describe("audit PDF extraction helpers", () => {
  test("parses a finding block into structured output", () => {
    const sample = `
Issue_02 Missing access control on setOperator
Severity    High
Description The setOperator function can be called by any user and allows replacing the protocol operator.
Recommendations Restrict the function with onlyOwner and emit an operator update event.
`

    const findings = parseFindingsFromPageText(sample, "sample.pdf", 3)
    expect(findings.length).toBe(1)

    const finding = findings[0]
    expect(finding?.title).toBe("Missing access control on setOperator")
    expect(finding?.severity).toBe("high")
    expect(finding?.description.toLowerCase()).toContain("setoperator")
    expect(finding?.recommendation.toLowerCase()).toContain("onlyowner")
    expect(finding?.category).toBe("access-control")
    expect(finding?.source_pdf).toBe("sample.pdf")
    expect(finding?.page).toBe(3)
  })

  test("normalizes severity tokens", () => {
    expect(normalizeSeverity("Critical")).toBe("critical")
    expect(normalizeSeverity("HIGH")).toBe("high")
    expect(normalizeSeverity("Medium")).toBe("medium")
    expect(normalizeSeverity("low")).toBe("low")
    expect(normalizeSeverity("Informational")).toBe("info")
    expect(normalizeSeverity("Info")).toBe("info")
  })
})
