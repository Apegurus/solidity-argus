import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAuditArtifactResolver } from "../../shared/audit-artifact-resolver"
import type { AuditEvent, CanonicalFinding } from "../../state/schemas"
import { SCHEMA_VERSION } from "../../state/schemas"
import { materializeFindings, materializeReportInput } from "./findings-materializer"

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

  test("throws when validateSessionId is enabled and session does not match events", async () => {
    const runId = "run-session-mismatch"
    const projectDir = await makeTempDir()
    await writeEventsJsonl(projectDir, runId, makeEvents(runId, "session-from-events"))

    await expect(
      materializeFindings(runId, projectDir, "session-from-caller", { validateSessionId: true }),
    ).rejects.toThrow("Session mismatch")
  })

  test("throws when requireEvents is enabled and run has no events", async () => {
    const runId = "run-no-events"
    const projectDir = await makeTempDir()

    await expect(
      materializeFindings(runId, projectDir, "session-any", { requireEvents: true }),
    ).rejects.toThrow("No events found")
  })
})

describe("materializeReportInput", () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tempDirs.length = 0
  })

  async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "argus-report-input-materializer-"))
    tempDirs.push(dir)
    return dir
  }

  test("writes report-input.json to the correct path", async () => {
    const runId = "run-report-input-path"
    const projectDir = await makeTempDir()
    const sessionId = "session-report-input-path"
    await writeEventsJsonl(projectDir, runId, makeEvents(runId, sessionId))

    await materializeReportInput(runId, projectDir)

    const reportInputFile = createAuditArtifactResolver(runId, projectDir).paths().reportInputFile
    const onDisk = JSON.parse(await readFile(reportInputFile, "utf8")) as { run_id: string }
    expect(onDisk.run_id).toBe(runId)
  })

  test("returns a valid ReportInput with all required fields", async () => {
    const runId = "run-report-input-shape"
    const projectDir = await makeTempDir()
    const sessionId = "session-report-input-shape"
    await writeEventsJsonl(projectDir, runId, makeEvents(runId, sessionId))

    const reportInput = await materializeReportInput(runId, projectDir)

    expect(reportInput.run_id).toBe(runId)
    expect(reportInput.schema_version).toBe(SCHEMA_VERSION)
    expect(Array.isArray(reportInput.findings)).toBe(true)
    expect(Array.isArray(reportInput.toolsExecuted)).toBe(true)
    expect(Array.isArray(reportInput.scope)).toBe(true)
    expect(reportInput.projectDir).toBe(projectDir)
  })

  test("throws when no events exist", async () => {
    const runId = "run-report-input-no-events"
    const projectDir = await makeTempDir()

    await expect(materializeReportInput(runId, projectDir)).rejects.toThrow(
      `No events found for run ${runId}`,
    )
  })

  test("produces deterministic output for same events", async () => {
    const runId = "run-report-input-deterministic"
    const projectDir = await makeTempDir()
    const sessionId = "session-report-input-deterministic"
    await writeEventsJsonl(projectDir, runId, makeEvents(runId, sessionId))

    const reportInputFile = createAuditArtifactResolver(runId, projectDir).paths().reportInputFile

    await materializeReportInput(runId, projectDir)
    const firstBytes = await readFile(reportInputFile, "utf8")

    await materializeReportInput(runId, projectDir)
    const secondBytes = await readFile(reportInputFile, "utf8")

    expect(firstBytes).toBe(secondBytes)
  })

  describe("cross-run findings aggregation", () => {
    test("collects findings from sibling runs that share session_ids", async () => {
      const projectDir = await makeTempDir()
      const primaryRunId = "run-primary"
      const siblingRunId = "run-sibling"
      const sessionId = "shared-session"

      const primaryEvents: AuditEvent[] = [
        {
          type: "session.created",
          run_id: primaryRunId,
          seq: 1,
          session_id: sessionId,
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_001_001,
          payload: { scope: ["src/Vault.sol"] },
        },
        {
          type: "session.idle",
          run_id: primaryRunId,
          seq: 2,
          session_id: sessionId,
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_001_002,
          payload: { reason: "test-complete" },
        },
      ]

      const siblingEvents: AuditEvent[] = [
        {
          type: "session.created",
          run_id: siblingRunId,
          seq: 1,
          session_id: sessionId,
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_002_001,
          payload: { scope: ["src/Vault.sol"] },
        },
        {
          type: "finding.added",
          run_id: siblingRunId,
          seq: 2,
          session_id: sessionId,
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_002_002,
          payload: makeFinding(siblingRunId, 2, "s-1"),
        },
        {
          type: "finding.added",
          run_id: siblingRunId,
          seq: 3,
          session_id: sessionId,
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_002_003,
          payload: makeFinding(siblingRunId, 3, "s-2"),
        },
        {
          type: "session.idle",
          run_id: siblingRunId,
          seq: 4,
          session_id: sessionId,
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_002_004,
          payload: { reason: "test-complete" },
        },
      ]

      await writeEventsJsonl(projectDir, primaryRunId, primaryEvents)
      await writeEventsJsonl(projectDir, siblingRunId, siblingEvents)

      const reportInput = await materializeReportInput(primaryRunId, projectDir)

      expect(reportInput.findings.length).toBe(2)
    })

    test("does not collect findings from unrelated sibling runs", async () => {
      const projectDir = await makeTempDir()
      const primaryRunId = "run-primary"
      const unrelatedRunId = "run-unrelated"

      const primaryEvents: AuditEvent[] = [
        {
          type: "session.created",
          run_id: primaryRunId,
          seq: 1,
          session_id: "session-A",
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_003_001,
          payload: { scope: ["src/Vault.sol"] },
        },
        {
          type: "session.idle",
          run_id: primaryRunId,
          seq: 2,
          session_id: "session-A",
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_003_002,
          payload: { reason: "test-complete" },
        },
      ]

      const unrelatedEvents: AuditEvent[] = [
        {
          type: "session.created",
          run_id: unrelatedRunId,
          seq: 1,
          session_id: "session-B",
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_004_001,
          payload: { scope: ["src/Vault.sol"] },
        },
        {
          type: "finding.added",
          run_id: unrelatedRunId,
          seq: 2,
          session_id: "session-B",
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_004_002,
          payload: makeFinding(unrelatedRunId, 2, "u-1"),
        },
        {
          type: "finding.added",
          run_id: unrelatedRunId,
          seq: 3,
          session_id: "session-B",
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_004_003,
          payload: makeFinding(unrelatedRunId, 3, "u-2"),
        },
        {
          type: "session.idle",
          run_id: unrelatedRunId,
          seq: 4,
          session_id: "session-B",
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_004_004,
          payload: { reason: "test-complete" },
        },
      ]

      await writeEventsJsonl(projectDir, primaryRunId, primaryEvents)
      await writeEventsJsonl(projectDir, unrelatedRunId, unrelatedEvents)

      const reportInput = await materializeReportInput(primaryRunId, projectDir)

      expect(reportInput.findings.length).toBe(0)
    })

    test("prefers primary run findings over cross-run findings", async () => {
      const projectDir = await makeTempDir()
      const primaryRunId = "run-primary"
      const siblingRunId = "run-sibling"
      const sessionId = "shared-session"

      const primaryEvents = makeEvents(primaryRunId, sessionId)
      const siblingEvents: AuditEvent[] = [
        {
          type: "session.created",
          run_id: siblingRunId,
          seq: 1,
          session_id: sessionId,
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_005_001,
          payload: { scope: ["src/Vault.sol"] },
        },
        {
          type: "finding.added",
          run_id: siblingRunId,
          seq: 2,
          session_id: sessionId,
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_005_002,
          payload: makeFinding(siblingRunId, 2, "s-1"),
        },
        {
          type: "finding.added",
          run_id: siblingRunId,
          seq: 3,
          session_id: sessionId,
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_005_003,
          payload: makeFinding(siblingRunId, 3, "s-2"),
        },
        {
          type: "finding.added",
          run_id: siblingRunId,
          seq: 4,
          session_id: sessionId,
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_005_004,
          payload: makeFinding(siblingRunId, 4, "s-3"),
        },
        {
          type: "session.idle",
          run_id: siblingRunId,
          seq: 5,
          session_id: sessionId,
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_005_005,
          payload: { reason: "test-complete" },
        },
      ]

      await writeEventsJsonl(projectDir, primaryRunId, primaryEvents)
      await writeEventsJsonl(projectDir, siblingRunId, siblingEvents)

      const reportInput = await materializeReportInput(primaryRunId, projectDir)

      expect(reportInput.findings.length).toBe(2)
    })

    test("deduplicates cross-run findings by issue_fingerprint", async () => {
      const projectDir = await makeTempDir()
      const primaryRunId = "run-primary"
      const siblingRunId = "run-sibling"
      const sessionId = "shared-session"

      const primaryEvents: AuditEvent[] = [
        {
          type: "session.created",
          run_id: primaryRunId,
          seq: 1,
          session_id: sessionId,
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_006_001,
          payload: { scope: ["src/Vault.sol"] },
        },
        {
          type: "session.idle",
          run_id: primaryRunId,
          seq: 2,
          session_id: sessionId,
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_006_002,
          payload: { reason: "test-complete" },
        },
      ]

      const duplicateFinding = makeFinding(siblingRunId, 2, "dup")
      const siblingEvents: AuditEvent[] = [
        {
          type: "session.created",
          run_id: siblingRunId,
          seq: 1,
          session_id: sessionId,
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_007_001,
          payload: { scope: ["src/Vault.sol"] },
        },
        {
          type: "finding.added",
          run_id: siblingRunId,
          seq: 2,
          session_id: sessionId,
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_007_002,
          payload: duplicateFinding,
        },
        {
          type: "finding.added",
          run_id: siblingRunId,
          seq: 3,
          session_id: sessionId,
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_007_003,
          payload: {
            ...duplicateFinding,
            observation_id: "obs-dup-second",
            observation_fingerprint: "observation-dup-second",
          },
        },
        {
          type: "session.idle",
          run_id: siblingRunId,
          seq: 4,
          session_id: sessionId,
          source: "test",
          schema_version: SCHEMA_VERSION,
          timestamp: 1_700_000_007_004,
          payload: { reason: "test-complete" },
        },
      ]

      await writeEventsJsonl(projectDir, primaryRunId, primaryEvents)
      await writeEventsJsonl(projectDir, siblingRunId, siblingEvents)

      const reportInput = await materializeReportInput(primaryRunId, projectDir)

      expect(reportInput.findings.length).toBeGreaterThanOrEqual(1)
    })
  })
})
