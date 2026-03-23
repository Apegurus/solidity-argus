import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createAuditArtifactResolver } from "../../shared/audit-artifact-resolver"
import { resetLoggerSink } from "../../shared/logger"
import type { AuditEvent } from "../../state/schemas"
import { SCHEMA_VERSION } from "../../state/schemas"
import type { AuditState, Finding } from "../../state/types"
import { createAsyncMutex, createAuditStateManager, migrateLegacyFindingIds } from "./audit-state-manager"
import { normalizeText } from "../../state/finding-fingerprint"

const WRITE_DIR = ".argus"
const LEGACY_DIR = ".opencode"
const STATE_FILE = "argus-state.json"

describe("createAuditStateManager", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "argus-state-manager-"))
    tempDirs.push(dir)
    return dir
  }

  function buildPersistentState(
    projectDir: string,
    version: "1" | "2",
    statePatch: Partial<AuditState> = {},
    stateDir = WRITE_DIR,
  ): Record<string, unknown> {
    const baseState: AuditState = {
      sessionId: "session-1",
      projectDir,
      contractsReviewed: [],
      findings: [],
      toolsExecuted: [],
      currentPhase: "reconnaissance",
      scope: [],
      startTime: 1,
      ...statePatch,
    }

    return {
      ...baseState,
      savedAt: 123,
      version,
      filePath: join(projectDir, stateDir, STATE_FILE),
    }
  }

  function buildEvent(
    runId: string,
    sessionId: string,
    type: AuditEvent["type"],
    seq: number,
    payload: Record<string, unknown>,
    toolCallId?: string,
  ): AuditEvent {
    return {
      type,
      run_id: runId,
      seq,
      session_id: sessionId,
      source: "test",
      schema_version: SCHEMA_VERSION,
      timestamp: 1_700_000_000_000 + seq,
      payload,
      tool_call_id: toolCallId,
    }
  }

  function writeRunEvents(projectDir: string, runId: string, events: AuditEvent[]): void {
    const eventsPath = createAuditArtifactResolver(runId, projectDir).paths().journalFile
    mkdirSync(dirname(eventsPath), { recursive: true })
    writeFileSync(eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`)
  }

  test("Finding supports source 'solodit'", () => {
    const finding: Finding = {
      id: "f-1",
      check: "historical-reentrancy",
      severity: "High",
      confidence: "Medium",
      description: "Similar issue found in Solodit reports",
      file: "Vault.sol",
      lines: [10, 12],
      source: "solodit",
    }

    expect(finding.source).toBe("solodit")
  })

  test("Finding supports source 'fuzz'", () => {
    const finding: Finding = {
      id: "f-2",
      check: "invariant-break",
      severity: "Medium",
      confidence: "Low",
      description: "Invariant breaks under fuzzed input",
      file: "Vault.sol",
      lines: [42, 44],
      source: "fuzz",
    }

    expect(finding.source).toBe("fuzz")
  })

  test("Finding supports optional provenance", () => {
    const finding: Finding = {
      id: "f-3",
      check: "unchecked-transfer",
      severity: "Low",
      confidence: "High",
      description: "Unchecked transfer return value",
      file: "Token.sol",
      lines: [4, 7],
      source: "pattern",
      provenance: {
        timestamp: 100,
        toolVersion: "1.0.0",
        phase: "testing",
      },
    }

    expect(finding.provenance?.phase).toBe("testing")
  })

  test("AuditState supports soloditResults", () => {
    const state: AuditState = {
      sessionId: "session-2",
      projectDir: "/tmp/project",
      contractsReviewed: [],
      findings: [],
      toolsExecuted: [],
      currentPhase: "research",
      scope: [],
      startTime: 1,
      soloditResults: [
        {
          query: "reentrancy",
          timestamp: 10,
          resultCount: 1,
          topResults: [
            {
              title: "Reentrancy in Vault",
              severity: "High",
              url: "https://example.com/report",
              protocol: "Vault",
            },
          ],
        },
      ],
    }

    expect(state.soloditResults?.[0]?.query).toBe("reentrancy")
  })

  test("AuditState supports fuzzCounterexamples", () => {
    const state: AuditState = {
      sessionId: "session-3",
      projectDir: "/tmp/project",
      contractsReviewed: [],
      findings: [],
      toolsExecuted: [],
      currentPhase: "testing",
      scope: [],
      startTime: 1,
      fuzzCounterexamples: [
        {
          testName: "testFuzz_withdraw",
          inputs: ["1", "2"],
          runs: 256,
          seed: 42,
          timestamp: 10,
        },
      ],
    }

    expect(state.fuzzCounterexamples?.[0]?.testName).toBe("testFuzz_withdraw")
  })

  test("state file path uses .argus root", async () => {
    const projectDir = makeTempDir()
    const manager = createAuditStateManager(projectDir)
    const state = manager.get()
    expect(state).not.toBeNull()
    if (!state) return
    await manager.save(state)

    const argusStatePath = join(projectDir, WRITE_DIR, STATE_FILE)
    expect(existsSync(argusStatePath)).toBe(true)

    const legacyStatePath = join(projectDir, LEGACY_DIR, STATE_FILE)
    expect(existsSync(legacyStatePath)).toBe(false)
  })

  test("save writes source_of_truth provenance field", async () => {
    const projectDir = makeTempDir()
    const manager = createAuditStateManager(projectDir)
    const state = manager.get()
    expect(state).not.toBeNull()
    if (!state) return
    await manager.save(state)

    const statePath = join(projectDir, WRITE_DIR, STATE_FILE)
    const raw = readFileSync(statePath, "utf8")
    const parsed = JSON.parse(raw) as Record<string, unknown>

    expect(parsed.source_of_truth).toBe("events")
  })

  test("save stamps event stream sequence and hash metadata", async () => {
    const projectDir = makeTempDir()
    const manager = createAuditStateManager(projectDir)
    const state = manager.get()
    expect(state).not.toBeNull()
    if (!state) return

    writeRunEvents(projectDir, state.sessionId, [
      buildEvent(state.sessionId, "oc-state-stamp", "session.created", 1, {
        scope: ["src/Vault.sol"],
      }),
      buildEvent(state.sessionId, "oc-state-stamp", "session.idle", 2, {
        findingsCount: 0,
        toolsExecutedCount: 0,
      }),
    ])

    await manager.save(state)

    const statePath = join(projectDir, WRITE_DIR, STATE_FILE)
    const raw = readFileSync(statePath, "utf8")
    const parsed = JSON.parse(raw) as Record<string, unknown>

    expect(parsed.last_event_seq).toBe(2)
    expect(typeof parsed.event_stream_hash).toBe("string")
    expect((parsed.event_stream_hash as string).length).toBeGreaterThan(0)
  })

  test("load auto-repairs canonical state fields from event stream while preserving optional fields", async () => {
    const projectDir = makeTempDir()
    const runId = "run-repair-load"
    const opencodeSessionId = "oc-repair"
    const stateDir = join(projectDir, WRITE_DIR)
    const statePath = join(stateDir, STATE_FILE)

    mkdirSync(stateDir, { recursive: true })
    writeFileSync(
      statePath,
      `${JSON.stringify(
        buildPersistentState(projectDir, "2", {
          sessionId: runId,
          findings: [],
          contractsReviewed: [],
          toolsExecuted: [],
          currentPhase: "reconnaissance",
          patternVersion: "patterns-v4",
        }),
      )}\n`,
    )

    writeRunEvents(projectDir, runId, [
      buildEvent(runId, opencodeSessionId, "session.created", 1, { scope: ["src/Vault.sol"] }),
      buildEvent(
        runId,
        opencodeSessionId,
        "tool.started",
        2,
        { tool: "argus_slither_analyze" },
        "tc-1",
      ),
      buildEvent(
        runId,
        opencodeSessionId,
        "finding.added",
        3,
        {
          id: "f-repair",
          check: "reentrancy-eth",
          severity: "High",
          confidence: "High",
          description: "Reentrancy risk",
          file: "src/Vault.sol",
          lines: [10, 20],
          source: "slither",
          run_id: runId,
          seq: 3,
          schema_version: SCHEMA_VERSION,
          observation_id: "obs-f-repair",
          issue_fingerprint: "issue-f-repair",
          observation_fingerprint: "observation-f-repair",
          reported_by_agent: "argus",
        },
        "tc-1",
      ),
      buildEvent(
        runId,
        opencodeSessionId,
        "tool.completed",
        4,
        { tool: "argus_slither_analyze", success: true, findingsCount: 1 },
        "tc-1",
      ),
      buildEvent(runId, opencodeSessionId, "phase.changed", 5, { phase: "scanning" }),
    ])

    const manager = createAuditStateManager(projectDir)
    const loaded = await manager.load()

    expect(loaded).not.toBeNull()
    expect(loaded?.sessionId).toBe(runId)
    expect(loaded?.findings.length).toBe(1)
    expect(loaded?.findings[0]?.id).toBe("f-repair")
    expect(loaded?.currentPhase).toBe("scanning")
    expect(loaded?.patternVersion).toBe("patterns-v4")
    expect(loaded?.toolsExecuted.length).toBe(1)
  })

  test("save auto-repairs findings and tools from events before persisting", async () => {
    const projectDir = makeTempDir()
    const manager = createAuditStateManager(projectDir)
    const state = manager.get()
    expect(state).not.toBeNull()
    if (!state) return

    writeRunEvents(projectDir, state.sessionId, [
      buildEvent(state.sessionId, "oc-save-repair", "session.created", 1, {
        scope: ["src/Vault.sol"],
      }),
      buildEvent(
        state.sessionId,
        "oc-save-repair",
        "tool.started",
        2,
        { tool: "argus_slither_analyze" },
        "tc-1",
      ),
      buildEvent(
        state.sessionId,
        "oc-save-repair",
        "finding.added",
        3,
        {
          id: "f-save-repair",
          check: "unchecked-call",
          severity: "Medium",
          confidence: "Medium",
          description: "Unchecked call result",
          file: "src/Vault.sol",
          lines: [22, 25],
          source: "pattern",
          run_id: state.sessionId,
          seq: 3,
          schema_version: SCHEMA_VERSION,
          observation_id: "obs-f-save-repair",
          issue_fingerprint: "issue-f-save-repair",
          observation_fingerprint: "observation-f-save-repair",
          reported_by_agent: "argus",
        },
        "tc-1",
      ),
      buildEvent(
        state.sessionId,
        "oc-save-repair",
        "tool.completed",
        4,
        { tool: "argus_slither_analyze", success: true, findingsCount: 1 },
        "tc-1",
      ),
      buildEvent(state.sessionId, "oc-save-repair", "phase.changed", 5, { phase: "scanning" }),
    ])

    await manager.save({
      ...state,
      findings: [],
      toolsExecuted: [],
      currentPhase: "reconnaissance",
      contractsReviewed: [],
      scope: [],
    })

    const statePath = join(projectDir, WRITE_DIR, STATE_FILE)
    const raw = readFileSync(statePath, "utf8")
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const persistedFindings = parsed.findings as Array<Record<string, unknown>>
    const persistedTools = parsed.toolsExecuted as Array<Record<string, unknown>>

    expect(persistedFindings.length).toBe(1)
    expect(persistedFindings[0]?.id).toBe("f-save-repair")
    expect(persistedTools.length).toBe(1)
    expect(parsed.currentPhase).toBe("scanning")
    expect(parsed.last_event_seq).toBe(5)
  })

  test("loads state from legacy .opencode fallback", async () => {
    const projectDir = makeTempDir()
    const legacyDir = join(projectDir, LEGACY_DIR)
    const legacyPath = join(legacyDir, STATE_FILE)

    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(
      legacyPath,
      `${JSON.stringify(buildPersistentState(projectDir, "2", { currentPhase: "testing" }, LEGACY_DIR))}\n`,
    )

    const manager = createAuditStateManager(projectDir)
    const loaded = await manager.load()

    expect(loaded).not.toBeNull()
    expect(loaded?.currentPhase).toBe("testing")
  })

  test("saves and loads state round-trip", async () => {
    const projectDir = makeTempDir()
    const manager = createAuditStateManager(projectDir)

    await manager.update({
      currentPhase: "testing",
      contractsReviewed: ["Vault.sol"],
      scope: ["Vault.sol"],
    })

    const updatedState = manager.get()
    expect(updatedState).not.toBeNull()
    if (!updatedState) return

    await manager.save(updatedState)

    const loadedManager = createAuditStateManager(projectDir)
    const loaded = await loadedManager.load()

    expect(loaded).not.toBeNull()
    expect(loaded?.projectDir).toBe(projectDir)
    expect(loaded?.currentPhase).toBe("testing")
    expect(loaded?.contractsReviewed).toEqual(["Vault.sol"])
    expect(loaded?.scope).toEqual(["Vault.sol"])
  })

  test("uses atomic writes and leaves no tmp file", async () => {
    const projectDir = makeTempDir()
    const manager = createAuditStateManager(projectDir)

    const state = manager.get()
    expect(state).not.toBeNull()
    if (!state) return

    await manager.save(state)

    const statePath = join(projectDir, WRITE_DIR, STATE_FILE)
    const tmpPath = `${statePath}.tmp`

    expect(existsSync(statePath)).toBe(true)
    expect(existsSync(tmpPath)).toBe(false)
  })

  test("returns null when loading missing state file", async () => {
    const projectDir = makeTempDir()
    const manager = createAuditStateManager(projectDir)

    const loaded = await manager.load()
    expect(loaded).toBeNull()
  })

  test("returns null when loading invalid state file", async () => {
    const projectDir = makeTempDir()
    const stateDir = join(projectDir, WRITE_DIR)
    const statePath = join(stateDir, STATE_FILE)

    mkdirSync(stateDir, { recursive: true })
    writeFileSync(statePath, "not-json")

    const manager = createAuditStateManager(projectDir)
    const loaded = await manager.load()

    expect(loaded).toBeNull()
  })

  test("update merges partial state changes", async () => {
    const projectDir = makeTempDir()
    const manager = createAuditStateManager(projectDir)
    const before = manager.get()

    expect(before).not.toBeNull()

    await manager.update({ currentPhase: "research" })

    const after = manager.get()
    expect(after).not.toBeNull()
    expect(after?.currentPhase).toBe("research")
    expect(after?.sessionId).toBe(before?.sessionId)
    expect(after?.projectDir).toBe(projectDir)
  })

  test("reset creates a fresh audit state", async () => {
    const projectDir = makeTempDir()
    const manager = createAuditStateManager(projectDir)

    await manager.update({
      currentPhase: "reporting",
      contractsReviewed: ["Token.sol"],
    })

    const beforeReset = manager.get()
    expect(beforeReset).not.toBeNull()

    await manager.reset()
    const afterReset = manager.get()

    expect(afterReset).not.toBeNull()
    expect(afterReset?.currentPhase).toBe("reconnaissance")
    expect(afterReset?.contractsReviewed).toEqual([])
    expect(afterReset?.sessionId).not.toBe(beforeReset?.sessionId)
  })

  test("save writes persistent metadata fields", async () => {
    const projectDir = makeTempDir()
    const manager = createAuditStateManager(projectDir)
    const state = manager.get()

    expect(state).not.toBeNull()
    if (!state) return

    await manager.save(state)

    const statePath = join(projectDir, WRITE_DIR, STATE_FILE)
    const raw = readFileSync(statePath, "utf8")
    const parsed = JSON.parse(raw) as Record<string, unknown>

    expect(typeof parsed.savedAt).toBe("number")
    expect(parsed.version).toBe("2")
    expect(parsed.filePath).toBe(statePath)
  })

  test("v1 state migrates by adding empty arrays for new fields", async () => {
    const projectDir = makeTempDir()
    const stateDir = join(projectDir, WRITE_DIR)
    const statePath = join(stateDir, STATE_FILE)

    mkdirSync(stateDir, { recursive: true })
    writeFileSync(statePath, `${JSON.stringify(buildPersistentState(projectDir, "1"))}\n`)

    const manager = createAuditStateManager(projectDir)
    const loaded = await manager.load()

    expect(loaded).not.toBeNull()
    expect(loaded?.soloditResults).toEqual([])
    expect(loaded?.fuzzCounterexamples).toEqual([])
  })

  test("v2 state loads and preserves new fields", async () => {
    const projectDir = makeTempDir()
    const stateDir = join(projectDir, WRITE_DIR)
    const statePath = join(stateDir, STATE_FILE)

    mkdirSync(stateDir, { recursive: true })
    writeFileSync(
      statePath,
      `${JSON.stringify(
        buildPersistentState(projectDir, "2", {
          soloditResults: [
            {
              query: "flash-loan",
              timestamp: 11,
              resultCount: 1,
              topResults: [
                {
                  title: "Flash loan exploit",
                  severity: "Critical",
                  url: "https://example.com/flash",
                  protocol: "Lending",
                },
              ],
            },
          ],
          fuzzCounterexamples: [
            {
              testName: "testFuzz_liquidate",
              inputs: ["1000", "0"],
              runs: 512,
              timestamp: 12,
            },
          ],
          patternVersion: "patterns-v4",
        }),
      )}\n`,
    )

    const manager = createAuditStateManager(projectDir)
    const loaded = await manager.load()

    expect(loaded).not.toBeNull()
    expect(loaded?.soloditResults?.[0]?.query).toBe("flash-loan")
    expect(loaded?.fuzzCounterexamples?.[0]?.testName).toBe("testFuzz_liquidate")
    expect(loaded?.patternVersion).toBe("patterns-v4")
  })

  test("isPersistentAuditState path accepts v1 state", async () => {
    const projectDir = makeTempDir()
    const stateDir = join(projectDir, WRITE_DIR)
    const statePath = join(stateDir, STATE_FILE)

    mkdirSync(stateDir, { recursive: true })
    writeFileSync(statePath, `${JSON.stringify(buildPersistentState(projectDir, "1"))}\n`)

    const manager = createAuditStateManager(projectDir)
    const loaded = await manager.load()

    expect(loaded).not.toBeNull()
  })

  test("isPersistentAuditState path accepts v2 state", async () => {
    const projectDir = makeTempDir()
    const stateDir = join(projectDir, WRITE_DIR)
    const statePath = join(stateDir, STATE_FILE)

    mkdirSync(stateDir, { recursive: true })
    writeFileSync(statePath, `${JSON.stringify(buildPersistentState(projectDir, "2"))}\n`)

    const manager = createAuditStateManager(projectDir)
    const loaded = await manager.load()

    expect(loaded).not.toBeNull()
  })

  test("load migrates legacy obs-N finding IDs to deterministic IDs", async () => {
    const projectDir = makeTempDir()
    const stateDir = join(projectDir, WRITE_DIR)
    const statePath = join(stateDir, STATE_FILE)

    const previousLogMode = process.env.ARGUS_LOG
    const stderrLines: string[] = []
    process.env.ARGUS_LOG = "stderr"
    resetLoggerSink()

    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(
      (chunk: string | Uint8Array) => {
        stderrLines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"))
        return true
      },
    )

    try {
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(
        statePath,
        `${JSON.stringify(
          buildPersistentState(projectDir, "2", {
            findings: [
              {
                id: "obs-42",
                check: "reentrancy-eth",
                severity: "High",
                confidence: "High",
                description: "Legacy finding",
                file: "Vault.sol",
                lines: [10, 15] as [number, number],
                source: "manual",
              },
            ],
          }),
        )}\n`,
      )

      const manager = createAuditStateManager(projectDir)
      const loaded = await manager.load()

      const expectedId = createHash("sha256")
        .update("reentrancy-eth:vault.sol:10-15")
        .digest("hex")
        .substring(0, 16)

      expect(loaded?.findings[0]?.id).toBe(expectedId)
      expect(stderrLines.join("")).toContain("Migrating 1 finding IDs to deterministic format")
    } finally {
      stderrSpy.mockRestore()
      process.env.ARGUS_LOG = previousLogMode
      resetLoggerSink()
    }
  })

  test("bindSession scopes save/load to session-specific file", async () => {
    const projectDir = makeTempDir()
    const manager = createAuditStateManager(projectDir)

    manager.bindSession("ses_abc123")

    const state: AuditState = {
      sessionId: "run-1",
      projectDir,
      contractsReviewed: [],
      findings: [
        {
          id: "f-1",
          check: "test-check",
          severity: "High",
          confidence: "High",
          description: "test finding",
          file: "Test.sol",
          lines: [1, 10] as [number, number],
          source: "manual",
        },
      ],
      toolsExecuted: [],
      currentPhase: "reconnaissance",
      scope: [],
      startTime: Date.now(),
    }

    await manager.save(state)

    // Verify session-scoped file was written
    const sessionFilePath = join(projectDir, WRITE_DIR, "sessions", "state-ses_abc123.json")
    expect(existsSync(sessionFilePath)).toBe(true)

    // Verify shared file was NOT written
    const sharedFilePath = join(projectDir, WRITE_DIR, STATE_FILE)
    expect(existsSync(sharedFilePath)).toBe(false)

    // Load should read from session-scoped file
    const loaded = await manager.load()
    expect(loaded).not.toBeNull()
    expect(loaded?.findings).toHaveLength(1)
    expect(loaded?.findings[0]?.id).toBe("f-1")
  })

  test("archive removes the live session state file and writes a canonical archive", async () => {
    const projectDir = makeTempDir()
    const manager = createAuditStateManager(projectDir)

    manager.bindSession("ses_abc123")

    const state: AuditState = {
      sessionId: "ses_abc123",
      projectDir,
      contractsReviewed: ["Vault.sol"],
      findings: [
        {
          id: "f-archive",
          check: "reentrancy-check",
          severity: "High",
          confidence: "High",
          description: "test finding",
          file: "Vault.sol",
          lines: [10, 20] as [number, number],
          source: "manual",
        },
      ],
      toolsExecuted: [
        {
          tool: "argus_slither_analyze",
          startTime: Date.now(),
          success: true,
          findingsCount: 1,
        },
      ],
      currentPhase: "reporting",
      scope: ["Vault.sol"],
      startTime: Date.now(),
    }

    await manager.save(state)

    const sessionFilePath = join(projectDir, WRITE_DIR, "sessions", "state-ses_abc123.json")
    expect(existsSync(sessionFilePath)).toBe(true)

    await manager.archive()

    expect(existsSync(sessionFilePath)).toBe(false)

    const archivesDir = join(projectDir, WRITE_DIR, "archives")
    const archiveFiles = readdirSync(archivesDir).filter(
      (entry) => entry.startsWith("argus-state.") && entry.endsWith(".json"),
    )
    expect(archiveFiles).toHaveLength(1)

    const firstArchive = archiveFiles[0] ?? ""
    const archivePath = join(archivesDir, firstArchive)
    const archivedState = JSON.parse(readFileSync(archivePath, "utf8")) as AuditState & {
      filePath: string
    }
    expect(archivedState.filePath).toBe(archivePath)
    expect(archivedState.findings).toHaveLength(1)
    expect(archivedState.findings[0]?.id).toBe("f-archive")
  })

  test("new bound session returns null instead of inheriting state from different session", async () => {
    const projectDir = makeTempDir()

    // Write a session file for a different session with findings
    const sessionsDir = join(projectDir, WRITE_DIR, "sessions")
    mkdirSync(sessionsDir, { recursive: true })
    const otherState = buildPersistentState(projectDir, "2", {
      sessionId: "other-run",
      currentPhase: "scanning",
      findings: [
        {
          id: "f-other",
          check: "reentrancy-eth",
          severity: "High" as const,
          confidence: "High" as const,
          description: "Finding from other session",
          file: "Vault.sol",
          lines: [10, 20] as [number, number],
          source: "slither" as const,
        },
      ],
    })
    otherState.filePath = join(sessionsDir, "state-ses_other.json")
    writeFileSync(join(sessionsDir, "state-ses_other.json"), `${JSON.stringify(otherState)}\n`)

    const manager = createAuditStateManager(projectDir)
    manager.bindSession("ses_new_session")

    // New session must NOT inherit state from other session — returns null (clean start)
    const loaded = await manager.load()
    expect(loaded).toBeNull()
  })

  test("new bound session returns null when only legacy shared file exists", async () => {
    const projectDir = makeTempDir()
    const stateDir = join(projectDir, WRITE_DIR)
    mkdirSync(stateDir, { recursive: true })

    const legacyState = buildPersistentState(projectDir, "2", {
      sessionId: "legacy-run",
      currentPhase: "manual-review",
    })
    writeFileSync(join(stateDir, STATE_FILE), `${JSON.stringify(legacyState)}\n`)

    const manager = createAuditStateManager(projectDir)
    manager.bindSession("ses_brand_new")

    // Bound session with no matching file returns null — no cross-session contamination
    const loaded = await manager.load()
    expect(loaded).toBeNull()
  })

  test("two managers bound to different sessions don't contaminate each other", async () => {
    const projectDir = makeTempDir()

    const managerA = createAuditStateManager(projectDir)
    managerA.bindSession("ses_A")

    const managerB = createAuditStateManager(projectDir)
    managerB.bindSession("ses_B")

    const stateA: AuditState = {
      sessionId: "run-A",
      projectDir,
      contractsReviewed: ["ContractA.sol"],
      findings: [],
      toolsExecuted: [{ tool: "slither", startTime: Date.now(), success: true, findingsCount: 0 }],
      currentPhase: "scanning",
      scope: [],
      startTime: Date.now(),
    }

    const stateB: AuditState = {
      sessionId: "run-B",
      projectDir,
      contractsReviewed: ["ContractB.sol"],
      findings: [],
      toolsExecuted: [{ tool: "forge", startTime: Date.now(), success: true, findingsCount: 0 }],
      currentPhase: "manual-review",
      scope: [],
      startTime: Date.now(),
    }

    await managerA.save(stateA)
    await managerB.save(stateB)

    // Each manager loads its own state
    const loadedA = await managerA.load()
    const loadedB = await managerB.load()

    expect(loadedA?.contractsReviewed).toEqual(["ContractA.sol"])
    expect(loadedA?.currentPhase).toBe("scanning")
    expect(loadedB?.contractsReviewed).toEqual(["ContractB.sol"])
    expect(loadedB?.currentPhase).toBe("manual-review")
  })

  test("two concurrent save calls persist latest state without losing updates", async () => {
    const projectDir = makeTempDir()
    const manager = createAuditStateManager(projectDir)
    const state = manager.get()
    expect(state).not.toBeNull()
    if (!state) return

    let firstWriteBlocked = true
    let releaseFirstWrite!: () => void
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    const originalWrite = Bun.write

    const writeSpy = spyOn(Bun, "write").mockImplementation(async (_path, data) => {
      if (firstWriteBlocked) {
        firstWriteBlocked = false
        await firstWriteGate
      }
      return (originalWrite as (...args: unknown[]) => Promise<number>)(_path, data)
    })

    try {
      const firstState: AuditState = {
        ...state,
        currentPhase: "scanning",
      }

      const secondState: AuditState = {
        ...firstState,
        currentPhase: "manual-review",
        scope: ["src/Vault.sol"],
      }

      const firstSave = manager.save(firstState)
      await Promise.resolve()
      const secondSave = manager.save(secondState)

      releaseFirstWrite()
      await Promise.all([firstSave, secondSave])

      const statePath = join(projectDir, WRITE_DIR, STATE_FILE)
      const persisted = JSON.parse(readFileSync(statePath, "utf8")) as AuditState

      expect(persisted.currentPhase).toBe("manual-review")
      expect(persisted.scope).toEqual(["src/Vault.sol"])
    } finally {
      writeSpy.mockRestore()
    }
  })

  test("mutex serializes concurrent saves — no CAS race possible", async () => {
    // With currentState assigned inside the mutex, concurrent save() calls are
    // fully serialized. Each save sees a stable currentState throughout its CAS
    // loop and completes in exactly 1 write. The old "CAS retries exhausted"
    // scenario cannot happen anymore.
    const projectDir = makeTempDir()
    const manager = createAuditStateManager(projectDir)
    const state = manager.get()
    expect(state).not.toBeNull()
    if (!state) return

    let writeCount = 0
    const originalWrite = Bun.write
    const writeSpy = spyOn(Bun, "write").mockImplementation(async (_path, data) => {
      writeCount += 1
      // Enqueue a concurrent save while the first is in progress.
      // Because the mutex serializes them, the first save is already holding
      // the lock and will see a stable currentState — it returns after 1 write.
      if (writeCount === 1) {
        const latest = manager.get()
        if (latest) {
          void manager.save({
            ...latest,
            startTime: latest.startTime + 1,
          })
        }
      }
      return (originalWrite as (...args: unknown[]) => Promise<number>)(_path, data)
    })

    try {
      await manager.save(state)
      // First save completed in exactly 1 write (no CAS retries needed).
      expect(writeCount).toBe(1)
    } finally {
      writeSpy.mockRestore()
    }
  })

  test("mutex timeout only logs a warning — does NOT release the lock", async () => {
    // The timeout callback must NOT call releaseCurrent(). It only logs a
    // warning. The lock is only released when the holder explicitly calls
    // the release function returned by acquire().
    const previousLogMode = process.env.ARGUS_LOG
    const stderrLines: string[] = []
    process.env.ARGUS_LOG = "stderr"
    resetLoggerSink()

    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(
      (chunk: string | Uint8Array) => {
        stderrLines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"))
        return true
      },
    )

    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const delays: number[] = []
    const callbacks: Array<() => void> = []

    globalThis.setTimeout = ((handler: unknown, delay?: number) => {
      delays.push(typeof delay === "number" ? delay : 0)
      if (typeof handler === "function") {
        callbacks.push(handler as () => void)
      }
      return 1 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout

    globalThis.clearTimeout = (() => {
      return undefined
    }) as typeof clearTimeout

    try {
      const mutex = createAsyncMutex()
      const releaseFirst = await mutex.acquire()
      const secondAcquire = mutex.acquire()

      expect(delays[0]).toBe(30_000)

      // Fire the timeout callback — it should only log, not release.
      callbacks[0]?.()

      // The timeout message must appear in the log.
      expect(stderrLines.join("")).toContain("possible deadlock")

      // secondAcquire is still blocked — the lock was NOT released by the
      // timeout. Releasing it now must unblock the waiter.
      releaseFirst()

      const releaseSecond = await secondAcquire
      releaseSecond()
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
      stderrSpy.mockRestore()
      process.env.ARGUS_LOG = previousLogMode
      resetLoggerSink()
    }
  })

  test("startup cleanup removes stale tmp state files", async () => {
    const projectDir = makeTempDir()
    const stateDir = join(projectDir, WRITE_DIR)
    mkdirSync(stateDir, { recursive: true })

    const staleTmpA = join(stateDir, "argus-state.json.111.tmp")
    const staleTmpB = join(stateDir, "state-ses_abc123.json.222.tmp")
    writeFileSync(staleTmpA, "stale")
    writeFileSync(staleTmpB, "stale")

    createAuditStateManager(projectDir)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(existsSync(staleTmpA)).toBe(false)
    expect(existsSync(staleTmpB)).toBe(false)
  })

  test("migrated finding IDs match finding-store IDs for same input", () => {
    const check = " Reentrancy-Eth "
    const file = " Src/Vault.sol "
    const lines: [number, number] = [10, 20]

    const normalizedHash = createHash("sha256")
      .update(`${normalizeText(check)}:${normalizeText(file)}:${lines[0]}-${lines[1]}`)
      .digest("hex")
      .substring(0, 16)

    const state: AuditState = {
      sessionId: "test-session",
      projectDir: "/tmp",
      contractsReviewed: [],
      findings: [
        {
          id: "obs-1",
          check,
          file,
          lines,
          severity: "High",
          confidence: "High",
          description: "test",
          source: "slither",
        },
      ],
      toolsExecuted: [],
      currentPhase: "reconnaissance",
      scope: [],
      startTime: 1,
    }

    const migratedCount = migrateLegacyFindingIds(state)
    expect(migratedCount).toBe(1)
    expect(state.findings[0]?.id).toBe(normalizedHash)
  })
})
