import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { createAuditArtifactResolver } from "../shared/audit-artifact-resolver"
import type { DroppedObservation } from "../shared/dropped-observations"
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
          check: "uninitialized-proxy-implementation",
          severity: "Critical",
          rubric_verdict: "CONFIRMED",
          confidence_score: 90,
          description:
            "Implementation contract left uninitialized; initializer is callable by anyone",
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

async function writeJournal(runId: string, dir: string, events: AuditEvent[]): Promise<void> {
  const journalFile = createAuditArtifactResolver(runId, dir).paths().journalFile
  await mkdir(dirname(journalFile), { recursive: true })
  await writeFile(journalFile, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`)
}

async function writeDeduped(
  runId: string,
  dir: string,
  findings: Array<Record<string, unknown>>,
  dropped_observations: DroppedObservation[] = [],
): Promise<void> {
  const dedupedFile = createAuditArtifactResolver(runId, dir).paths().dedupedFindingsFile
  await mkdir(dirname(dedupedFile), { recursive: true })
  await writeFile(
    dedupedFile,
    JSON.stringify(
      { run_id: runId, findings, dropped_observations, deduped_by: "scribe" },
      null,
      2,
    ),
  )
}

test("strict report generation accepts scoped findings with dropped out-of-scope observations", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "argus-parity-dropped-oos-"))
  const runId = "run-live"
  try {
    const events: AuditEvent[] = [
      event("session.created", 1, { scope: ["src/Vault.sol"] }),
      event(
        "finding.added",
        2,
        finding({
          seq: 2,
          id: "vault",
          observation_id: "obs-vault",
          issue_fingerprint: "issue-vault",
          check: "missing-access-control",
          severity: "Medium",
          file: "src/Vault.sol",
          rubric_verdict: "CONFIRMED",
          confidence_score: 90,
        }),
      ),
      event(
        "finding.added",
        3,
        finding({
          seq: 3,
          id: "token",
          observation_id: "obs-token",
          issue_fingerprint: "issue-token",
          check: "erc20-interface",
          severity: "Medium",
          file: "src/Token.sol",
        }),
      ),
      event("session.idle", 4, { reason: "audit-paused" }),
    ]
    await writeJournal(runId, tempDir, events)
    await writeDeduped(
      runId,
      tempDir,
      [
        {
          ...finding({
            seq: 2,
            id: "vault",
            observation_id: "obs-vault",
            issue_fingerprint: "issue-vault",
            check: "missing-access-control",
            severity: "Medium",
            file: "src/Vault.sol",
            rubric_verdict: "CONFIRMED",
            confidence_score: 90,
          }),
          id: "issue-vault",
          observation_ids: ["obs-vault"],
          observation_count: 1,
        },
      ],
      [{ observation_id: "obs-token", reason: "out-of-scope", note: "outside requested scope" }],
    )

    const result = await executeReportGeneration(
      {
        project_name: "ScopedVault",
        scope: ["src/Vault.sol"],
        run_id: runId,
        preflight_policy: "strict-fail",
        quality_gate_policy: "strict-fail",
        tool_coverage_policy: "skip",
      },
      context(tempDir),
    )

    expect(result.qualityGates.passed).toBe(true)
    expect(result.report).toContain("src/Vault.sol")
    expect(result.report).not.toContain("src/Token.sol")
    expect(result.report).not.toContain("Finding parity mismatch")
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("report parity validates deduped lineage against the deduped raw universe, not the raw projection (P0-1)", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "argus-parity-dedup-"))
  const runId = "run-live"
  try {
    const events: AuditEvent[] = [
      event("session.created", 1, { scope: ["src/Vault.sol"] }),
      event(
        "finding.added",
        2,
        finding({ seq: 2, id: "a", observation_id: "obs-a", issue_fingerprint: "issue-shared" }),
      ),
      event(
        "finding.added",
        3,
        finding({
          seq: 3,
          id: "b",
          observation_id: "obs-b",
          issue_fingerprint: "issue-shared",
          check: "reentrancy-cei",
        }),
      ),
      event(
        "finding.added",
        4,
        finding({
          seq: 4,
          id: "c",
          observation_id: "obs-c",
          issue_fingerprint: "issue-other",
          check: "missing-access-control",
          severity: "Medium",
        }),
      ),
      event("session.idle", 5, { reason: "audit-paused" }),
    ]
    await writeJournal(runId, tempDir, events)
    await writeDeduped(runId, tempDir, [
      {
        ...finding({ seq: 2, id: "a", observation_id: "obs-a", issue_fingerprint: "issue-shared" }),
        id: "issue-shared",
        observation_ids: ["obs-a", "obs-b"],
        observation_count: 2,
      },
      {
        ...finding({
          seq: 4,
          id: "c",
          observation_id: "obs-c",
          issue_fingerprint: "issue-other",
          check: "missing-access-control",
          severity: "Medium",
        }),
        id: "issue-other",
        observation_ids: ["obs-c"],
        observation_count: 1,
      },
    ])

    const result = await executeReportGeneration(
      {
        project_name: "ParityVault",
        scope: ["src/Vault.sol"],
        run_id: runId,
        tool_coverage_policy: "skip",
      },
      context(tempDir),
    )

    expect(result.report).not.toContain("⚠ Completeness Warning")
    expect(result.report).not.toContain("Finding parity mismatch")
    expect(result.report).not.toContain("Missing observation IDs")
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

// Guard against over-correction: a GENUINE Scribe omission (a deduped raw observation
// that the deduped set never references and never drops) must still surface as a parity
// gap. The fix narrows the raw universe to the deduped set; it must not suppress real gaps.
test("report parity still flags a genuine deduped-lineage gap (P0-1 no-suppression)", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "argus-parity-gap-"))
  const runId = "run-live"
  try {
    const events: AuditEvent[] = [
      event("session.created", 1, { scope: ["src/Vault.sol"] }),
      event(
        "finding.added",
        2,
        finding({ seq: 2, id: "a", observation_id: "obs-a", issue_fingerprint: "issue-shared" }),
      ),
      event(
        "finding.added",
        3,
        finding({
          seq: 3,
          id: "c",
          observation_id: "obs-c",
          issue_fingerprint: "issue-other",
          check: "missing-access-control",
          severity: "Medium",
        }),
      ),
      event("session.idle", 4, { reason: "audit-paused" }),
    ]
    await writeJournal(runId, tempDir, events)
    await writeDeduped(runId, tempDir, [
      {
        ...finding({ seq: 2, id: "a", observation_id: "obs-a", issue_fingerprint: "issue-shared" }),
        id: "issue-shared",
        observation_ids: ["obs-a"],
        observation_count: 1,
      },
    ])

    const result = await executeReportGeneration(
      {
        project_name: "GapVault",
        scope: ["src/Vault.sol"],
        run_id: runId,
        tool_coverage_policy: "skip",
      },
      context(tempDir),
    )

    expect(result.report).toContain("⚠ Completeness Warning")
    expect(result.report).toContain("Finding parity mismatch")
    expect(result.report).toContain("obs-c")
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
