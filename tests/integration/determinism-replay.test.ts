import { describe, expect, test } from "bun:test"
import {
  ProjectorError,
  projectAuditState,
  projectFindings,
  projectReportInput,
  stableHash,
} from "../../src/state/projectors"
import type { AuditEvent, CanonicalFinding } from "../../src/state/schemas"

const RUN_ID = "run-determinism"
const SESSION_ID = "session-determinism"
const PROJECT_DIR = "/tmp/determinism-project"

function makeFinding(overrides: Partial<CanonicalFinding>): CanonicalFinding {
  return {
    id: overrides.id ?? "finding-default",
    check: overrides.check ?? "default-check",
    severity: overrides.severity ?? "Informational",
    confidence: overrides.confidence ?? "Low",
    description: overrides.description ?? "desc",
    file: overrides.file ?? "src/Default.sol",
    lines: overrides.lines ?? [1, 1],
    source: overrides.source ?? "manual",
    run_id: overrides.run_id ?? RUN_ID,
    seq: overrides.seq ?? 1,
    schema_version: overrides.schema_version ?? "1.0.0",
    remediation: overrides.remediation,
    exploitReference: overrides.exploitReference,
    provenance: overrides.provenance,
  }
}

function fixtureEvents(): AuditEvent[] {
  const base = {
    run_id: RUN_ID,
    session_id: SESSION_ID,
    schema_version: "1.0.0",
    source: "argus",
  }

  return [
    {
      ...base,
      type: "session.created",
      seq: 1,
      timestamp: 1_700_000_000_001,
      payload: { scope: ["src/Vault.sol", "src/Token.sol"] },
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
      payload: { tool: "argus_slither_analyze", success: true, findingsCount: 2 },
    },
    {
      ...base,
      type: "finding.added",
      seq: 4,
      timestamp: 1_700_000_000_004,
      payload: makeFinding({
        id: "f-1",
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
      type: "finding.added",
      seq: 5,
      timestamp: 1_700_000_000_005,
      payload: makeFinding({
        id: "f-2",
        check: "unchecked-call",
        severity: "Medium",
        confidence: "Medium",
        file: "src/Token.sol",
        lines: [18, 23],
        source: "pattern",
        seq: 5,
      }),
    },
    {
      ...base,
      type: "tool.started",
      seq: 6,
      timestamp: 1_700_000_000_006,
      tool_call_id: "tc-2",
      payload: { tool: "argus_check_patterns" },
    },
    {
      ...base,
      type: "tool.completed",
      seq: 7,
      timestamp: 1_700_000_000_007,
      tool_call_id: "tc-2",
      payload: { tool: "argus_check_patterns", success: true, findingsCount: 1 },
    },
    {
      ...base,
      type: "finding.added",
      seq: 8,
      timestamp: 1_700_000_000_008,
      payload: makeFinding({
        id: "f-3",
        check: "natspec-missing",
        severity: "Low",
        confidence: "Low",
        file: "src/Vault.sol",
        lines: [12, 12],
        source: "manual",
        seq: 8,
      }),
    },
    {
      ...base,
      type: "phase.changed",
      seq: 9,
      timestamp: 1_700_000_000_009,
      payload: { phase: "scanning" },
    },
    {
      ...base,
      type: "run.finalized",
      seq: 10,
      timestamp: 1_700_000_000_010,
      tool_call_id: "tc-final",
      payload: {
        soloditResults: [
          {
            query: "reentrancy",
            timestamp: 1_700_000_000_010,
            resultCount: 1,
            topResults: [
              {
                title: "reentrancy case",
                severity: "High",
                url: "https://solodit.xyz/example",
                protocol: "Vault",
              },
            ],
          },
        ],
        fuzzCounterexamples: [
          {
            testName: "testFuzzWithdraw",
            inputs: ["100"],
            runs: 256,
            timestamp: 1_700_000_000_010,
            revertReason: "Insufficient balance",
          },
        ],
        coverageReport: {
          files: [
            {
              path: "src/Vault.sol",
              linesPct: 91,
              statementsPct: 89,
              branchesPct: 82,
              functionsPct: 94,
            },
          ],
        },
        gasHotspots: [{ contract: "Vault", function: "withdraw", avgGas: 130000 }],
        proxyContracts: [
          { file: "src/VaultProxy.sol", proxyType: "uups", indicators: ["erc1967"] },
        ],
      },
    },
  ]
}

describe("deterministic replay projectors", () => {
  test("projectors are byte-identical across 10 replays", () => {
    const events = fixtureEvents()

    const findingHashes = new Set<string>()
    const stateHashes = new Set<string>()
    const reportHashes = new Set<string>()

    for (let i = 0; i < 10; i++) {
      findingHashes.add(stableHash(projectFindings(events)))
      stateHashes.add(stableHash(projectAuditState(events, PROJECT_DIR)))
      reportHashes.add(stableHash(projectReportInput(events, RUN_ID, PROJECT_DIR)))
    }

    expect(findingHashes.size).toBe(1)
    expect(stateHashes.size).toBe(1)
    expect(reportHashes.size).toBe(1)
  })

  test("out-of-order stream throws ProjectorError OUT_OF_ORDER", () => {
    const events = fixtureEvents()
    const outOfOrder = [...events]
    const second = outOfOrder[1]
    const third = outOfOrder[2]
    if (!second || !third) {
      throw new Error("fixture must contain seq 2 and seq 3 events")
    }
    ;[outOfOrder[1], outOfOrder[2]] = [third, second]

    expect(() => projectFindings(outOfOrder)).toThrow(ProjectorError)

    try {
      projectFindings(outOfOrder)
      throw new Error("expected projector to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectorError)
      if (error instanceof ProjectorError) {
        expect(error.code).toBe("OUT_OF_ORDER")
      }
    }
  })

  test("duplicate seq stream throws ProjectorError DUPLICATE_SEQ", () => {
    const events = fixtureEvents()
    const third = events[2]
    if (!third) {
      throw new Error("fixture must contain seq 3 event")
    }
    const duplicate: AuditEvent = {
      ...third,
      seq: 2,
    }
    const withDuplicate = [...events, duplicate]

    expect(() => projectFindings(withDuplicate)).toThrow(ProjectorError)

    try {
      projectFindings(withDuplicate)
      throw new Error("expected projector to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectorError)
      if (error instanceof ProjectorError) {
        expect(error.code).toBe("DUPLICATE_SEQ")
      }
    }
  })
})
