import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { createAuditArtifactResolver } from "../shared/audit-artifact-resolver"
import { type CanonicalFinding, SCHEMA_VERSION } from "../state/schemas"
import { executePersistDeduped } from "./persist-deduped-tool"

function context(directory: string): ToolContext {
  return {
    sessionID: "session-1",
    messageID: "message-1",
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

function finding(overrides: Partial<CanonicalFinding> = {}): CanonicalFinding {
  const id = overrides.id ?? "finding-1"
  return {
    id,
    check: overrides.check ?? id,
    severity: overrides.severity ?? "Medium",
    confidence: overrides.confidence ?? "High",
    description: overrides.description ?? id,
    file: overrides.file ?? "src/Vault.sol",
    lines: overrides.lines ?? [1, 1],
    source: overrides.source ?? "manual",
    run_id: overrides.run_id ?? "run-1",
    seq: overrides.seq ?? 1,
    schema_version: overrides.schema_version ?? SCHEMA_VERSION,
    observation_id: overrides.observation_id ?? `obs-${id}`,
    issue_fingerprint: overrides.issue_fingerprint ?? `issue-${id}`,
    observation_fingerprint: overrides.observation_fingerprint ?? `obsfp-${id}`,
    reported_by_agent: overrides.reported_by_agent ?? "sentinel",
    observation_ids: overrides.observation_ids,
    observation_count: overrides.observation_count,
  }
}

function writeRawFindings(projectDir: string, runId: string, findings: CanonicalFinding[]): void {
  const resolver = createAuditArtifactResolver(runId, projectDir)
  mkdirSync(path.dirname(resolver.paths().findingsFile), { recursive: true })
  writeFileSync(resolver.paths().findingsFile, JSON.stringify({ findings }, null, 2))
}

test("executePersistDeduped writes valid deduped lineage", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "argus-persist-valid-"))
  try {
    const runId = "run-valid"
    writeRawFindings(tempDir, runId, [finding({ id: "raw-a", observation_id: "obs-a" })])
    const deduped = [finding({ id: "dedup-a", observation_ids: ["obs-a"], observation_count: 1 })]

    const output = JSON.parse(
      await executePersistDeduped(
        { run_id: runId, deduped_findings: JSON.stringify(deduped) },
        context(tempDir),
      ),
    )

    const dedupedPath = createAuditArtifactResolver(runId, tempDir).paths().dedupedFindingsFile
    expect(output.success).toBe(true)
    expect(output.path).toBe(dedupedPath)
    expect(existsSync(dedupedPath)).toBe(true)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("executePersistDeduped rejects missing raw findings without writing", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "argus-persist-missing-"))
  try {
    const runId = "run-missing"
    const deduped = [finding({ id: "dedup-a", observation_ids: ["obs-a"], observation_count: 1 })]

    const output = JSON.parse(
      await executePersistDeduped(
        { run_id: runId, deduped_findings: JSON.stringify(deduped) },
        context(tempDir),
      ),
    )

    const dedupedPath = createAuditArtifactResolver(runId, tempDir).paths().dedupedFindingsFile
    expect(output).toEqual({
      success: false,
      error: "MissingRawFindingsError",
      message: `Cannot verify deduped lineage because .argus/runs/${runId}/findings.json is missing or invalid`,
    })
    expect(existsSync(dedupedPath)).toBe(false)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("executePersistDeduped rejects invalid lineage without writing", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "argus-persist-lineage-"))
  try {
    const runId = "run-lineage"
    writeRawFindings(tempDir, runId, [
      finding({ id: "raw-a", observation_id: "obs-a" }),
      finding({ id: "raw-b", observation_id: "obs-b" }),
    ])
    const deduped = [
      finding({
        id: "dedup-a",
        check: "dedup-a",
        observation_ids: ["obs-a", "obs-missing"],
        observation_count: 1,
      }),
      finding({
        id: "dedup-b",
        check: "dedup-b",
        observation_ids: ["obs-a"],
        observation_count: 1,
      }),
    ]

    const output = JSON.parse(
      await executePersistDeduped(
        { run_id: runId, deduped_findings: JSON.stringify(deduped) },
        context(tempDir),
      ),
    )

    const dedupedPath = createAuditArtifactResolver(runId, tempDir).paths().dedupedFindingsFile
    expect(output.success).toBe(false)
    expect(output.error).toBe("LineageError")
    expect(output.lineage).toMatchObject({
      raw_count: 2,
      mapped_count: 3,
      duplicate_observation_ids: ["obs-a"],
      phantom_observation_ids: ["obs-missing"],
      missing_observation_ids: ["obs-b"],
    })
    expect(output.lineage.count_mismatches).toEqual([
      { check: "dedup-a", observation_count: 1, observation_ids_length: 2 },
    ])
    expect(existsSync(dedupedPath)).toBe(false)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
