import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { createAuditArtifactResolver } from "../../src/shared/audit-artifact-resolver"
import { SCHEMA_VERSION } from "../../src/state/schemas"
import { executePersistDeduped } from "../../src/tools/persist-deduped-tool"
import { executeRecordFinding } from "../../src/tools/record-finding-tool"
import { executeReportGeneration } from "../../src/tools/report-generator-tool"

describe("Audit reporting pipeline end-to-end (Task 6)", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "argus-pipeline-e2e-"))
    tempDirs.push(dir)
    return dir
  }

  function makeContext(projectDir: string, agent = "scribe"): ToolContext {
    return {
      sessionID: `session-${agent}`,
      messageID: `msg-${agent}`,
      agent,
      directory: projectDir,
      worktree: projectDir,
      abort: new AbortController().signal,
      metadata() {
        return
      },
      async ask() {
        return
      },
    }
  }

  test("record_finding → persist_deduped → generate_report produces complete report with non-placeholder content", async () => {
    const projectDir = makeTempDir()
    const runId = "e2e-pipeline-run"

    const sentinelResponse = JSON.parse(
      await executeRecordFinding(
        {
          findings: JSON.stringify([
            {
              check: "reentrancy-eth",
              severity: "Critical",
              confidence: "High",
              description: "Reentrancy in VulnerableVault.withdraw allows fund drain",
              file: "src/VulnerableVault.sol",
              lines: [18, 23],
              source: "slither",
              impact: "Attacker can drain all deposited ETH via cross-function reentrancy",
              recommendation:
                "Add OpenZeppelin nonReentrant modifier and apply checks-effects-interactions",
              proofOfConcept: "forge test --match-test testReentrancyDrain -vvvv",
            },
            {
              check: "missing-access-control",
              severity: "High",
              confidence: "High",
              description: "PriceOracle.setPool() lacks access control",
              file: "src/PriceOracle.sol",
              lines: [21, 21],
              source: "slither",
              impact: "Anyone can swap the price feed pool to manipulate oracle prices",
              recommendation: "Restrict setPool to onlyOwner",
              proofOfConcept: "Call setPool from an unprivileged account and observe success",
            },
          ]),
        },
        makeContext(projectDir, "sentinel"),
      ),
    ) as { success: boolean; findings: Array<{ impact?: string; recommendation?: string }> }

    expect(sentinelResponse.success).toBe(true)
    expect(sentinelResponse.findings[0]?.impact).toContain("drain all deposited ETH")
    expect(sentinelResponse.findings[0]?.recommendation).toContain("nonReentrant")

    const persistResponse = JSON.parse(
      await executePersistDeduped(
        {
          run_id: runId,
          deduped_findings: JSON.stringify([
            {
              check: "reentrancy-eth",
              severity: "Critical",
              confidence: "High",
              description: "Reentrancy in VulnerableVault.withdraw allows fund drain",
              file: "src/VulnerableVault.sol",
              lines: [18, 23],
              source: "slither",
              impact: "Attacker can drain all deposited ETH via cross-function reentrancy",
              recommendation:
                "Add OpenZeppelin nonReentrant modifier and apply checks-effects-interactions",
              proofOfConcept: "forge test --match-test testReentrancyDrain -vvvv",
            },
            {
              check: "missing-access-control",
              severity: "High",
              confidence: "High",
              description: "PriceOracle.setPool() lacks access control",
              file: "src/PriceOracle.sol",
              lines: [21, 21],
              source: "slither",
              impact: "Anyone can swap the price feed pool to manipulate oracle prices",
              recommendation: "Restrict setPool to onlyOwner",
              proofOfConcept: "Call setPool from an unprivileged account and observe success",
            },
            {
              check: "floating-pragma",
              severity: "Informational",
              confidence: "Low",
              description: "Contracts use a floating pragma",
              file: "src/VulnerableVault.sol",
              lines: [1, 1],
              source: "manual",
              impact: "Build reproducibility is reduced across compiler patch versions",
              recommendation: "Pin all contracts to the same audited compiler version",
              proofOfConcept: "Inspect pragma solidity declaration in the fixture contracts",
            },
          ]),
        },
        makeContext(projectDir, "scribe"),
      ),
    ) as { success: boolean; findings_count: number }

    expect(persistResponse.success).toBe(true)
    expect(persistResponse.findings_count).toBe(3)

    const start = Date.now()
    const reportResult = await executeReportGeneration(
      {
        project_name: "VulnerableVault",
        scope: ["src/VulnerableVault.sol", "src/PriceOracle.sol"],
        run_id: runId,
        tool_coverage_policy: "skip",
        preflight_policy: "warn",
      },
      makeContext(projectDir, "scribe"),
    )
    const elapsed = Date.now() - start

    expect(reportResult.run_id).toBe(runId)
    expect(reportResult.findingsCount.critical).toBe(1)
    expect(reportResult.findingsCount.high).toBe(1)
    expect(reportResult.findingsCount.informational).toBe(1)
    expect(reportResult.report).toContain("Critical")
    expect(reportResult.report).toContain("Attacker can drain all deposited ETH")
    expect(reportResult.report).toContain("Add OpenZeppelin nonReentrant modifier")
    expect(reportResult.report).toContain("Anyone can swap the price feed pool")
    expect(reportResult.report).toContain("### [INFO-1] Floating Pragma")
    expect(reportResult.report).not.toContain("Impact details were not provided")
    expect(reportResult.report).not.toContain("Recommendation details were not provided")
    expect(elapsed).toBeLessThan(60_000)

    expect(reportResult.error).toBeUndefined()
    expect(reportResult.filePath).toBeDefined()
    if (reportResult.filePath) {
      expect(existsSync(reportResult.filePath)).toBe(true)
      const onDisk = readFileSync(reportResult.filePath, "utf-8")
      expect(onDisk).toContain("Critical")
      expect(onDisk).toContain("Attacker can drain all deposited ETH")
    }

    const dedupedFile = createAuditArtifactResolver(runId, projectDir).paths().dedupedFindingsFile
    expect(existsSync(dedupedFile)).toBe(true)
  })

  test("deduped findings missing canonical metadata are normalized at report time (Task 3 regression)", async () => {
    const projectDir = makeTempDir()
    const runId = "e2e-normalize-deduped"
    const resolver = createAuditArtifactResolver(runId, projectDir)
    const dedupedPath = resolver.paths().dedupedFindingsFile
    mkdirSync(join(dedupedPath, ".."), { recursive: true })
    writeFileSync(
      dedupedPath,
      JSON.stringify({
        run_id: runId,
        schema_version: SCHEMA_VERSION,
        deduped_at: Date.now(),
        deduped_by: "scribe",
        findings_count: 1,
        findings: [
          {
            check: "oracle-manipulation",
            severity: "Critical",
            confidence: "High",
            description: "Single-pool price feed is manipulable via flash loan",
            file: "src/PriceOracle.sol",
            lines: [16, 25],
            source: "slither",
            impact: "Flash-loan attacker can manipulate borrow/liquidation prices",
            recommendation: "Use TWAP or multi-pool aggregation",
          },
        ],
      }),
    )

    const result = await executeReportGeneration(
      {
        project_name: "NormalizeTest",
        scope: ["src/PriceOracle.sol"],
        run_id: runId,
        tool_coverage_policy: "skip",
        preflight_policy: "warn",
      },
      makeContext(projectDir, "scribe"),
    )

    expect(result.findingsCount.critical).toBe(1)
    expect(result.report).toContain("Flash-loan attacker can manipulate")
    expect(result.report).not.toContain("Impact details were not provided")
  })
})
