import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAuditArtifactResolver } from "../../shared/audit-artifact-resolver"
import type { AuditEvent, CanonicalFinding } from "../../state/schemas"
import { SCHEMA_VERSION } from "../../state/schemas"
import { materializeFindings } from "./findings-materializer"

function makeFinding(runId: string, seq: number, id: string): CanonicalFinding {
  return {
    id,
    check: `check-${id}`,
    severity: "Medium",
    confidence: "High",
    description: `Finding ${id}`,
    file: "src/Vault.sol",
    lines: [seq, seq],
    source: "manual",
    run_id: runId,
    seq,
    schema_version: SCHEMA_VERSION,
    observation_id: `obs-${id}`,
    issue_fingerprint: `issue-${id}`,
    observation_fingerprint: `observation-${id}`,
    reported_by_agent: "argus",
  }
}

function makeEvents(runId: string, sessionId: string): AuditEvent[] {
  return [
    {
      type: "session.created",
      run_id: runId,
      seq: 1,
      session_id: sessionId,
      source: "test",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_001,
      payload: { scope: ["src/Vault.sol"] },
    },
    {
      type: "finding.added",
      run_id: runId,
      seq: 2,
      session_id: sessionId,
      source: "test",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_002,
      payload: makeFinding(runId, 2, "f-1"),
    },
    {
      type: "finding.added",
      run_id: runId,
      seq: 3,
      session_id: sessionId,
      source: "test",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_003,
      payload: makeFinding(runId, 3, "f-2"),
    },
    {
      type: "session.idle",
      run_id: runId,
      seq: 4,
      session_id: sessionId,
      source: "test",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_004,
      payload: { reason: "test-complete" },
    },
  ]
}

async function writeEventsJsonl(
  projectDir: string,
  runId: string,
  events: AuditEvent[],
): Promise<void> {
  const filePath = createAuditArtifactResolver(runId, projectDir).paths().journalFile
  await mkdir(join(projectDir, ".argus", "runs", runId), { recursive: true })
  await writeFile(filePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`)
}

describe("materializeFindings", () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tempDirs.length = 0
  })

  async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "argus-findings-materializer-"))
    tempDirs.push(dir)
    return dir
  }

  test("produces byte-identical output for identical events", async () => {
    const runId = "run-hash"
    const projectDir = await makeTempDir()
    const sessionId = "session-hash"
    await writeEventsJsonl(projectDir, runId, makeEvents(runId, sessionId))

    const originalNow = Date.now
    let firstBytes = ""
    let secondBytes = ""
    try {
      Date.now = () => 1_700_000_123_000
      const first = await materializeFindings(runId, projectDir, sessionId)
      const findingsFile = createAuditArtifactResolver(runId, projectDir).paths().findingsFile
      firstBytes = await readFile(findingsFile, "utf8")

      Date.now = () => 1_800_000_123_000
      const second = await materializeFindings(runId, projectDir, sessionId)
      secondBytes = await readFile(findingsFile, "utf8")

      expect(first.content_hash).toBe(second.content_hash)
      expect(first.generated_at).toBe(1_700_000_000_004)
      expect(second.generated_at).toBe(1_700_000_000_004)
      expect(firstBytes).toBe(secondBytes)
    } finally {
      Date.now = originalNow
    }
  })

  test("output contains run_id, session_id, seq_first, seq_last, event_count", async () => {
    const runId = "run-metadata"
    const projectDir = await makeTempDir()
    const sessionId = "session-metadata"
    const events = makeEvents(runId, sessionId)
    await writeEventsJsonl(projectDir, runId, events)

    const artifact = await materializeFindings(runId, projectDir)

    expect(artifact.run_id).toBe(runId)
    expect(artifact.session_id).toBe(sessionId)
    expect(artifact.seq_first).toBe(1)
    expect(artifact.seq_last).toBe(4)
    expect(artifact.event_count).toBe(events.length)
  })

  test("distinct run directories produce isolated findings artifacts", async () => {
    const projectDir = await makeTempDir()
    const runOne = "run-one"
    const runTwo = "run-two"
    const sessionId = "session-isolated"

    await writeEventsJsonl(projectDir, runOne, makeEvents(runOne, sessionId))
    await writeEventsJsonl(projectDir, runTwo, makeEvents(runTwo, sessionId))

    await materializeFindings(runOne, projectDir, sessionId)
    await materializeFindings(runTwo, projectDir, sessionId)

    const runOneFile = createAuditArtifactResolver(runOne, projectDir).paths().findingsFile
    const runTwoFile = createAuditArtifactResolver(runTwo, projectDir).paths().findingsFile

    expect(runOneFile).not.toBe(runTwoFile)

    const runOneArtifact = JSON.parse(await readFile(runOneFile, "utf8")) as { run_id: string }
    const runTwoArtifact = JSON.parse(await readFile(runTwoFile, "utf8")) as { run_id: string }

    expect(runOneArtifact.run_id).toBe(runOne)
    expect(runTwoArtifact.run_id).toBe(runTwo)
  })
})
