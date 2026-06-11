import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { createAuditArtifactResolver } from "../shared/audit-artifact-resolver"
import type { AuditEvent, CanonicalFinding } from "../state/schemas"
import { SCHEMA_VERSION } from "../state/schemas"
import { executeReportGeneration } from "./report-generator-tool"

function context(dir: string): ToolContext {
  return {
    sessionID: "session-live",
    messageID: "message-1",
    agent: "scribe",
    directory: dir,
    worktree: dir,
    abort: new AbortController().signal,
    metadata() {
      return
    },
    async ask() {
      return
    },
  }
}

function finding(
  overrides: Partial<CanonicalFinding> & { seq: number; id: string },
): CanonicalFinding {
  return {
    check: "reentrancy-eth",
    severity: "Critical",
    confidence: "High",
    description: "finding",
    file: "src/Vault.sol",
    lines: [42, 58],
    source: "manual",
    run_id: "run-live",
    schema_version: SCHEMA_VERSION,
    observation_id: `obs-${overrides.id}`,
    issue_fingerprint: `issue-${overrides.id}`,
    observation_fingerprint: `of-${overrides.id}`,
    reported_by_agent: "audit-specialist",
    impact: "funds at risk",
    recommendation: "add a guard",
    ...overrides,
  }
}

function event(type: AuditEvent["type"], seq: number, payload: unknown): AuditEvent {
  return {
    type,
    run_id: "run-live",
    seq,
    session_id: "session-live",
    source: "test",
    schema_version: SCHEMA_VERSION,
    timestamp: 1_700_000_000_000 + seq,
    payload,
  }
}

// Reproduces the "Scribe stuck" path: an audit whose events are on disk but whose
// session has NOT been deleted/finalized. The report must still generate cleanly,
// materializing artifacts on demand, with rubric verdict + confidence surfaced.
test("generates a clean live report from events without session.deleted", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "argus-live-pipeline-"))
  const runId = "run-live"
  try {
    const events: AuditEvent[] = [
      event("session.created", 1, { scope: ["src/Vault.sol"] }),
      event(
        "finding.added",
        2,
        finding({
          seq: 2,
          id: "conf",
          severity: "Critical",
          rubric_verdict: "CONFIRMED",
          confidence_score: 90,
          description: "Cross-function reentrancy drains the vault",
        }),
      ),
      event(
        "finding.added",
        3,
        finding({
          seq: 3,
          id: "demo",
          check: "weak-randomness",
          severity: "Medium",
          rubric_verdict: "DEMOTED",
          confidence_score: 40,
          description: "Block-based randomness is weak but not clearly exploitable",
        }),
      ),
      event("session.idle", 4, { reason: "audit-paused" }),
    ]
    const journalFile = createAuditArtifactResolver(runId, tempDir).paths().journalFile
    await mkdir(dirname(journalFile), { recursive: true })
    await writeFile(journalFile, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`)

    const result = await executeReportGeneration(
      {
        project_name: "LiveVault",
        scope: ["src/Vault.sol"],
        run_id: runId,
        tool_coverage_policy: "skip",
      },
      context(tempDir),
    )

    // Live report is clean: no teardown lifecycle gap surfaced.
    expect(result.report).not.toContain("⚠ Completeness Warning")
    expect(result.report).not.toContain("Missing lifecycle")
    expect(result.report).not.toContain("session.deleted")

    // Rubric tiering + confidence survived dedup into the rendered report.
    expect(result.report).toContain("## Findings")
    expect(result.report).toContain("confidence: 90")
    expect(result.report).toContain("## Leads")
    expect(result.report).toContain("confidence: 40")
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
