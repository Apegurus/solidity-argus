import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AuditState, Finding } from "../../state/types"
import { createAuditStateManager } from "./audit-state-manager"

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
})
