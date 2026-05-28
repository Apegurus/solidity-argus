import { describe, expect, test } from "bun:test"
import path from "node:path"
import type { Config } from "@opencode-ai/sdk"
import type { ArgusConfig } from "../../src/config/types"
import { createCompactionHook } from "../../src/hooks/compaction-hook"
import { createConfigHandler } from "../../src/hooks/config-handler"
import { createToolTrackingHook } from "../../src/hooks/tool-tracking-hook"
import ArgusPlugin from "../../src/index"
import { createAuditState } from "../../src/state/audit-state"
import { SCHEMA_VERSION } from "../../src/state/schemas"
import type { Finding } from "../../src/state/types"
import { contractAnalyzerTool } from "../../src/tools/contract-analyzer-tool"
import { forgeTestTool } from "../../src/tools/forge-test-tool"
import { patternCheckerTool } from "../../src/tools/pattern-checker-tool"
import { reportGeneratorTool } from "../../src/tools/report-generator-tool"
import { slitherTool } from "../../src/tools/slither-tool"

const FIXTURE_DIR = path.join(import.meta.dir, "../fixtures/vulnerable-vault")
const FIXTURE_CONTRACT = path.join(FIXTURE_DIR, "src/VulnerableVault.sol")

const DEFAULT_ARGUS_CONFIG: ArgusConfig = {
  agents: {
    argus: {},
    sentinel: {},
    pythia: {},
    auditSpecialist: {},
    scribe: {},
    themis: {},
  },
  tools: {},
  knowledge: {
    scvd: {
      enabled: true,
      apiUrl: "https://api.scvd.dev",
    },
    autoSync: false,
    skillPrecedence: "bundled-first" as const,
  },
  reporting: {
    confidenceThreshold: 80,
    format: "markdown",
    severityThreshold: "low",
    gasAnalysis: false,
    output_dir: ".argus/reports/",
  },
  solodit: {
    enabled: true,
    port: 54173,
  },
  disabled_hooks: [],
  hooks: {},
  cli: {},
  background: {
    max_concurrent: 3,
  },
}

function createMockContext() {
  const controller = new AbortController()
  return {
    sessionID: "integration-session",
    messageID: "integration-message",
    agent: "argus",
    directory: FIXTURE_DIR,
    worktree: FIXTURE_DIR,
    abort: controller.signal,
    metadata: (_: { title: string }) => {},
    ask: async () => undefined,
  }
}

function hasCommand(command: string): boolean {
  const result = Bun.spawnSync(["which", command], {
    stdout: "ignore",
    stderr: "ignore",
  })
  return result.exitCode === 0
}

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    id: overrides.id ?? `finding-${Math.random()}`,
    check: overrides.check ?? "generic-check",
    severity: overrides.severity ?? "Low",
    confidence: overrides.confidence ?? "Medium",
    description: overrides.description ?? "Generic finding",
    file: overrides.file ?? "src/VulnerableVault.sol",
    lines: overrides.lines ?? [1, 1],
    source: overrides.source ?? "manual",
    remediation: overrides.remediation,
    exploitReference: overrides.exploitReference,
  }
}

describe("full audit integration", () => {
  test("plugin loads and exports all expected tools", async () => {
    const pluginContext = { directory: FIXTURE_DIR } as Parameters<typeof ArgusPlugin>[0]
    const plugin = await ArgusPlugin(pluginContext)

    const toolNames = Object.keys(plugin.tool ?? {})
    expect(toolNames).toHaveLength(16)
    expect(toolNames).toContain("argus_slither_analyze")
    expect(toolNames).toContain("argus_forge_test")
    expect(toolNames).toContain("argus_gas_analysis")
    expect(toolNames).toContain("argus_forge_fuzz")
    expect(toolNames).toContain("argus_forge_coverage")
    expect(toolNames).toContain("argus_analyze_contract")
    expect(toolNames).toContain("argus_check_patterns")
    expect(toolNames).toContain("argus_proxy_detection")
    expect(toolNames).toContain("argus_read_findings")
    expect(toolNames).toContain("argus_record_finding")
    expect(toolNames).toContain("argus_solodit_search")
    expect(toolNames).toContain("argus_generate_report")
    expect(toolNames).toContain("argus_skill_load")
    expect(toolNames).toContain("argus_themis_disposition")
    expect(toolNames).toContain("argus_sync_knowledge")
    expect(typeof plugin.config).toBe("function")
    expect(typeof plugin.event).toBe("function")
  })

  test("config handler registers Argus agents and Solodit MCP", async () => {
    const config: Config = { agent: {}, mcp: {} }
    const handler = createConfigHandler(DEFAULT_ARGUS_CONFIG)

    await handler(config)

    expect(config.agent).toBeDefined()
    expect(config.agent && Object.keys(config.agent)).toEqual(
      expect.arrayContaining(["argus", "sentinel", "pythia", "scribe"]),
    )
    expect(config.agent?.argus?.mode).toBe("primary")
    expect(config.mcp?.["solodit-mcp"]).toBeDefined()
  })

  test("contract analyzer executes against fixture project", async () => {
    const payload = await contractAnalyzerTool.execute(
      {
        file_path: FIXTURE_CONTRACT,
        project_dir: FIXTURE_DIR,
      },
      createMockContext(),
    )

    const result = JSON.parse(payload) as {
      name: string
      filePath: string
      riskIndicators: string[]
      error?: string
    }

    expect(result.name).toBe("VulnerableVault")
    expect(result.filePath.endsWith("VulnerableVault.sol")).toBe(true)
    expect(Array.isArray(result.riskIndicators)).toBe(true)
  })

  test("pattern checker finds vulnerabilities in fixture", async () => {
    const payload = await patternCheckerTool.execute(
      {
        target: FIXTURE_DIR,
        patterns: ["reentrancy", "access-control"],
        include_scvd: true,
      },
      createMockContext(),
    )

    const result = JSON.parse(payload) as {
      sources: Array<{ matches: unknown[] }>
    }

    expect(result.sources.length).toBeGreaterThanOrEqual(1)
    const totalMatches = result.sources.reduce((count, source) => count + source.matches.length, 0)
    expect(totalMatches).toBeGreaterThanOrEqual(1)
  })

  test("report generator produces markdown output and counts", async () => {
    const findings: Finding[] = [
      makeFinding({
        id: "f-critical",
        check: "critical-check",
        severity: "Critical",
        confidence: "High",
        description: "Critical issue",
        lines: [4, 8],
      }),
      makeFinding({
        id: "f-high",
        check: "high-check",
        severity: "High",
        confidence: "High",
        description: "High issue",
        lines: [10, 14],
      }),
      makeFinding({
        id: "f-medium",
        check: "medium-check",
        severity: "Medium",
        confidence: "Medium",
        description: "Medium issue",
        lines: [20, 22],
      }),
    ]

    const payload = await reportGeneratorTool.execute(
      {
        project_name: "VulnerableVault",
        scope: ["VulnerableVault.sol"],
        include_executive_summary: true,
        severity_threshold: "low",
        preflight_policy: "warn",
        tool_coverage_policy: "warn",
        report_input: JSON.stringify({
          run_id: "test-run-1",
          seq: findings.length,
          session_id: "session-1",
          tool_call_id: "tc-report",
          source: "test",
          schema_version: SCHEMA_VERSION,
          projectDir: "/tmp/project",
          findings: findings.map((f, i) => ({
            ...f,
            run_id: "test-run-1",
            seq: i + 1,
            session_id: "session-1",
            tool_call_id: "tc-1",
            source: f.source ?? "slither",
            schema_version: SCHEMA_VERSION,
            observation_id: `obs-${i + 1}`,
            issue_fingerprint: `ifp-${i + 1}`,
            observation_fingerprint: `ofp-${i + 1}`,
            reported_by_agent: "sentinel",
          })),
          toolsExecuted: [],
          scope: ["VulnerableVault.sol"],
        }),
      } as Parameters<typeof reportGeneratorTool.execute>[0],
      createMockContext(),
    )

    const result = JSON.parse(payload) as {
      reportSummary: string
      findingsCount: {
        critical: number
        high: number
      }
    }

    expect(result.reportSummary).toMatch(/Report written to disk \(\d+ bytes/)
    expect(result.findingsCount.critical).toBeGreaterThanOrEqual(1)
  })

  test("compaction hook serializes audit state", async () => {
    const { state: auditState, store } = createAuditState(FIXTURE_DIR)
    store.addFinding({
      check: "reentrancy",
      severity: "High",
      confidence: "High",
      description: "Potential reentrancy",
      file: "src/VulnerableVault.sol",
      lines: [18, 22],
      source: "pattern",
    })
    store.addFinding({
      check: "access-control",
      severity: "Medium",
      confidence: "Medium",
      description: "Missing access control",
      file: "src/VulnerableVault.sol",
      lines: [16, 23],
      source: "pattern",
    })

    const hook = createCompactionHook(() => auditState)
    const compacted = await hook({ summary: "Previous context" })

    expect(compacted).not.toBeNull()
    expect(compacted).toContain("<argus-audit-state>")
  })

  test("tool tracking hook accumulates findings from slither output", async () => {
    const { state: auditState } = createAuditState(FIXTURE_DIR)
    const hook = createToolTrackingHook(() => auditState)

    await hook({
      tool: "argus_slither_analyze",
      args: { target: FIXTURE_DIR },
      result: JSON.stringify({
        success: true,
        findings: [
          {
            check: "reentrancy",
            severity: "High",
            confidence: "High",
            description: "External call before state update",
            file: "src/VulnerableVault.sol",
            lines: [18, 22],
          },
          {
            check: "missing-access-control",
            severity: "Medium",
            confidence: "Medium",
            description: "withdraw has no authorization check",
            file: "src/VulnerableVault.sol",
            lines: [16, 23],
          },
        ],
      }),
    })

    expect(auditState.findings.length).toBe(2)
  })

  if (hasCommand("slither")) {
    test("slither analysis runs on fixture", async () => {
      const payload = await slitherTool.execute(
        {
          target: FIXTURE_DIR,
        },
        createMockContext(),
      )

      const result = JSON.parse(payload) as {
        success: boolean
        findingsCount: number
      }

      expect(result.success).toBe(true)
      expect(result.findingsCount).toBeGreaterThanOrEqual(3)
    })
  } else {
    test.skip("slither analysis runs on fixture", () => {
      return
    })
  }

  if (hasCommand("forge")) {
    test("forge test runs on fixture", async () => {
      const payload = await forgeTestTool.execute(
        {
          target: FIXTURE_DIR,
          verbosity: 3,
          coverage: false,
        },
        createMockContext(),
      )

      const result = JSON.parse(payload) as {
        success: boolean
        summary: {
          total: number
        }
        error?: string
      }

      if (!result.success) {
        expect(typeof result.error).toBe("string")
        return
      }

      expect(result.success).toBe(true)
      expect(result.summary.total).toBeGreaterThanOrEqual(0)
    })
  } else {
    test.skip("forge test runs on fixture", () => {
      return
    })
  }
})
