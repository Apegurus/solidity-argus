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
    findings: Array<{ reported_by_agent: string; issue_fingerprint: string }>
  }

  expect(parsed.success).toBe(true)
  expect(parsed.count).toBe(1)
  expect(parsed.schema_version).toBe(SCHEMA_VERSION)
  expect(parsed.findings[0]?.reported_by_agent).toBe("sentinel")
  expect(typeof parsed.findings[0]?.issue_fingerprint).toBe("string")
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
    findings: Array<{ reported_by_agent: string }>
  }
  expect(parsed.count).toBe(2)
  expect(parsed.findings.every((finding) => finding.reported_by_agent === "pythia")).toBe(true)
})

test("executeRecordFinding rejects malformed finding payload", async () => {
  await expect(
    executeRecordFinding(
      {
        finding: "{bad-json}",
      },
      createContext("argus"),
    ),
  ).rejects.toThrow("finding must be valid JSON")
})
