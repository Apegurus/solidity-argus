import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path, { basename, join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import ArgusPlugin from "../../src/index"

const FIXTURE_DIR = path.resolve(import.meta.dir, "../fixtures/vulnerable-vault")

type PluginInstance = Awaited<ReturnType<typeof ArgusPlugin>>
type ToolAfterHook = NonNullable<PluginInstance["tool.execute.after"]>
type ToolAfterInput = Parameters<ToolAfterHook>[0]
type ToolAfterOutput = Parameters<ToolAfterHook>[1]
type EventHook = NonNullable<PluginInstance["event"]>
type EventInput = Parameters<EventHook>[0]
type ChatParamsHook = NonNullable<PluginInstance["chat.params"]>
type ChatParamsInput = Parameters<ChatParamsHook>[0]
type ChatParamsOutput = Parameters<ChatParamsHook>[1]

function createMockContext(sessionID: string): ToolContext {
  return {
    sessionID,
    messageID: `message-${sessionID}`,
    agent: "argus",
    directory: FIXTURE_DIR,
    worktree: FIXTURE_DIR,
    abort: new AbortController().signal,
    metadata() {
      return
    },
    async ask() {
      return
    },
  }
}

function sessionStatePath(sessionID: string): string {
  return join(FIXTURE_DIR, ".argus", "sessions", `state-${sessionID}.json`)
}

function sessionStateJson(sessionID: string): Record<string, unknown> {
  return JSON.parse(readFileSync(sessionStatePath(sessionID), "utf-8")) as Record<string, unknown>
}

function latestArchivePath(): string {
  const archivesDir = join(FIXTURE_DIR, ".argus", "archives")
  const files = readdirSync(archivesDir)
    .filter((entry) => entry.startsWith("argus-state.") && entry.endsWith(".json"))
    .sort()
  const latest = files.at(-1)
  if (!latest) {
    throw new Error("No archive file found")
  }
  return join(archivesDir, latest)
}

async function createPlugin(): Promise<PluginInstance> {
  const lockKey = Symbol.for("solidity-argus:instance-lock")
  delete (globalThis as unknown as Record<symbol, unknown>)[lockKey]
  return ArgusPlugin({ directory: FIXTURE_DIR } as Parameters<typeof ArgusPlugin>[0])
}

async function trackArgusAgent(plugin: PluginInstance, sessionID: string): Promise<void> {
  const chatInput: ChatParamsInput = {
    sessionID,
    agent: "argus",
    model: "test-model" as unknown as ChatParamsInput["model"],
    provider: "test-provider" as unknown as ChatParamsInput["provider"],
    message: {} as ChatParamsInput["message"],
  }
  const chatOutput: ChatParamsOutput = {
    temperature: 0,
    topP: 1,
    topK: 0,
    options: {},
  }
  await plugin["chat.params"]?.(chatInput, chatOutput)
}

async function fireEvent(
  plugin: PluginInstance,
  type: "session.created" | "session.idle" | "session.deleted" | "session.error",
  sessionID: string,
): Promise<void> {
  const input = {
    event: {
      type,
      properties: {
        info: { id: sessionID },
      },
    },
  } as EventInput
  await plugin.event?.(input)
}

async function fireToolAfter(
  plugin: PluginInstance,
  input: ToolAfterInput,
  output: ToolAfterOutput,
): Promise<void> {
  await plugin["tool.execute.after"]?.(input, output)
}

async function runCoreToolSequence(plugin: PluginInstance, sessionID: string): Promise<void> {
  await fireToolAfter(
    plugin,
    {
      tool: "argus_slither_analyze",
      sessionID,
      callID: "call-slither",
      args: { target: FIXTURE_DIR },
    },
    {
      title: "argus_slither_analyze",
      output: JSON.stringify({
        success: true,
        findings: [
          {
            check: "reentrancy-withdraw",
            severity: "High",
            confidence: "High",
            description: "External call before state update in withdraw",
            file: "src/VulnerableVault.sol",
            lines: [18, 22],
          },
        ],
      }),
      metadata: {},
    },
  )

  await fireToolAfter(
    plugin,
    {
      tool: "argus_check_patterns",
      sessionID,
      callID: "call-patterns",
      args: { target: FIXTURE_DIR, patterns: ["access-control"] },
    },
    {
      title: "argus_check_patterns",
      output: JSON.stringify({
        success: true,
        sources: [
          {
            source: "pattern-db",
            matches: [
              {
                pattern: "missing-only-owner",
                severity: "Medium",
                file: "src/VulnerableVault.sol",
                lines: [16, 23],
                description: "State-changing function missing access control",
              },
            ],
          },
        ],
      }),
      metadata: {},
    },
  )

  await fireToolAfter(
    plugin,
    {
      tool: "argus_analyze_contract",
      sessionID,
      callID: "call-analyze-contract",
      args: { file_path: "src/VulnerableVault.sol" },
    },
    {
      title: "argus_analyze_contract",
      output: JSON.stringify({
        name: "VulnerableVault",
        filePath: "src/VulnerableVault.sol",
        functions: [],
        stateVars: [],
        inheritance: [],
        externalCalls: [],
        riskIndicators: [],
      }),
      metadata: {},
    },
  )

  await fireToolAfter(
    plugin,
    {
      tool: "argus_forge_test",
      sessionID,
      callID: "call-forge-test",
      args: { target: FIXTURE_DIR, verbosity: 3 },
    },
    {
      title: "argus_forge_test",
      output: JSON.stringify({
        success: true,
        summary: { passed: 5, failed: 1, skipped: 0, total: 6 },
      }),
      metadata: {},
    },
  )

  await fireToolAfter(
    plugin,
    {
      tool: "argus_forge_fuzz",
      sessionID,
      callID: "call-forge-fuzz",
      args: { target: FIXTURE_DIR, runs: 256 },
    },
    {
      title: "argus_forge_fuzz",
      output: JSON.stringify({
        success: false,
        results: [{ testName: "testFuzzWithdraw", status: "fail", runs: 256, gas: 42000 }],
        counterexamples: [
          {
            testName: "testFuzzWithdraw",
            inputs: { amount: "999999999999999" },
            revertReason: "Insufficient balance",
          },
        ],
        totalRuns: 256,
      }),
      metadata: {},
    },
  )
}

describe("Full audit session lifecycle", () => {
  beforeEach(() => {
    rmSync(join(FIXTURE_DIR, ".argus"), { recursive: true, force: true })
    rmSync(join(FIXTURE_DIR, ".opencode"), { recursive: true, force: true })
  })

  afterEach(() => {
    rmSync(join(FIXTURE_DIR, ".argus"), { recursive: true, force: true })
    rmSync(join(FIXTURE_DIR, ".opencode"), { recursive: true, force: true })
  })

  test("runs full plugin lifecycle from session creation to persisted teardown", async () => {
    const sessionID = "ses-full-lifecycle"
    const plugin = await createPlugin()
    await trackArgusAgent(plugin, sessionID)

    await fireEvent(plugin, "session.created", sessionID)
    await runCoreToolSequence(plugin, sessionID)

    const compactOutput = { context: ["Previous summary."] }
    await plugin["experimental.session.compacting"]?.({ sessionID }, compactOutput)

    const compactBlock = compactOutput.context.at(-1) ?? ""
    expect(compactBlock).toContain("<argus-audit-state>")
    expect(compactBlock).toContain("Contracts Reviewed: src/VulnerableVault.sol")
    expect(compactBlock).toContain("Critical: 0")
    expect(compactBlock).toContain("High: 1")
    expect(compactBlock).toContain("Medium: 1")
    expect(compactBlock).toContain(
      "Tools Executed: argus_slither_analyze, argus_check_patterns, argus_analyze_contract, argus_forge_test, argus_forge_fuzz",
    )

    const systemOutput = { system: [] as string[] }
    type SystemTransformInput = Parameters<
      NonNullable<PluginInstance["experimental.chat.system.transform"]>
    >[0]
    await plugin["experimental.chat.system.transform"]?.(
      { sessionID, model: "test-model" as unknown as SystemTransformInput["model"] },
      systemOutput,
    )
    const systemJoined = systemOutput.system.join("\n")
    expect(systemJoined).toContain('<argus-context agent="argus">')
    expect(systemJoined).toContain("Contracts: 1 reviewed")
    expect(systemJoined).toContain("Findings: Critical=0 High=1 Medium=1 Low=0 Info=0")
    expect(systemJoined).toContain(
      "Tools: argus_slither_analyze, argus_check_patterns, argus_analyze_contract, argus_forge_test, argus_forge_fuzz",
    )

    await fireEvent(plugin, "session.idle", sessionID)
    const runId = String(sessionStateJson(sessionID).sessionId)

    const reportTool = plugin.tool?.argus_generate_report
    if (!reportTool) {
      throw new Error("argus_generate_report tool is unavailable")
    }
    const reportPayload = await reportTool.execute(
      {
        project_name: "VulnerableVault",
        scope: ["src/VulnerableVault.sol"],
        include_executive_summary: true,
        severity_threshold: "low",
        run_id: runId,
        tool_coverage_policy: "skip",
      },
      createMockContext(sessionID),
    )

    await fireToolAfter(
      plugin,
      {
        tool: "argus_generate_report",
        sessionID,
        callID: "call-generate-report",
        args: {
          project_name: "VulnerableVault",
          scope: ["src/VulnerableVault.sol"],
          include_executive_summary: true,
          severity_threshold: "low",
          run_id: runId,
        },
      },
      {
        title: "argus_generate_report",
        output: reportPayload,
        metadata: {},
      },
    )

    await fireEvent(plugin, "session.deleted", sessionID)

    expect(existsSync(sessionStatePath(sessionID))).toBe(false)
    expect(existsSync(latestArchivePath())).toBe(true)
  })
})

describe("Cross-session state continuity", () => {
  beforeEach(() => {
    rmSync(join(FIXTURE_DIR, ".argus"), { recursive: true, force: true })
  })

  afterEach(() => {
    rmSync(join(FIXTURE_DIR, ".argus"), { recursive: true, force: true })
  })

  test("does not inherit findings between different session IDs", async () => {
    const sessionOne = "ses-continuity-1"
    const pluginOne = await createPlugin()
    await trackArgusAgent(pluginOne, sessionOne)
    await fireEvent(pluginOne, "session.created", sessionOne)

    await fireToolAfter(
      pluginOne,
      {
        tool: "argus_slither_analyze",
        sessionID: sessionOne,
        callID: "call-slither-1",
        args: { target: FIXTURE_DIR },
      },
      {
        title: "argus_slither_analyze",
        output: JSON.stringify({
          success: true,
          findings: [
            {
              check: "first-session-check",
              severity: "High",
              confidence: "High",
              description: "First session finding",
              file: "src/VulnerableVault.sol",
              lines: [11, 15],
            },
          ],
        }),
        metadata: {},
      },
    )

    await fireEvent(pluginOne, "session.deleted", sessionOne)

    const sessionTwo = "ses-continuity-2"
    const pluginTwo = await createPlugin()
    await trackArgusAgent(pluginTwo, sessionTwo)
    await fireEvent(pluginTwo, "session.created", sessionTwo)

    const systemOutput = { system: [] as string[] }
    type SystemTransformInput = Parameters<
      NonNullable<PluginInstance["experimental.chat.system.transform"]>
    >[0]
    await pluginTwo["experimental.chat.system.transform"]?.(
      {
        sessionID: sessionTwo,
        model: "test-model" as unknown as SystemTransformInput["model"],
      },
      systemOutput,
    )
    const cleanSessionSystem = systemOutput.system.join("\n")
    expect(cleanSessionSystem).toContain("Findings: Critical=0 High=0 Medium=0 Low=0 Info=0")
    expect(cleanSessionSystem).toContain("Tools: none")

    await fireToolAfter(
      pluginTwo,
      {
        tool: "argus_slither_analyze",
        sessionID: sessionTwo,
        callID: "call-slither-2",
        args: { target: FIXTURE_DIR },
      },
      {
        title: "argus_slither_analyze",
        output: JSON.stringify({
          success: true,
          findings: [
            {
              check: "second-session-check",
              severity: "Medium",
              confidence: "Medium",
              description: "Second session finding",
              file: "src/VulnerableVault.sol",
              lines: [30, 35],
            },
          ],
        }),
        metadata: {},
      },
    )

    await fireEvent(pluginTwo, "session.idle", sessionTwo)
    const persistedState = sessionStateJson(sessionTwo)
    const findings = (persistedState.findings ?? []) as Array<Record<string, unknown>>

    expect(findings).toHaveLength(1)
    expect(findings[0]?.check).toBe("second-session-check")

    await fireEvent(pluginTwo, "session.deleted", sessionTwo)
  })
})

describe("v0.4.0 hardening verification", () => {
  beforeEach(() => {
    rmSync(join(FIXTURE_DIR, ".argus"), { recursive: true, force: true })
  })

  afterEach(() => {
    rmSync(join(FIXTURE_DIR, ".argus"), { recursive: true, force: true })
  })

  test("deterministic finding IDs remain stable for repeated identical outputs", async () => {
    const sessionID = "ses-hardening-deterministic"
    const plugin = await createPlugin()
    await trackArgusAgent(plugin, sessionID)
    await fireEvent(plugin, "session.created", sessionID)

    const repeatedOutput = JSON.stringify({
      success: true,
      findings: [
        {
          check: "deterministic-check",
          severity: "High",
          confidence: "High",
          description: "same finding emitted twice",
          file: "src/VulnerableVault.sol",
          lines: [40, 45],
        },
      ],
    })

    await fireToolAfter(
      plugin,
      {
        tool: "argus_slither_analyze",
        sessionID,
        callID: "call-deterministic-1",
        args: { target: FIXTURE_DIR },
      },
      {
        title: "argus_slither_analyze",
        output: repeatedOutput,
        metadata: {},
      },
    )

    await fireToolAfter(
      plugin,
      {
        tool: "argus_slither_analyze",
        sessionID,
        callID: "call-deterministic-2",
        args: { target: FIXTURE_DIR },
      },
      {
        title: "argus_slither_analyze",
        output: repeatedOutput,
        metadata: {},
      },
    )

    await fireEvent(plugin, "session.idle", sessionID)
    const persisted = sessionStateJson(sessionID)
    const findings = (persisted.findings ?? []) as Array<Record<string, unknown>>
    expect(findings).toHaveLength(2)
    expect(findings[0]?.issue_fingerprint).toBe(findings[1]?.issue_fingerprint)
    expect(String(findings[0]?.id)).not.toMatch(/^obs-/)
  })

  test("config strict mode keeps valid fields and ignores unknown key without crashing", async () => {
    const configDir = join(FIXTURE_DIR, ".argus")
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, "solidity-argus.json"),
      JSON.stringify(
        {
          typo_field: true,
          solodit: {
            enabled: false,
          },
        },
        null,
        2,
      ),
    )

    const plugin = await createPlugin()
    const config = { agent: {}, mcp: {} }
    await plugin.config?.(config)

    expect(config.agent).toBeDefined()
    expect(config.agent).toHaveProperty("argus")
    expect(config.agent).toHaveProperty("sentinel")
    expect(config.mcp).toEqual({})
  })

  test("truncated output marker is handled as non-success and does not mutate audit findings", async () => {
    const sessionID = "ses-hardening-truncated"
    const plugin = await createPlugin()
    await trackArgusAgent(plugin, sessionID)
    await fireEvent(plugin, "session.created", sessionID)

    await fireToolAfter(
      plugin,
      {
        tool: "argus_slither_analyze",
        sessionID,
        callID: "call-truncated",
        args: { target: FIXTURE_DIR },
      },
      {
        title: "argus_slither_analyze",
        output:
          '{"success": true, "findings": [{"check": "reentrancy"}]\n\n[output truncated by opencode]',
        metadata: {},
      },
    )

    await fireEvent(plugin, "session.idle", sessionID)
    const persisted = sessionStateJson(sessionID)

    expect(persisted.findings ?? []).toEqual([])
    const toolsExecuted = (persisted.toolsExecuted ?? []) as Array<Record<string, unknown>>
    expect(toolsExecuted).toHaveLength(1)
    expect(toolsExecuted[0]?.tool).toBe("argus_slither_analyze")
    expect(toolsExecuted[0]?.success).toBe(false)
    expect(toolsExecuted[0]?.findingsCount).toBe(0)
    expect(persisted.currentPhase).toBe("reconnaissance")
  })

  test("pattern checker executes and exposes loader result envelope", async () => {
    const plugin = await createPlugin()
    const patternTool = plugin.tool?.argus_check_patterns
    if (!patternTool) {
      throw new Error("argus_check_patterns tool is unavailable")
    }
    const payload = await patternTool.execute(
      {
        target: FIXTURE_DIR,
        patterns: ["reentrancy"],
        include_scvd: false,
      },
      createMockContext("ses-hardening-pattern-loader"),
    )

    const result = JSON.parse(payload) as {
      patterns?: unknown[]
      errors?: unknown[]
      sources?: unknown[]
      patternsChecked?: number
    }
    const envelope = {
      patterns: result.patterns ?? result.sources ?? [],
      errors: result.errors ?? [],
    }

    expect(Array.isArray(envelope.patterns)).toBe(true)
    expect(Array.isArray(envelope.errors)).toBe(true)
    expect(typeof result.patternsChecked).toBe("number")
  })
})

describe("Plugin teardown and cleanup", () => {
  beforeEach(() => {
    rmSync(join(FIXTURE_DIR, ".argus"), { recursive: true, force: true })
  })

  afterEach(() => {
    rmSync(join(FIXTURE_DIR, ".argus"), { recursive: true, force: true })
  })

  test("persists state on teardown and removes stale .tmp files on next plugin lifecycle", async () => {
    const sessionID = "ses-teardown-1"
    const plugin = await createPlugin()
    await trackArgusAgent(plugin, sessionID)
    await fireEvent(plugin, "session.created", sessionID)

    await fireToolAfter(
      plugin,
      {
        tool: "argus_slither_analyze",
        sessionID,
        callID: "call-teardown-slither",
        args: { target: FIXTURE_DIR },
      },
      {
        title: "argus_slither_analyze",
        output: JSON.stringify({
          success: true,
          findings: [
            {
              check: "teardown-check",
              severity: "Low",
              confidence: "Low",
              description: "teardown finding",
              file: "src/VulnerableVault.sol",
              lines: [1, 2],
            },
          ],
        }),
        metadata: {},
      },
    )

    await fireEvent(plugin, "session.deleted", sessionID)
    expect(existsSync(sessionStatePath(sessionID))).toBe(false)
    expect(existsSync(latestArchivePath())).toBe(true)

    const staleTmpFile = join(FIXTURE_DIR, ".argus", "sessions", "state-stale.json.tmp")
    writeFileSync(staleTmpFile, "stale")
    expect(existsSync(staleTmpFile)).toBe(true)

    const secondPlugin = await createPlugin()
    const secondSessionID = "ses-teardown-2"
    await trackArgusAgent(secondPlugin, secondSessionID)
    await fireEvent(secondPlugin, "session.created", secondSessionID)
    await fireEvent(secondPlugin, "session.deleted", secondSessionID)

    expect(existsSync(staleTmpFile)).toBe(false)
  })
})

describe("Report generation with provenance", () => {
  beforeEach(() => {
    rmSync(join(FIXTURE_DIR, ".argus"), { recursive: true, force: true })
  })

  afterEach(() => {
    rmSync(join(FIXTURE_DIR, ".argus"), { recursive: true, force: true })
  })

  test("writes a provenance-rich report with run-scoped filename", async () => {
    const sessionID = "ses-report-provenance"
    const plugin = await createPlugin()
    await trackArgusAgent(plugin, sessionID)
    await fireEvent(plugin, "session.created", sessionID)

    await runCoreToolSequence(plugin, sessionID)
    await fireToolAfter(
      plugin,
      {
        tool: "argus_solodit_search",
        sessionID,
        callID: "call-solodit",
        args: { query: "reentrancy withdraw" },
      },
      {
        title: "argus_solodit_search",
        output: JSON.stringify({
          query: "reentrancy withdraw",
          totalFound: 1,
          results: [
            {
              title: "Vault withdraw reentrancy",
              severity: "High",
              protocol: "ExampleProtocol",
              url: "https://solodit.xyz/issues/example",
            },
          ],
        }),
        metadata: {},
      },
    )

    await fireEvent(plugin, "session.idle", sessionID)
    const runId = String(sessionStateJson(sessionID).sessionId)

    const reportTool = plugin.tool?.argus_generate_report
    if (!reportTool) {
      throw new Error("argus_generate_report tool is unavailable")
    }
    const reportPayload = await reportTool.execute(
      {
        project_name: "VulnerableVault",
        scope: ["src/VulnerableVault.sol"],
        include_executive_summary: true,
        severity_threshold: "informational",
        run_id: runId,
      },
      createMockContext(sessionID),
    )

    await fireToolAfter(
      plugin,
      {
        tool: "argus_generate_report",
        sessionID,
        callID: "call-generate-report-provenance",
        args: {
          project_name: "VulnerableVault",
          scope: ["src/VulnerableVault.sol"],
          include_executive_summary: true,
          severity_threshold: "informational",
          run_id: runId,
        },
      },
      {
        title: "argus_generate_report",
        output: reportPayload,
        metadata: {},
      },
    )

    const parsedPayload = JSON.parse(reportPayload) as { filePath: string; run_id: string }
    const reportPath = parsedPayload.filePath
    const report = readFileSync(reportPath, "utf-8")

    expect(report).toContain("## Findings")
    expect(report).toContain("## Appendix: Data Provenance")
    expect(report).toContain("### Tool Execution Summary")
    expect(report).toContain("### Source Breakdown")
    expect(report).toContain("| Source | Count |")

    const reportFileName = basename(reportPath)
    expect(reportFileName).toContain(parsedPayload.run_id.substring(0, 8))

    await fireEvent(plugin, "session.deleted", sessionID)
    expect(existsSync(latestArchivePath())).toBe(true)
  })
})
