import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { materializeReportInput } from "../../src/features/persistent-state/findings-materializer"
import { createAuditArtifactResolver } from "../../src/shared/audit-artifact-resolver"
import { type AuditEvent, type CanonicalFinding, SCHEMA_VERSION } from "../../src/state/schemas"
import { executeReadFindings } from "../../src/tools/read-findings-tool"
import { executeReportGeneration } from "../../src/tools/report-generator-tool"

const RUN_ID = "run-canonical-pipeline"
const SESSION_ID = "session-canonical-pipeline"

function createContext(directory: string): ToolContext {
  return {
    sessionID: SESSION_ID,
    messageID: "message-canonical-pipeline",
    agent: "scribe",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {
      return
    },
    async ask() {
      return
    },
  }
}

function makeFinding(overrides: Partial<CanonicalFinding>): CanonicalFinding {
  return {
    id: overrides.id ?? "finding-default",
    check: overrides.check ?? "default-check",
    severity: overrides.severity ?? "High",
    confidence: overrides.confidence ?? "High",
    description: overrides.description ?? "Test finding",
    file: overrides.file ?? "src/Vault.sol",
    lines: overrides.lines ?? [10, 20],
    source: overrides.source ?? "slither",
    run_id: overrides.run_id ?? RUN_ID,
    seq: overrides.seq ?? 1,
    schema_version: overrides.schema_version ?? SCHEMA_VERSION,
    observation_id: overrides.observation_id ?? `obs-${overrides.seq ?? 1}`,
    issue_fingerprint: overrides.issue_fingerprint ?? `issue-${overrides.id ?? "default"}`,
    observation_fingerprint:
      overrides.observation_fingerprint ?? `obsfp-${overrides.id ?? "default"}`,
    reported_by_agent: overrides.reported_by_agent ?? "sentinel",
    reported_by_session_id: overrides.reported_by_session_id ?? SESSION_ID,
  }
}

function fixtureEvents(): AuditEvent[] {
  const base = {
    run_id: RUN_ID,
    session_id: SESSION_ID,
    schema_version: SCHEMA_VERSION,
    source: "argus",
  }

  return [
    {
      ...base,
      type: "session.created",
      seq: 1,
      timestamp: 1_700_000_000_001,
      payload: { scope: ["src/Vault.sol"] },
    },
    {
      ...base,
      type: "tool.started",
      seq: 2,
      timestamp: 1_700_000_000_002,
      tool_call_id: "tc-1",
      payload: { tool: "argus_slither_analyze" },
    },
    {
      ...base,
      type: "tool.completed",
      seq: 3,
      timestamp: 1_700_000_000_003,
      tool_call_id: "tc-1",
      payload: { tool: "argus_slither_analyze", success: true, findingsCount: 1 },
    },
    {
      ...base,
      type: "finding.added",
      seq: 4,
      timestamp: 1_700_000_000_004,
      payload: makeFinding({
        id: "f-reentrancy",
        check: "reentrancy-eth",
        severity: "High",
        confidence: "High",
        file: "src/Vault.sol",
        lines: [42, 55],
        source: "slither",
        seq: 4,
      }),
    },
    {
      ...base,
      type: "tool.started",
      seq: 5,
      timestamp: 1_700_000_000_005,
      tool_call_id: "tc-2",
      payload: { tool: "argus_check_patterns" },
    },
    {
      ...base,
      type: "tool.completed",
      seq: 6,
      timestamp: 1_700_000_000_006,
      tool_call_id: "tc-2",
      payload: { tool: "argus_check_patterns", success: true, findingsCount: 1 },
    },
    {
      ...base,
      type: "finding.added",
      seq: 7,
      timestamp: 1_700_000_000_007,
      payload: makeFinding({
        id: "f-access",
        check: "missing-access-control",
        severity: "Medium",
        confidence: "Medium",
        file: "src/Vault.sol",
        lines: [16, 23],
        source: "pattern",
        seq: 7,
      }),
    },
    {
      ...base,
      type: "session.deleted",
      seq: 8,
      timestamp: 1_700_000_000_008,
      payload: {},
    },
  ]
}

async function writeJournalEvents(
  projectDir: string,
  runId: string,
  events: AuditEvent[],
): Promise<void> {
  const resolver = createAuditArtifactResolver(runId, projectDir)
  const journalFile = resolver.paths().journalFile
  await mkdir(dirname(journalFile), { recursive: true })
  await writeFile(journalFile, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`)
}

describe("canonical report pipeline E2E", () => {
  test("full pipeline: events → materializeReportInput → argus_read_findings → argus_generate_report", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "argus-canonical-pipeline-"))

    try {
      // Step 1: Write events to the journal (simulates a complete audit)
      const events = fixtureEvents()
      await writeJournalEvents(projectDir, RUN_ID, events)

      // Step 2: Materialize report-input.json (simulates session.idle trigger)
      const reportInput = await materializeReportInput(RUN_ID, projectDir, SESSION_ID)

      // Verify the artifact was written to disk
      const resolver = createAuditArtifactResolver(RUN_ID, projectDir)
      const reportInputFile = resolver.paths().reportInputFile
      expect(existsSync(reportInputFile)).toBe(true)

      // Verify the materialized ReportInput has correct data
      expect(reportInput.run_id).toBe(RUN_ID)
      expect(reportInput.session_id).toBe(SESSION_ID)
      expect(reportInput.findings).toHaveLength(2)
      expect(reportInput.toolsExecuted).toHaveLength(2)
      expect(reportInput.scope).toEqual(["src/Vault.sol"])

      // Step 3: Read it back via argus_read_findings (simulates Scribe's first step)
      const context = createContext(projectDir)
      const readResult = JSON.parse(await executeReadFindings({ run_id: RUN_ID }, context))
      expect(readResult.success).toBe(true)
      expect(readResult.source).toBe("report-input.json")
      expect(readResult.reportInput.run_id).toBe(RUN_ID)
      expect(readResult.reportInput.findings).toHaveLength(2)
      expect(readResult.reportInput.toolsExecuted).toHaveLength(2)

      // Step 4: Generate report using run_id (simulates Scribe's actual flow —
      // read_findings returns compact data for context, generate_report reads full
      // canonical data from disk via run_id)
      const result = await executeReportGeneration(
        {
          project_name: "CanonicalPipelineTest",
          scope: ["src/Vault.sol"],
          run_id: RUN_ID,
          preflight_policy: "warn",
          tool_coverage_policy: "skip",
        },
        context,
        {
          readEvents: async () => events,
        },
      )

      // Verify the report was generated correctly
      expect(result.report).toContain("# Security Audit Report — CanonicalPipelineTest")
      expect(result.findingsCount.high).toBe(1)
      expect(result.findingsCount.medium).toBe(1)
      expect(result.run_id).toBe(RUN_ID)

      // Verify report contains the actual findings
      expect(result.report).toContain("Reentrancy")
      expect(result.report).toContain("Access Control")
    } finally {
      await rm(projectDir, { recursive: true, force: true })
    }
  })

  test("argus_read_findings fails gracefully when report-input.json doesn't exist", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "argus-canonical-no-artifact-"))

    try {
      const context = createContext(projectDir)
      await expect(executeReadFindings({ run_id: "nonexistent-run" }, context)).rejects.toThrow(
        "No events found for run",
      )
    } finally {
      await rm(projectDir, { recursive: true, force: true })
    }
  })

  test("materializeReportInput uses 'pending-finalization' for tool_call_id when no run.finalized event exists", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "argus-canonical-pending-"))

    try {
      // Events WITHOUT run.finalized — simulates materialization on session.idle
      const events = fixtureEvents()
      await writeJournalEvents(projectDir, RUN_ID, events)

      const reportInput = await materializeReportInput(RUN_ID, projectDir, SESSION_ID)

      // No run.finalized event → tool_call_id should be the placeholder
      expect(reportInput.tool_call_id).toBe("pending-finalization")

      // The artifact should still be readable via argus_read_findings
      const context = createContext(projectDir)
      const readResult = JSON.parse(await executeReadFindings({ run_id: RUN_ID }, context))
      expect(readResult.success).toBe(true)
      expect(readResult.reportInput.run_id).toBe(RUN_ID)
    } finally {
      await rm(projectDir, { recursive: true, force: true })
    }
  })

  test("re-materialization overwrites stale artifact with fresh data", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "argus-canonical-rematerialize-"))

    try {
      // Write initial events (2 findings)
      const events = fixtureEvents()
      await writeJournalEvents(projectDir, RUN_ID, events)

      const first = await materializeReportInput(RUN_ID, projectDir, SESSION_ID)
      expect(first.findings).toHaveLength(2)

      // Append a third finding to the journal
      const resolver = createAuditArtifactResolver(RUN_ID, projectDir)
      const journalFile = resolver.paths().journalFile
      const extraFinding: AuditEvent = {
        run_id: RUN_ID,
        session_id: SESSION_ID,
        schema_version: SCHEMA_VERSION,
        source: "argus",
        type: "finding.added",
        seq: 9,
        timestamp: 1_700_000_000_009,
        payload: makeFinding({
          id: "f-extra",
          check: "unchecked-return",
          severity: "Low",
          confidence: "Low",
          file: "src/Vault.sol",
          lines: [60, 62],
          source: "manual",
          seq: 9,
        }),
      }

      // Re-write the full journal with the new event appended
      const allEvents = [...events, extraFinding]
      await writeFile(journalFile, `${allEvents.map((e) => JSON.stringify(e)).join("\n")}\n`)

      // Re-materialize — should pick up the new finding
      const second = await materializeReportInput(RUN_ID, projectDir, SESSION_ID)
      expect(second.findings).toHaveLength(3)

      // Read it back to confirm disk artifact is fresh
      const context = createContext(projectDir)
      const readResult = JSON.parse(await executeReadFindings({ run_id: RUN_ID }, context))
      expect(readResult.reportInput.findings).toHaveLength(3)
    } finally {
      await rm(projectDir, { recursive: true, force: true })
    }
  })
})
