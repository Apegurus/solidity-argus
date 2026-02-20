import { test, expect, describe, beforeEach } from "bun:test"
import { createToolTrackingHook } from "./tool-tracking-hook"
import { createAuditState } from "../state/audit-state"
import type { AuditState } from "../state/types"

describe("createToolTrackingHook", () => {
  let auditState: AuditState
  let hook: (input: { tool: string; args: unknown; result: string }) => Promise<void>

  beforeEach(() => {
    const created = createAuditState("/test/project")
    auditState = created.state
    hook = createToolTrackingHook(() => auditState)
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

  test("duplicate tool execution recorded separately", async () => {
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

    // Multiple executions of the same tool are recorded separately
    expect(auditState.toolsExecuted).toHaveLength(2)
    expect(auditState.toolsExecuted[0]?.tool).toBe("argus_slither_analyze")
    expect(auditState.toolsExecuted[1]?.tool).toBe("argus_slither_analyze")
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

  test("no-op when audit state is unavailable", async () => {
    const hookWithoutState = createToolTrackingHook(() => null)

    await hookWithoutState({
      tool: "argus_slither_analyze",
      args: { target: "." },
      result: JSON.stringify({ success: true, findings: [] }),
    })
  })

  describe("solodit evidence tracking", () => {
    test("solodit search results captured in auditState.soloditResults", async () => {
      const soloditResult = {
        results: [
          {
            title: "Reentrancy in withdraw",
            severity: "High",
            description: "State change after external call",
            protocol: "Compound",
            url: "https://solodit.xyz/issues/1",
            remediation: "Use checks-effects-interactions",
          },
          {
            title: "Oracle manipulation",
            severity: "Medium",
            description: "TWAP can be manipulated",
            protocol: "Uniswap",
            url: "https://solodit.xyz/issues/2",
            remediation: "Use longer TWAP window",
          },
        ],
        totalFound: 2,
        query: "reentrancy withdraw vault",
      }

      await hook({
        tool: "argus_solodit_search",
        args: { query: "reentrancy withdraw vault" },
        result: JSON.stringify(soloditResult),
      })

      expect(auditState.soloditResults).toBeDefined()
      expect(auditState.soloditResults).toHaveLength(1)

      const stored = auditState.soloditResults![0]!
      expect(stored.query).toBe("reentrancy withdraw vault")
      expect(stored.resultCount).toBe(2)
      expect(stored.timestamp).toBeGreaterThan(0)
      expect(stored.topResults).toHaveLength(2)
      expect(stored.topResults[0]!.title).toBe("Reentrancy in withdraw")
      expect(stored.topResults[0]!.severity).toBe("High")
      expect(stored.topResults[0]!.url).toBe("https://solodit.xyz/issues/1")
      expect(stored.topResults[0]!.protocol).toBe("Compound")
    })

    test("solodit search with empty results stores empty topResults", async () => {
      const soloditResult = {
        results: [],
        totalFound: 0,
        query: "nonexistent vulnerability pattern",
      }

      await hook({
        tool: "argus_solodit_search",
        args: { query: "nonexistent vulnerability pattern" },
        result: JSON.stringify(soloditResult),
      })

      expect(auditState.soloditResults).toHaveLength(1)

      const stored = auditState.soloditResults![0]!
      expect(stored.query).toBe("nonexistent vulnerability pattern")
      expect(stored.resultCount).toBe(0)
      expect(stored.topResults).toHaveLength(0)
    })

    test("solodit search with error field still records execution", async () => {
      const soloditResult = {
        results: [],
        totalFound: 0,
        query: "flash loan attack",
        error: "Solodit MCP not available",
      }

      await hook({
        tool: "argus_solodit_search",
        args: { query: "flash loan attack" },
        result: JSON.stringify(soloditResult),
      })

      expect(auditState.soloditResults).toHaveLength(1)
      expect(auditState.soloditResults![0]!.query).toBe("flash loan attack")
      expect(auditState.soloditResults![0]!.resultCount).toBe(0)

      expect(auditState.toolsExecuted).toHaveLength(1)
      expect(auditState.toolsExecuted[0]!.tool).toBe("argus_solodit_search")
    })

    test("solodit results limited to top 5", async () => {
      const soloditResult = {
        results: Array.from({ length: 8 }, (_, i) => ({
          title: `Finding ${i + 1}`,
          severity: "Medium",
          description: `Description ${i + 1}`,
          protocol: `Protocol ${i + 1}`,
          url: `https://solodit.xyz/issues/${i + 1}`,
          remediation: `Fix ${i + 1}`,
        })),
        totalFound: 8,
        query: "oracle manipulation",
      }

      await hook({
        tool: "argus_solodit_search",
        args: { query: "oracle manipulation" },
        result: JSON.stringify(soloditResult),
      })

      expect(auditState.soloditResults).toHaveLength(1)

      const stored = auditState.soloditResults![0]!
      expect(stored.topResults).toHaveLength(5)
      expect(stored.resultCount).toBe(8)
      expect(stored.topResults[0]!.title).toBe("Finding 1")
      expect(stored.topResults[4]!.title).toBe("Finding 5")
    })

    test("multiple solodit searches accumulate results", async () => {
      const first = {
        results: [
          {
            title: "Reentrancy",
            severity: "High",
            description: "desc",
            protocol: "Aave",
            url: "https://solodit.xyz/issues/1",
            remediation: "fix",
          },
        ],
        totalFound: 1,
        query: "reentrancy",
      }

      const second = {
        results: [
          {
            title: "Flash loan",
            severity: "Critical",
            description: "desc",
            protocol: "dYdX",
            url: "https://solodit.xyz/issues/2",
            remediation: "fix",
          },
        ],
        totalFound: 1,
        query: "flash loan",
      }

      await hook({
        tool: "argus_solodit_search",
        args: { query: "reentrancy" },
        result: JSON.stringify(first),
      })

      await hook({
        tool: "argus_solodit_search",
        args: { query: "flash loan" },
        result: JSON.stringify(second),
      })

      expect(auditState.soloditResults).toHaveLength(2)
      expect(auditState.soloditResults![0]!.query).toBe("reentrancy")
      expect(auditState.soloditResults![1]!.query).toBe("flash loan")
    })
  })

  describe("fuzz counterexample tracking", () => {
    test("fuzz counterexamples captured in auditState.fuzzCounterexamples", async () => {
      const fuzzResult = {
        success: false,
        results: [
          { testName: "testFuzz_withdraw(uint256)", status: "fail", runs: 128, gas: 45000 },
        ],
        counterexamples: [
          {
            testName: "testFuzz_withdraw(uint256)",
            inputs: { arg0: "115792089237316195423570985008687907853269984665640564039457584007913129639935" },
            revertReason: "Arithmetic overflow",
          },
        ],
        totalRuns: 128,
        executionTime: 2000,
      }

      await hook({
        tool: "argus_forge_fuzz",
        args: { target: "." },
        result: JSON.stringify(fuzzResult),
      })

      expect(auditState.fuzzCounterexamples).toHaveLength(1)
      const ce = auditState.fuzzCounterexamples![0]!
      expect(ce.testName).toBe("testFuzz_withdraw(uint256)")
      expect(ce.inputs).toEqual(["115792089237316195423570985008687907853269984665640564039457584007913129639935"])
      expect(ce.revertReason).toBe("Arithmetic overflow")
      expect(ce.runs).toBe(128)
      expect(ce.timestamp).toBeGreaterThan(0)
      // Should NOT create findings
      expect(auditState.findings).toHaveLength(0)
    })

    test("fuzz results with no counterexamples stores empty array", async () => {
      const fuzzResult = {
        success: true,
        results: [
          { testName: "testFuzz_deposit(uint256)", status: "pass", runs: 256, gas: 30000 },
        ],
        counterexamples: [],
        totalRuns: 256,
        executionTime: 1500,
      }

      await hook({
        tool: "argus_forge_fuzz",
        args: { target: "." },
        result: JSON.stringify(fuzzResult),
      })

      expect(auditState.fuzzCounterexamples).toHaveLength(0)
      expect(auditState.toolsExecuted).toHaveLength(1)
      expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_forge_fuzz")
    })

    test("fuzz counterexample includes revert reason when present", async () => {
      const fuzzResult = {
        success: false,
        results: [],
        counterexamples: [
          {
            testName: "testFuzz_transfer(address,uint256)",
            inputs: { arg0: "0x0000000000000000000000000000000000000000", arg1: "1000" },
            revertReason: "ERC20: transfer to zero address",
          },
        ],
        totalRuns: 64,
        executionTime: 800,
      }

      await hook({
        tool: "argus_forge_fuzz",
        args: { target: "." },
        result: JSON.stringify(fuzzResult),
      })

      expect(auditState.fuzzCounterexamples).toHaveLength(1)
      const ce = auditState.fuzzCounterexamples![0]!
      expect(ce.revertReason).toBe("ERC20: transfer to zero address")
      expect(ce.inputs).toEqual(["0x0000000000000000000000000000000000000000", "1000"])
    })

    test("fuzz counterexample without revert reason omits it", async () => {
      const fuzzResult = {
        success: false,
        results: [],
        counterexamples: [
          {
            testName: "testFuzz_mint(uint256)",
            inputs: { arg0: "0" },
          },
        ],
        totalRuns: 256,
        executionTime: 500,
      }

      await hook({
        tool: "argus_forge_fuzz",
        args: { target: "." },
        result: JSON.stringify(fuzzResult),
      })

      expect(auditState.fuzzCounterexamples).toHaveLength(1)
      const ce = auditState.fuzzCounterexamples![0]!
      expect(ce.testName).toBe("testFuzz_mint(uint256)")
      expect(ce.revertReason).toBeUndefined()
      expect(ce.runs).toBe(256)
    })

    test("fuzz counterexample supports array-shaped inputs", async () => {
      const fuzzResult = {
        success: false,
        results: [],
        counterexamples: [
          {
            testName: "testFuzz_swap(uint256,uint256)",
            inputs: ["100", "0"],
            revertReason: "Division by zero",
          },
        ],
        totalRuns: 42,
        executionTime: 600,
      }

      await hook({
        tool: "argus_forge_fuzz",
        args: { target: "." },
        result: JSON.stringify(fuzzResult),
      })

      expect(auditState.fuzzCounterexamples).toHaveLength(1)
      const ce = auditState.fuzzCounterexamples![0]!
      expect(ce.inputs).toEqual(["100", "0"])
      expect(ce.revertReason).toBe("Division by zero")
      expect(ce.runs).toBe(42)
    })

    test("multiple fuzz runs accumulate counterexamples", async () => {
      const firstRun = {
        success: false,
        results: [],
        counterexamples: [
          {
            testName: "testFuzz_withdraw(uint256)",
            inputs: { arg0: "999999" },
            revertReason: "Insufficient balance",
          },
        ],
        totalRuns: 128,
        executionTime: 1000,
      }

      const secondRun = {
        success: false,
        results: [],
        counterexamples: [
          {
            testName: "testFuzz_deposit(uint256)",
            inputs: { arg0: "0" },
          },
          {
            testName: "testFuzz_swap(uint256,uint256)",
            inputs: { arg0: "100", arg1: "0" },
            revertReason: "Division by zero",
          },
        ],
        totalRuns: 256,
        executionTime: 2000,
      }

      await hook({
        tool: "argus_forge_fuzz",
        args: { target: "." },
        result: JSON.stringify(firstRun),
      })

      // Reset toolsExecuted to allow second recording (dedup guard)
      auditState.toolsExecuted = []

      await hook({
        tool: "argus_forge_fuzz",
        args: { target: "." },
        result: JSON.stringify(secondRun),
      })

      expect(auditState.fuzzCounterexamples).toHaveLength(3)
      expect(auditState.fuzzCounterexamples![0]!.testName).toBe("testFuzz_withdraw(uint256)")
      expect(auditState.fuzzCounterexamples![0]!.runs).toBe(128)
      expect(auditState.fuzzCounterexamples![1]!.testName).toBe("testFuzz_deposit(uint256)")
      expect(auditState.fuzzCounterexamples![1]!.runs).toBe(256)
      expect(auditState.fuzzCounterexamples![2]!.testName).toBe("testFuzz_swap(uint256,uint256)")
      expect(auditState.fuzzCounterexamples![2]!.revertReason).toBe("Division by zero")
    })
  })

  describe("skill load tracking", () => {
    test("skill name extracted from markdown and added to skillsLoaded", async () => {
      const skillResult = `## Argus Skill: reentrancy [Source: bundled]

**Source**: bundled
**Path**: skills/reentrancy.md
**Description**: Reentrancy vulnerability patterns

[Provenance: MIT | https://example.com]

# Reentrancy Vulnerability

Detailed content about reentrancy...`

      await hook({
        tool: "argus_skill_load",
        args: { name: "reentrancy" },
        result: skillResult,
      })

      expect(auditState.skillsLoaded).toBeDefined()
      expect(auditState.skillsLoaded).toContain("reentrancy")
      expect(auditState.toolsExecuted).toHaveLength(1)
      expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_skill_load")
    })

    test("duplicate skill names are not added twice", async () => {
      const skillResult = `## Argus Skill: reentrancy [Source: bundled]

**Source**: bundled
**Path**: skills/reentrancy.md

# Reentrancy Vulnerability

Content...`

      await hook({
        tool: "argus_skill_load",
        args: { name: "reentrancy" },
        result: skillResult,
      })

      await hook({
        tool: "argus_skill_load",
        args: { name: "reentrancy" },
        result: skillResult,
      })

      expect(auditState.skillsLoaded).toHaveLength(1)
    })
  })

  describe("report generation tracking", () => {
    test("report generation sets reportGenerated to true", async () => {
      const reportResult = {
        report: "# Audit Report\n...",
        format: "markdown",
        findingsCount: 5,
      }

      await hook({
        tool: "argus_generate_report",
        args: { project_name: "Vault" },
        result: JSON.stringify(reportResult),
      })

      expect(auditState.reportGenerated).toBe(true)
      expect(auditState.toolsExecuted).toHaveLength(1)
      expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_generate_report")
    })
  })

  describe("knowledge sync tracking", () => {
    test("sync event logged with success status", async () => {
      const syncResult = {
        success: true,
        entriesCount: 7769,
        source: "api.scvd.dev",
      }

      await hook({
        tool: "argus_sync_knowledge",
        args: { force: false },
        result: JSON.stringify(syncResult),
      })

      expect(auditState.knowledgeSynced).toBeDefined()
      expect(auditState.knowledgeSynced!.success).toBe(true)
      expect(auditState.knowledgeSynced!.timestamp).toBeGreaterThan(0)
      expect(auditState.toolsExecuted).toHaveLength(1)
      expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_sync_knowledge")
    })

    test("sync failure logged with success=false", async () => {
      const syncResult = {
        success: false,
        error: "Network timeout",
      }

      await hook({
        tool: "argus_sync_knowledge",
        args: { force: true },
        result: JSON.stringify(syncResult),
      })

      expect(auditState.knowledgeSynced).toBeDefined()
      expect(auditState.knowledgeSynced!.success).toBe(false)
      expect(auditState.knowledgeSynced!.timestamp).toBeGreaterThan(0)
    })
  })

  describe("forge coverage tracking", () => {
    test("coverage summary extracted to coverageReport", async () => {
      const coverageResult = {
        success: true,
        report: {
          files: [
            {
              path: "src/Vault.sol",
              linesPct: 85.5,
              statementsPct: 80.0,
              branchesPct: 70.0,
              functionsPct: 90.0,
            },
            {
              path: "src/Token.sol",
              linesPct: 100,
              statementsPct: 100,
              branchesPct: 95.0,
              functionsPct: 100,
            },
          ],
          summary: {
            totalLinesPct: 92.75,
            totalStatementsPct: 90.0,
            totalBranchesPct: 82.5,
            totalFunctionsPct: 95.0,
          },
        },
        executionTime: 5000,
      }

      await hook({
        tool: "argus_forge_coverage",
        args: { target: "." },
        result: JSON.stringify(coverageResult),
      })

      expect(auditState.coverageReport).toBeDefined()
      expect(auditState.coverageReport!.files).toHaveLength(2)
      expect(auditState.coverageReport!.files[0]!.path).toBe("src/Vault.sol")
      expect(auditState.coverageReport!.files[0]!.linesPct).toBe(85.5)
      expect(auditState.coverageReport!.files[0]!.branchesPct).toBe(70.0)
      expect(auditState.coverageReport!.files[0]!.functionsPct).toBe(90.0)
      expect(auditState.coverageReport!.files[1]!.path).toBe("src/Token.sol")
      expect(auditState.toolsExecuted).toHaveLength(1)
      expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_forge_coverage")
    })
  })

  describe("proxy detection tracking", () => {
    test("proxy detection with isProxy=true creates proxyContracts entry", async () => {
      const proxyResult = {
        isProxy: true,
        file: "src/VaultProxy.sol",
        proxyType: "UUPS",
        indicators: ["delegatecall", "ERC1967 storage slot"],
        confidence: "High",
      }

      await hook({
        tool: "argus_proxy_detection",
        args: { file_path: "src/VaultProxy.sol" },
        result: JSON.stringify(proxyResult),
      })

      expect(auditState.proxyContracts).toBeDefined()
      expect(auditState.proxyContracts).toHaveLength(1)
      expect(auditState.proxyContracts![0]!.file).toBe("src/VaultProxy.sol")
      expect(auditState.proxyContracts![0]!.proxyType).toBe("UUPS")
      expect(auditState.proxyContracts![0]!.indicators).toEqual(["delegatecall", "ERC1967 storage slot"])
      // Should NOT create findings
      expect(auditState.findings).toHaveLength(0)
      expect(auditState.toolsExecuted).toHaveLength(1)
      expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_proxy_detection")
    })

    test("proxy detection with isProxy=false does not create proxyContracts entry", async () => {
      const proxyResult = {
        isProxy: false,
        file: "src/Vault.sol",
        indicators: [],
        confidence: "High",
      }

      await hook({
        tool: "argus_proxy_detection",
        args: { file_path: "src/Vault.sol" },
        result: JSON.stringify(proxyResult),
      })

      expect(auditState.proxyContracts).toBeUndefined()
      expect(auditState.toolsExecuted).toHaveLength(1)
    })
  })

  describe("gas analysis tracking", () => {
    test("gas hotspots extracted to gasHotspots", async () => {
      const gasResult = {
        hotspots: [
          { contract: "Vault", function: "withdraw", avgGas: 150000 },
          { contract: "Vault", function: "deposit", avgGas: 85000 },
        ],
        threshold: 50000,
        totalContracts: 1,
      }

      await hook({
        tool: "argus_gas_analysis",
        args: { target: "." },
        result: JSON.stringify(gasResult),
      })

      expect(auditState.gasHotspots).toBeDefined()
      expect(auditState.gasHotspots).toHaveLength(2)
      expect(auditState.gasHotspots![0]!.contract).toBe("Vault")
      expect(auditState.gasHotspots![0]!.function).toBe("withdraw")
      expect(auditState.gasHotspots![0]!.avgGas).toBe(150000)
      expect(auditState.gasHotspots![1]!.function).toBe("deposit")
      expect(auditState.toolsExecuted).toHaveLength(1)
      expect(auditState.toolsExecuted.at(0)?.tool).toBe("argus_gas_analysis")
    })

    test("gas analysis with empty hotspots stores empty array", async () => {
      const gasResult = {
        hotspots: [],
        threshold: 50000,
        totalContracts: 1,
      }

      await hook({
        tool: "argus_gas_analysis",
        args: { target: "." },
        result: JSON.stringify(gasResult),
      })

      expect(auditState.gasHotspots).toBeDefined()
      expect(auditState.gasHotspots).toHaveLength(0)
    })
  })
})
