import { test, expect, describe, beforeEach } from "bun:test"
import { createToolTrackingHook } from "./tool-tracking-hook"
import { createAuditState } from "../state/audit-state"
import type { AuditState } from "../state/types"
import type { FindingStore } from "../state/finding-store"

describe("createToolTrackingHook", () => {
  let auditState: AuditState
  let store: FindingStore
  let hook: (input: { tool: string; args: unknown; result: string }) => Promise<void>

  beforeEach(() => {
    const created = createAuditState("/test/project")
    auditState = created.state
    store = created.store
    hook = createToolTrackingHook(auditState, store)
  })

  test("no-op for non-argus tools", async () => {
    await hook({
      tool: "bash",
      args: {},
      result: JSON.stringify({ output: "hello" }),
    })

    expect(auditState.findings).toHaveLength(0)
    expect(auditState.toolsExecuted).toHaveLength(0)
    expect(auditState.contractsReviewed).toHaveLength(0)
  })

  test("slither findings extracted", async () => {
    const slitherResult = {
      success: true,
      findingsCount: 2,
      findings: [
        {
          id: "abc123",
          check: "reentrancy-eth",
          severity: "High",
          confidence: "High",
          description: "Reentrancy vulnerability in withdraw()",
          file: "src/Vault.sol",
          lines: [10, 20],
          source: "slither",
        },
        {
          id: "def456",
          check: "unchecked-transfer",
          severity: "Medium",
          confidence: "Medium",
          description: "Unchecked return value from transfer()",
          file: "src/Token.sol",
          lines: [30, 35],
          source: "slither",
        },
      ],
      executionTime: 5000,
      errors: [],
    }

    await hook({
      tool: "argus_slither_analyze",
      args: { target: "." },
      result: JSON.stringify(slitherResult),
    })

    expect(auditState.findings).toHaveLength(2)
    expect(auditState.findings.at(0)?.check).toBe("reentrancy-eth")
    expect(auditState.findings.at(0)?.severity).toBe("High")
    expect(auditState.findings.at(0)?.confidence).toBe("High")
    expect(auditState.findings.at(0)?.source).toBe("slither")
    expect(auditState.findings.at(0)?.file).toBe("src/Vault.sol")
    expect(auditState.findings.at(0)?.lines).toEqual([10, 20])
    expect(auditState.findings.at(1)?.check).toBe("unchecked-transfer")
    expect(auditState.findings.at(1)?.severity).toBe("Medium")
  })

  test("pattern checker findings extracted", async () => {
    const patternResult = {
      sources: [
        {
          source: "pattern-db",
          matches: [
            {
              pattern: "reentrancy",
              severity: "High",
              file: "src/Vault.sol",
              lines: [15, 25],
              description:
                "Potential reentrancy: ETH transfer via low-level call",
            },
          ],
        },
      ],
      patternsChecked: 5,
      executionTime: 100,
    }

    await hook({
      tool: "argus_check_patterns",
      args: { target: "." },
      result: JSON.stringify(patternResult),
    })

    expect(auditState.findings).toHaveLength(1)
    expect(auditState.findings.at(0)?.check).toBe("reentrancy")
    expect(auditState.findings.at(0)?.severity).toBe("High")
    expect(auditState.findings.at(0)?.source).toBe("pattern")
    expect(auditState.findings.at(0)?.confidence).toBe("Medium")
    expect(auditState.findings.at(0)?.file).toBe("src/Vault.sol")
    expect(auditState.findings.at(0)?.lines).toEqual([15, 25])
  })

  test("cross-tool deduplication", async () => {
    const slitherResult = {
      success: true,
      findingsCount: 1,
      findings: [
        {
          id: "abc123",
          check: "reentrancy-eth",
          severity: "High",
          confidence: "High",
          description: "Reentrancy from slither",
          file: "src/Vault.sol",
          lines: [10, 20],
          source: "slither",
        },
      ],
      executionTime: 5000,
      errors: [],
    }

    const patternResult = {
      sources: [
        {
          source: "pattern-db",
          matches: [
            {
              pattern: "reentrancy-eth",
              severity: "High",
              file: "src/Vault.sol",
              lines: [10, 20],
              description: "Reentrancy from pattern checker",
            },
          ],
        },
      ],
      patternsChecked: 5,
      executionTime: 100,
    }

    await hook({
      tool: "argus_slither_analyze",
      args: { target: "." },
      result: JSON.stringify(slitherResult),
    })

    await hook({
      tool: "argus_check_patterns",
      args: { target: "." },
      result: JSON.stringify(patternResult),
    })

    // Same check + file + lines → deduped by finding store
    expect(auditState.findings).toHaveLength(1)
    expect(auditState.findings.at(0)?.source).toBe("slither")
  })

  test("contract analyzer updates contractsReviewed", async () => {
    const analyzerResult = {
      name: "Vault",
      filePath: "src/Vault.sol",
      functions: [],
      stateVars: [],
      inheritance: [],
      accessControlPattern: "ownable",
      externalCalls: [],
      riskIndicators: [],
    }

    await hook({
      tool: "argus_analyze_contract",
      args: { file_path: "src/Vault.sol" },
      result: JSON.stringify(analyzerResult),
    })

    expect(auditState.contractsReviewed).toContain("src/Vault.sol")
    expect(auditState.contractsReviewed).toHaveLength(1)
  })

  test("tool name recorded in toolsExecuted", async () => {
    const forgeResult = {
      success: true,
      summary: { passed: 5, failed: 0, skipped: 0, total: 5 },
      tests: [],
      executionTime: 1000,
    }

    await hook({
      tool: "argus_forge_test",
      args: { target: "." },
      result: JSON.stringify(forgeResult),
    })

    expect(auditState.toolsExecuted).toHaveLength(1)
    expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_forge_test")
    expect(auditState.toolsExecuted.at(0)?.success).toBe(true)
    expect(auditState.toolsExecuted.at(0)?.findingsCount).toBe(0)
  })

  test("malformed JSON is no-op", async () => {
    await hook({
      tool: "argus_slither_analyze",
      args: {},
      result: "not json at all",
    })

    expect(auditState.findings).toHaveLength(0)
    expect(auditState.toolsExecuted).toHaveLength(0)
    expect(auditState.contractsReviewed).toHaveLength(0)
  })

  test("empty findings array — no findings added", async () => {
    const slitherResult = {
      success: true,
      findingsCount: 0,
      findings: [],
      executionTime: 5000,
      errors: [],
    }

    await hook({
      tool: "argus_slither_analyze",
      args: { target: "." },
      result: JSON.stringify(slitherResult),
    })

    expect(auditState.findings).toHaveLength(0)
    // Tool execution is still recorded
    expect(auditState.toolsExecuted).toHaveLength(1)
    expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_slither_analyze")
    expect(auditState.toolsExecuted.at(0)?.findingsCount).toBe(0)
  })

  test("duplicate tool execution not recorded twice", async () => {
    const slitherResult = {
      success: true,
      findingsCount: 0,
      findings: [],
      executionTime: 1000,
      errors: [],
    }

    await hook({
      tool: "argus_slither_analyze",
      args: { target: "." },
      result: JSON.stringify(slitherResult),
    })

    await hook({
      tool: "argus_slither_analyze",
      args: { target: "./src" },
      result: JSON.stringify(slitherResult),
    })

    expect(auditState.toolsExecuted).toHaveLength(1)
  })

  test("forge fuzz recorded without extracting findings", async () => {
    const fuzzResult = {
      success: true,
      results: [
        { testName: "testFuzz_withdraw", status: "pass", runs: 256, gas: 50000 },
      ],
      counterexamples: [],
      totalRuns: 256,
      executionTime: 3000,
    }

    await hook({
      tool: "argus_forge_fuzz",
      args: { target: "." },
      result: JSON.stringify(fuzzResult),
    })

    expect(auditState.findings).toHaveLength(0)
    expect(auditState.toolsExecuted).toHaveLength(1)
    expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_forge_fuzz")
  })

  test("contract analyzer does not add duplicate paths", async () => {
    const analyzerResult = {
      name: "Vault",
      filePath: "src/Vault.sol",
      functions: [],
      stateVars: [],
      inheritance: [],
      externalCalls: [],
      riskIndicators: [],
    }

    await hook({
      tool: "argus_analyze_contract",
      args: { file_path: "src/Vault.sol" },
      result: JSON.stringify(analyzerResult),
    })

    await hook({
      tool: "argus_analyze_contract",
      args: { file_path: "src/Vault.sol" },
      result: JSON.stringify(analyzerResult),
    })

    expect(auditState.contractsReviewed).toHaveLength(1)
  })
})
