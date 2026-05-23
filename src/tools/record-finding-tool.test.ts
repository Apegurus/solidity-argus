import { expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { SCHEMA_VERSION } from "../state/schemas"
import { executeRecordFinding } from "./record-finding-tool"

function createContext(agent: string = "sentinel"): ToolContext {
  return {
    sessionID: "session-test",
    messageID: "message-test",
    agent,
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: new AbortController().signal,
    metadata() {
      return
    },
    async ask() {
      return
    },
  }
}

test("executeRecordFinding normalizes one finding", async () => {
  const payload = await executeRecordFinding(
    {
      finding: JSON.stringify({
        check: "manual-auth-bypass",
        severity: "High",
        confidence: "High",
        description: "Manual access-control bypass finding",
        file: "src/Vault.sol",
        lines: [20, 24],
        source: "manual",
      }),
    },
    createContext("sentinel"),
  )

  const parsed = JSON.parse(payload) as {
    success: boolean
    count: number
    schema_version: string
    findings: Array<{
      id: string
      check: string
      severity: string
      file: string
      description: string
      lines: [number, number]
      source: string
    }>
    note: string
  }

  expect(parsed.success).toBe(true)
  expect(parsed.count).toBe(1)
  expect(parsed.schema_version).toBe(SCHEMA_VERSION)
  expect(parsed.findings[0]?.check).toBe("manual-auth-bypass")
  expect(parsed.findings[0]?.severity).toBe("High")
  expect(parsed.findings[0]?.file).toBe("src/Vault.sol")
  expect(parsed.findings[0]?.description).toBe("Manual access-control bypass finding")
  expect(parsed.findings[0]?.lines).toEqual([20, 24])
  expect(parsed.findings[0]?.source).toBe("manual")
  expect(typeof parsed.findings[0]?.id).toBe("string")
  expect(parsed.note).toContain("run_id")
  // High finding without enrichment fields should trigger warning
  expect((parsed as Record<string, unknown>).enrichment_warnings).toBeDefined()
})

test("executeRecordFinding accepts findings array", async () => {
  const payload = await executeRecordFinding(
    {
      findings: JSON.stringify([
        {
          check: "issue-a",
          severity: "Medium",
          confidence: "Low",
          description: "Issue A",
          file: "src/A.sol",
          lines: [1, 1],
          source: "manual",
        },
        {
          check: "issue-b",
          severity: "Low",
          confidence: "Low",
          description: "Issue B",
          file: "src/B.sol",
          lines: [2, 3],
          source: "manual",
        },
      ]),
    },
    createContext("pythia"),
  )

  const parsed = JSON.parse(payload) as {
    count: number
    findings: Array<{
      id: string
      check: string
      severity: string
      file: string
      description: string
      lines: [number, number]
      source: string
    }>
  }
  expect(parsed.count).toBe(2)
  expect(parsed.findings[0]?.check).toBe("issue-a")
  expect(parsed.findings[1]?.check).toBe("issue-b")
  expect(parsed.findings.every((f) => typeof f.id === "string")).toBe(true)
})

test("executeRecordFinding returns error for malformed finding payload", async () => {
  const payload = await executeRecordFinding(
    {
      finding: "{bad-json}",
    },
    createContext("argus"),
  )

  const parsed = JSON.parse(payload) as { success: boolean; error: string }
  expect(parsed.success).toBe(false)
  expect(parsed.error).toContain("finding must be valid JSON")
})

test("executeRecordFinding returns error when no findings provided", async () => {
  const payload = await executeRecordFinding({}, createContext("argus"))

  const parsed = JSON.parse(payload) as { success: boolean; error: string }
  expect(parsed.success).toBe(false)
  expect(parsed.error).toContain("Provide at least one finding")
})

test("executeRecordFinding emits enrichment warnings for Critical/High missing fields", async () => {
  const payload = await executeRecordFinding(
    {
      finding: JSON.stringify({
        check: "reentrancy-drain",
        severity: "Critical",
        confidence: "High",
        description: "Vault is vulnerable to reentrancy",
        file: "src/Vault.sol",
        lines: [42, 58],
        source: "manual",
      }),
    },
    createContext("sentinel"),
  )

  const parsed = JSON.parse(payload) as {
    success: boolean
    enrichment_warnings?: string[]
    enrichment_hint?: string
  }
  expect(parsed.success).toBe(true)
  expect(parsed.enrichment_warnings).toBeDefined()
  expect(parsed.enrichment_warnings?.length).toBe(1)
  expect(parsed.enrichment_warnings?.[0]).toContain("impact")
  expect(parsed.enrichment_warnings?.[0]).toContain("recommendation")
  expect(parsed.enrichment_warnings?.[0]).toContain("proofOfConcept")
  expect(parsed.enrichment_hint).toContain("quality gate")
})

test("executeRecordFinding has no enrichment warnings when fields are present", async () => {
  const payload = await executeRecordFinding(
    {
      finding: JSON.stringify({
        check: "reentrancy-drain",
        severity: "Critical",
        confidence: "High",
        description: "Vault is vulnerable to reentrancy",
        file: "src/Vault.sol",
        lines: [42, 58],
        source: "manual",
        impact: "Complete vault drain",
        recommendation: "Add nonReentrant modifier",
        proofOfConcept: "See test/ReentrancyPoC.t.sol",
      }),
    },
    createContext("sentinel"),
  )

  const parsed = JSON.parse(payload) as {
    success: boolean
    enrichment_warnings?: string[]
  }
  expect(parsed.success).toBe(true)
  expect(parsed.enrichment_warnings).toBeUndefined()
})

test("executeRecordFinding preserves Slither findings without complete enrichment and warns", async () => {
  const payload = await executeRecordFinding(
    {
      finding: JSON.stringify({
        check: "erc20-interface",
        severity: "Low",
        confidence: "High",
        description: "Token transfer does not return a bool",
        file: "src/Token.sol",
        lines: [20, 25],
        source: "slither",
        impact: "Integrations can revert when decoding the empty return value",
        recommendation: "Return true from transfer after successful balance updates",
      }),
    },
    createContext("sentinel"),
  )

  const parsed = JSON.parse(payload) as {
    success: boolean
    count: number
    findings: Array<{ check: string; source: string }>
    enrichment_warnings?: string[]
    enrichment_hint?: string
  }
  expect(parsed.success).toBe(true)
  expect(parsed.count).toBe(1)
  expect(parsed.findings[0]?.check).toBe("erc20-interface")
  expect(parsed.findings[0]?.source).toBe("slither")
  expect(parsed.enrichment_warnings?.[0]).toContain("Slither finding")
  expect(parsed.enrichment_warnings?.[0]).toContain("proofOfConcept")
  expect(parsed.enrichment_hint).toContain("quality gate")
})

test("executeRecordFinding emits one Slither-specific warning for Critical Slither findings", async () => {
  const payload = await executeRecordFinding(
    {
      finding: JSON.stringify({
        check: "reentrancy-eth",
        severity: "Critical",
        confidence: "High",
        description: "External call before state update",
        file: "src/Vault.sol",
        lines: [42, 58],
        source: "slither",
      }),
    },
    createContext("sentinel"),
  )

  const parsed = JSON.parse(payload) as {
    success: boolean
    enrichment_warnings?: string[]
  }
  expect(parsed.success).toBe(true)
  expect(parsed.enrichment_warnings).toHaveLength(1)
  expect(parsed.enrichment_warnings?.[0]).toContain("Slither finding")
  expect(parsed.enrichment_warnings?.[0]).toContain("Scribe must enrich")
  expect(parsed.enrichment_warnings?.[0]).not.toContain("Quality gate will flag this")
})

test("executeRecordFinding response echoes impact/recommendation/proofOfConcept/reported_by_agent (Task 1 / Bug #3)", async () => {
  const payload = await executeRecordFinding(
    {
      finding: JSON.stringify({
        check: "reentrancy-drain",
        severity: "Critical",
        confidence: "High",
        description: "Vault is vulnerable to reentrancy",
        file: "src/Vault.sol",
        lines: [42, 58],
        source: "slither",
        impact: "Complete vault drain via cross-function reentrancy",
        recommendation: "Add OpenZeppelin nonReentrant modifier on withdraw()",
        proofOfConcept: "forge test --match-test testReentrancyDrain -vvvv",
      }),
    },
    createContext("sentinel"),
  )

  const parsed = JSON.parse(payload) as {
    success: boolean
    findings: Array<{
      impact?: string
      recommendation?: string
      proofOfConcept?: string
      reported_by_agent?: string
    }>
  }

  expect(parsed.success).toBe(true)
  const f = parsed.findings[0]
  expect(f).toBeDefined()
  expect(f?.impact).toBe("Complete vault drain via cross-function reentrancy")
  expect(f?.recommendation).toBe("Add OpenZeppelin nonReentrant modifier on withdraw()")
  expect(f?.proofOfConcept).toBe("forge test --match-test testReentrancyDrain -vvvv")
  expect(f?.reported_by_agent).toBe("sentinel")
})

test("executeRecordFinding preserves audit-specialist attribution", async () => {
  const payload = await executeRecordFinding(
    {
      finding: JSON.stringify({
        check: "access-control-admin-bypass",
        severity: "High",
        confidence: "High",
        description: "Admin-only operation lacks an authorization guard",
        file: "src/Vault.sol",
        lines: [12, 18],
        source: "manual",
        impact: "Unauthorized callers can change privileged vault state",
        recommendation: "Restrict the function with the intended admin modifier",
        proofOfConcept: "Call the function from an unprivileged account",
      }),
    },
    createContext("audit-specialist"),
  )

  const parsed = JSON.parse(payload) as {
    success: boolean
    findings: Array<{ reported_by_agent?: string }>
  }

  expect(parsed.success).toBe(true)
  expect(parsed.findings[0]?.reported_by_agent).toBe("audit-specialist")
})

test("executeRecordFinding uses trusted context over spoofed reported_by_agent input", async () => {
  const payload = await executeRecordFinding(
    {
      finding: JSON.stringify({
        check: "spoofed-attribution",
        severity: "High",
        confidence: "High",
        description: "Payload attempts to spoof Scribe attribution",
        file: "src/Vault.sol",
        lines: [20, 25],
        source: "manual",
        reported_by_agent: "scribe",
        impact: "Lineage would incorrectly hide the reporting agent",
        recommendation: "Trust the tool context instead of payload attribution",
        proofOfConcept:
          "Call argus_record_finding from audit-specialist with reported_by_agent set to scribe",
      }),
    },
    createContext("audit-specialist"),
  )

  const parsed = JSON.parse(payload) as {
    success: boolean
    findings: Array<{ reported_by_agent?: string }>
  }

  expect(parsed.success).toBe(true)
  expect(parsed.findings[0]?.reported_by_agent).toBe("audit-specialist")
})

test("executeRecordFinding skips enrichment warnings for Low/Medium findings", async () => {
  const lowPayload = await executeRecordFinding(
    {
      finding: JSON.stringify({
        check: "gas-optimization",
        severity: "Low",
        confidence: "High",
        description: "Unused storage variable",
        file: "src/Vault.sol",
        lines: [10, 10],
        source: "manual",
      }),
    },
    createContext("sentinel"),
  )

  const lowParsed = JSON.parse(lowPayload) as {
    success: boolean
    enrichment_warnings?: string[]
  }
  expect(lowParsed.success).toBe(true)
  expect(lowParsed.enrichment_warnings).toBeUndefined()

  const mediumPayload = await executeRecordFinding(
    {
      finding: JSON.stringify({
        check: "missing-event",
        severity: "Medium",
        confidence: "Medium",
        description: "State change is missing an event",
        file: "src/Vault.sol",
        lines: [15, 15],
        source: "manual",
      }),
    },
    createContext("sentinel"),
  )

  const mediumParsed = JSON.parse(mediumPayload) as {
    success: boolean
    enrichment_warnings?: string[]
  }
  expect(mediumParsed.success).toBe(true)
  expect(mediumParsed.enrichment_warnings).toBeUndefined()
})
