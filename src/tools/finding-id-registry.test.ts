import { describe, expect, test } from "bun:test"
import type { Finding, FindingSeverity } from "../state/types"
import { assignStableFindingIds } from "./finding-id-registry"

function f(id: string, severity: FindingSeverity): Finding {
  return {
    id,
    check: `check-${id}`,
    severity,
    confidence: "High",
    description: `finding ${id}`,
    file: "src/Vault.sol",
    lines: [1, 2],
    source: "manual",
  }
}

describe("assignStableFindingIds", () => {
  test("fresh run numbers sequentially per bucket in render order", () => {
    const confirmed = [f("a", "Critical"), f("b", "Critical"), f("c", "High")]
    const leads = [f("d", "Medium")]

    const ids = assignStableFindingIds(confirmed, leads, {})

    expect(ids.get("a")).toBe("CRIT-1")
    expect(ids.get("b")).toBe("CRIT-2")
    expect(ids.get("c")).toBe("HIGH-1")
    expect(ids.get("d")).toBe("LEAD-1")
  })

  test("keeps prior numbers pinned when a new earlier-sorting finding is inserted", () => {
    const existing = { a: "CRIT-1", b: "CRIT-2" }
    // "z" now sorts first but must not steal CRIT-1; it takes the next free number.
    const confirmed = [f("z", "Critical"), f("a", "Critical"), f("b", "Critical")]

    const ids = assignStableFindingIds(confirmed, [], existing)

    expect(ids.get("a")).toBe("CRIT-1")
    expect(ids.get("b")).toBe("CRIT-2")
    expect(ids.get("z")).toBe("CRIT-3")
  })

  test("reassigns a new id when a finding changes severity bucket", () => {
    const existing = { a: "HIGH-1" }
    const confirmed = [f("a", "Critical")]

    const ids = assignStableFindingIds(confirmed, [], existing)

    expect(ids.get("a")).toBe("CRIT-1")
  })

  test("a finding demoted to the Leads tier keeps a LEAD id, freeing its old number", () => {
    const existing = { a: "CRIT-1", b: "CRIT-2" }
    const confirmed = [f("b", "Critical")]
    const leads = [f("a", "Critical")]

    const ids = assignStableFindingIds(confirmed, leads, existing)

    expect(ids.get("b")).toBe("CRIT-2")
    expect(ids.get("a")).toBe("LEAD-1")
  })

  test("ignores a corrupt prior assignment and assigns a fresh number", () => {
    const existing = { a: "CRIT-not-a-number" }
    const confirmed = [f("a", "Critical")]

    const ids = assignStableFindingIds(confirmed, [], existing)

    expect(ids.get("a")).toBe("CRIT-1")
  })
})
