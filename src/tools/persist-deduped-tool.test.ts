import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
    expect(output.phantom_diagnostic).toEqual([
      { id: "obs-missing", likely_source: "unrecognized provenance — not minted by this run" },
    ])
    expect(output.hint).toContain("argus_read_findings")
    expect(output.hint).toContain(runId)
    expect(existsSync(dedupedPath)).toBe(false)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("executePersistDeduped accepts object payload with dropped observations", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "argus-persist-dropped-"))
  try {
    const runId = "run-dropped"
    writeRawFindings(tempDir, runId, [
      finding({ id: "raw-a", observation_id: "obs-a" }),
      finding({ id: "raw-b", observation_id: "obs-b" }),
    ])
    const deduped = [finding({ id: "dedup-a", observation_ids: ["obs-a"], observation_count: 1 })]
    const payload = {
      findings: deduped,
      dropped_observations: [
        { observation_id: "obs-b", reason: "false-positive", note: "not exploitable" },
      ],
    }

    const output = JSON.parse(
      await executePersistDeduped(
        { run_id: runId, deduped_findings: JSON.stringify(payload) },
        context(tempDir),
      ),
    )

    const artifact = JSON.parse(
      readFileSync(createAuditArtifactResolver(runId, tempDir).paths().dedupedFindingsFile, "utf8"),
    )
    expect(output.success).toBe(true)
    expect(output.dropped_observations_count).toBe(1)
    expect(artifact.dropped_observations).toEqual(payload.dropped_observations)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("executePersistDeduped is idempotent for identical semantic content", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "argus-persist-idempotent-"))
  try {
    const runId = "run-idempotent"
    writeRawFindings(tempDir, runId, [finding({ id: "raw-a", observation_id: "obs-a" })])
    const deduped = [finding({ id: "dedup-a", observation_ids: ["obs-a"], observation_count: 1 })]

    const first = JSON.parse(
      await executePersistDeduped(
        { run_id: runId, deduped_findings: JSON.stringify({ findings: deduped }) },
        context(tempDir),
      ),
    )
    const dedupedPath = createAuditArtifactResolver(runId, tempDir).paths().dedupedFindingsFile
    const firstArtifact = JSON.parse(readFileSync(dedupedPath, "utf8"))

    const second = JSON.parse(
      await executePersistDeduped(
        { run_id: runId, deduped_findings: JSON.stringify({ findings: deduped }) },
        context(tempDir),
      ),
    )
    const secondArtifact = JSON.parse(readFileSync(dedupedPath, "utf8"))

    expect(first.success).toBe(true)
    expect(second).toMatchObject({ success: true, idempotent: true })
    expect(secondArtifact.deduped_at).toBe(firstArtifact.deduped_at)
    expect(secondArtifact.content_hash).toBe(firstArtifact.content_hash)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("executePersistDeduped is idempotent for semantically identical key order changes", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "argus-persist-key-order-"))
  try {
    const runId = "run-key-order"
    writeRawFindings(tempDir, runId, [finding({ id: "raw-a", observation_id: "obs-a" })])

    const firstPayload = `{"findings":[{"id":"dedup-a","check":"dedup-a","severity":"Medium","confidence":"High","description":"dedup-a","file":"src/Vault.sol","lines":[1,1],"source":"manual","run_id":"run-1","seq":1,"schema_version":"${SCHEMA_VERSION}","observation_id":"obs-dedup-a","issue_fingerprint":"issue-dedup-a","observation_fingerprint":"obsfp-dedup-a","reported_by_agent":"sentinel","observation_ids":["obs-a"],"observation_count":1}]}`
    const secondPayload = `{"findings":[{"observation_count":1,"observation_ids":["obs-a"],"reported_by_agent":"sentinel","observation_fingerprint":"obsfp-dedup-a","issue_fingerprint":"issue-dedup-a","observation_id":"obs-dedup-a","schema_version":"${SCHEMA_VERSION}","seq":1,"run_id":"run-1","source":"manual","lines":[1,1],"file":"src/Vault.sol","description":"dedup-a","confidence":"High","severity":"Medium","check":"dedup-a","id":"dedup-a"}]}`

    const first = JSON.parse(
      await executePersistDeduped(
        { run_id: runId, deduped_findings: firstPayload },
        context(tempDir),
      ),
    )
    const second = JSON.parse(
      await executePersistDeduped(
        { run_id: runId, deduped_findings: secondPayload },
        context(tempDir),
      ),
    )

    expect(first.success).toBe(true)
    expect(second).toMatchObject({ success: true, idempotent: true })
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
