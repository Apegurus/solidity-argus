import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import path from "node:path"

import ArgusPlugin from "../../src/index"
import { loadArgusConfig, _mergeConfigs } from "../../src/config/loader"
import { createHookGuard } from "../../src/hooks/hook-system"
import { createTools } from "../../src/create-tools"
import { createHooks } from "../../src/create-hooks"
import { createManagers } from "../../src/create-managers"
import { createPluginInterface } from "../../src/plugin-interface"
import { ArgusConfigSchema } from "../../src/config/schema"
import { createAuditStateManager } from "../../src/features/persistent-state/audit-state-manager"
import { doctorCommand } from "../../src/cli/commands/doctor"
import { initCommand } from "../../src/cli/commands/init"
import { cliOutput } from "../../src/cli/cli-output"
import type { Config } from "@opencode-ai/sdk"

const FIXTURE_DIR = path.resolve(import.meta.dir, "../fixtures/vulnerable-vault")

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `argus-e2e-${prefix}-`))
}

function makeSolidityProject(dir: string): void {
  writeFileSync(join(dir, "foundry.toml"), "[profile.default]\nsrc = 'src'\n")
  mkdirSync(join(dir, "src"), { recursive: true })
  writeFileSync(
    join(dir, "src", "Example.sol"),
    "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract Example { }\n",
  )
}

function captureConsole(): {
  logs: string[]
  errors: string[]
  restore: () => void
} {
  const logs: string[] = []
  const errors: string[] = []
  const origLog = console.log
  const origError = console.error
  const origCliLog = cliOutput.log
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "))
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "))
  cliOutput.log = (...args: unknown[]) => logs.push(args.map(String).join(" "))
  return {
    logs,
    errors,
    restore: () => {
      console.log = origLog
      console.error = origError
      cliOutput.log = origCliLog
    },
  }
}

describe("E2E A: Plugin Load", () => {
  test("plugin loads and returns all 6 expected keys", async () => {
    const ctx = { directory: FIXTURE_DIR } as Parameters<typeof ArgusPlugin>[0]
    const result = await ArgusPlugin(ctx)

     expect(result.tool).toBeDefined()
     expect(typeof result.config).toBe("function")
     expect(typeof result["experimental.chat.system.transform"]).toBe("function")
     expect(typeof result["experimental.session.compacting"]).toBe("function")
     expect(typeof result["tool.execute.after"]).toBe("function")
     expect(typeof result.event).toBe("function")
  })

  test("tool map contains all 12 argus tools", async () => {
    const ctx = { directory: FIXTURE_DIR } as Parameters<typeof ArgusPlugin>[0]
    const result = await ArgusPlugin(ctx)

    const toolNames = Object.keys(result.tool ?? {}).sort()
    expect(toolNames).toEqual([
      "argus_analyze_contract",
      "argus_check_patterns",
      "argus_forge_coverage",
      "argus_forge_fuzz",
      "argus_forge_test",
      "argus_gas_analysis",
      "argus_generate_report",
      "argus_proxy_detection",
      "argus_skill_load",
      "argus_slither_analyze",
      "argus_solodit_search",
      "argus_sync_knowledge",
    ])
  })

  test("each tool has description and execute function", async () => {
    const ctx = { directory: FIXTURE_DIR } as Parameters<typeof ArgusPlugin>[0]
    const result = await ArgusPlugin(ctx)

    for (const [name, tool] of Object.entries(result.tool ?? {})) {
      expect(tool.description, `${name} should have description`).toBeTruthy()
      expect(typeof tool.execute, `${name} should have execute fn`).toBe("function")
    }
  })

  test("config hook registers 4 agents and Solodit MCP", async () => {
    const ctx = { directory: FIXTURE_DIR } as Parameters<typeof ArgusPlugin>[0]
    const result = await ArgusPlugin(ctx)

    const config: Config = { agent: {}, mcp: {} }
    await result.config!(config)

    const agentNames = Object.keys(config.agent ?? {}).sort()
    expect(agentNames).toEqual(["argus", "pythia", "scribe", "sentinel"])
    expect(config.mcp?.["solodit-mcp"]).toBeDefined()
  })

  test("plugin works with arbitrary project dir (non-Solidity)", async () => {
    const tmpDir = makeTempDir("non-solidity")
    try {
      const ctx = { directory: tmpDir } as Parameters<typeof ArgusPlugin>[0]
      const result = await ArgusPlugin(ctx)

      expect(result.tool).toBeDefined()
      expect(Object.keys(result.tool ?? {})).toHaveLength(12)
      expect(typeof result.config).toBe("function")
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe("E2E B: CLI Commands", () => {
  let tmpDir: string
  let origCwd: string

  beforeEach(() => {
    tmpDir = makeTempDir("cli")
    origCwd = process.cwd()
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("argus init creates config file in .opencode/", async () => {
    const out = captureConsole()
    try {
      const exitCode = await initCommand.execute([])
      out.restore()

      expect(exitCode).toBe(0)
      const configPath = join(tmpDir, ".opencode", "solidity-argus.json")
      expect(existsSync(configPath)).toBe(true)

      const content = JSON.parse(await Bun.file(configPath).text())
      expect(content.knowledge).toBeDefined()
      expect(content.reporting).toBeDefined()
      expect(content.solodit).toBeDefined()

      expect(out.logs.some((l) => l.includes("Created"))).toBe(true)
    } finally {
      out.restore()
    }
  })

  test("argus init fails gracefully if config already exists", async () => {
    mkdirSync(join(tmpDir, ".opencode"), { recursive: true })
    writeFileSync(join(tmpDir, ".opencode", "solidity-argus.json"), "{}")

    const out = captureConsole()
    try {
      const exitCode = await initCommand.execute([])
      out.restore()

      expect(exitCode).toBe(1)
      expect(out.errors.some((e) => e.includes("already exists"))).toBe(true)
    } finally {
      out.restore()
    }
  })

  test("argus doctor outputs dependency check results", async () => {
    const out = captureConsole()
    try {
      const exitCode = await doctorCommand.execute([])
      out.restore()

      const allOutput = out.logs.join("\n")
      expect(allOutput).toContain("Slither")
      expect(allOutput).toContain("Forge")
      expect(allOutput).toContain("Argus Doctor")

      expect([0, 1]).toContain(exitCode)
    } finally {
      out.restore()
    }
  })

  test("argus doctor detects Foundry project", async () => {
    makeSolidityProject(tmpDir)

    const out = captureConsole()
    try {
      await doctorCommand.execute([])
      out.restore()

      const allOutput = out.logs.join("\n")
      expect(allOutput).toContain("foundry")
    } finally {
      out.restore()
    }
  })
})

describe("E2E C: Config Merge", () => {
  test("project config overrides user config via deep merge", () => {
    const userConfig = {
      agents: { argus: { model: "user-model" } },
      reporting: { format: "markdown", severityThreshold: "high" },
    }
    const projectConfig = {
      agents: { argus: { model: "project-model" } },
      reporting: { format: "markdown", severityThreshold: "low" },
    }

    const merged = _mergeConfigs(userConfig, projectConfig)

    expect(merged.agents.argus.model).toBe("project-model")
    expect(merged.reporting.severityThreshold).toBe("low")
  })

  test("user config alone produces valid config", () => {
    const userConfig = {
      agents: { scribe: { model: "custom-scribe" } },
    }

    const merged = _mergeConfigs(userConfig, null)
    expect(merged.agents.scribe.model).toBe("custom-scribe")
    expect(merged.reporting.format).toBe("markdown")
    expect(merged.disabled_hooks).toEqual([])
  })

  test("empty configs produce valid defaults", () => {
    const merged = _mergeConfigs(null, null)
    expect(merged.agents).toBeDefined()
    expect(merged.reporting.format).toBe("markdown")
    expect(merged.disabled_hooks).toEqual([])
    expect(merged.background.max_concurrent).toBe(3)
  })

  test("loadArgusConfig reads real JSONC from disk", () => {
    const tmpDir = makeTempDir("config-merge")
    try {
      mkdirSync(join(tmpDir, ".opencode"), { recursive: true })
      writeFileSync(
        join(tmpDir, ".opencode", "solidity-argus.jsonc"),
        [
          "{",
          '  "agents": {',
          '    "argus": { "model": "custom-opus" }',
          "  },",
          '  "reporting": {',
          '    "format": "markdown",',
          '    "severityThreshold": "medium",',
          '    "gasAnalysis": true',
          "  }",
          "}",
        ].join("\n"),
      )

      const config = loadArgusConfig(tmpDir)
      expect(config.agents.argus.model).toBe("custom-opus")
      expect(config.reporting.severityThreshold).toBe("medium")
      expect(config.reporting.gasAnalysis).toBe(true)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test("disabled_hooks config is preserved through merge", () => {
    const projectConfig = {
      disabled_hooks: ["system-prompt", "compaction"],
    }

    const merged = _mergeConfigs(null, projectConfig)
    expect(merged.disabled_hooks).toEqual(["system-prompt", "compaction"])
  })

  test("solodit port is configurable", () => {
    const projectConfig = {
      solodit: { enabled: true, port: 4567 },
    }

    const merged = _mergeConfigs(null, projectConfig)
    expect(merged.solodit.port).toBe(4567)
  })

  test("background max_concurrent is configurable", () => {
    const projectConfig = {
      background: { max_concurrent: 5 },
    }

    const merged = _mergeConfigs(null, projectConfig)
    expect(merged.background.max_concurrent).toBe(5)
  })

  test("invalid config falls back to defaults", () => {
    const badConfig = {
      background: { max_concurrent: -1 },
    }

    const merged = _mergeConfigs(null, badConfig)
    expect(merged.background.max_concurrent).toBe(3)
  })
})

describe("E2E D: Hook Lifecycle", () => {
   test("compaction hook serializes audit state as XML block", async () => {
    const config = ArgusConfigSchema.parse({})
    const managers = createManagers({ projectDir: FIXTURE_DIR, config })
    const hooks = createHooks({
      config,
      managers,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    const output = { context: ["Previous summary."] }
    await hooks["experimental.session.compacting"]!({} as any, output)

    expect(output.context.length).toBe(2)
    expect(output.context[1]).toContain("<argus-audit-state>")
    expect(output.context[1]).toContain("Phase:")
  })

  test("tool-after hook processes tool execution results", async () => {
    const config = ArgusConfigSchema.parse({})
    const managers = createManagers({ projectDir: FIXTURE_DIR, config })
    const hooks = createHooks({
      config,
      managers,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    const input = {
      tool: "argus_slither_analyze",
      sessionID: "test-session",
      callID: "call-1",
      args: { target: FIXTURE_DIR },
    }
    const output = {
      title: "argus_slither_analyze",
      output: JSON.stringify({
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
        ],
      }),
      metadata: {},
    }

    await hooks["tool.execute.after"]!(input, output)
  })

  test("event hook handles session lifecycle without throwing", async () => {
    const config = ArgusConfigSchema.parse({})
    const managers = createManagers({ projectDir: FIXTURE_DIR, config })
    const hooks = createHooks({
      config,
      managers,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    const eventHook = hooks.event!
    await eventHook({ event: { type: "session.created", properties: {} } } as any)
    await eventHook({ event: { type: "session.idle", properties: {} } } as any)
    await eventHook({ event: { type: "session.error", properties: {} } } as any)
    await eventHook({ event: { type: "session.deleted", properties: {} } } as any)
  })

  test("disabled_hooks suppresses specific hooks from interface", async () => {
    const config = ArgusConfigSchema.parse({
      disabled_hooks: ["system-prompt", "compaction", "event"],
    })
    const isHookEnabled = createHookGuard(config.disabled_hooks)
    const managers = createManagers({ projectDir: FIXTURE_DIR, config })
    const hooks = createHooks({
      config,
      managers,
      projectDir: FIXTURE_DIR,
      isHookEnabled,
    })

    const iface = createPluginInterface({
      tools: createTools(config),
      hooks,
    })

    expect(typeof iface["experimental.chat.system.transform"]).toBe("function")
    expect(iface["experimental.session.compacting"]).toBeUndefined()
    expect(iface.event).toBeUndefined()

    expect(iface.config).toBeDefined()
    expect(iface["tool.execute.after"]).toBeDefined()
    expect(Object.keys(iface.tool)).toHaveLength(12)
  })

  test("config hook is always present even with all feature hooks disabled", async () => {
    const config = ArgusConfigSchema.parse({
      disabled_hooks: ["system-prompt", "compaction", "tool-tracking", "event"],
    })
    const isHookEnabled = createHookGuard(config.disabled_hooks)
    const managers = createManagers({ projectDir: FIXTURE_DIR, config })
    const hooks = createHooks({
      config,
      managers,
      projectDir: FIXTURE_DIR,
      isHookEnabled,
    })

    const iface = createPluginInterface({
      tools: createTools(config),
      hooks,
    })

    expect(typeof iface.config).toBe("function")
  })

})

describe("E2E E: Persistent State", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTempDir("persist")
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("save then load restores audit state across manager instances", async () => {
    const manager = createAuditStateManager(tmpDir)

    await manager.update({
      currentPhase: "scanning",
      contractsReviewed: ["VulnerableVault.sol"],
      findings: [
        {
          id: "f-1",
          check: "reentrancy",
          severity: "High",
          confidence: "High",
          description: "External call before state update",
          file: "src/VulnerableVault.sol",
          lines: [18, 22],
          source: "slither",
        },
      ],
    })

    const stateFile = join(tmpDir, ".opencode", "argus-state.json")
    expect(existsSync(stateFile)).toBe(true)

    const manager2 = createAuditStateManager(tmpDir)
    const loaded = await manager2.load()

    expect(loaded).not.toBeNull()
    expect(loaded!.currentPhase).toBe("scanning")
    expect(loaded!.contractsReviewed).toEqual(["VulnerableVault.sol"])
    expect(loaded!.findings).toHaveLength(1)
    expect(loaded!.findings[0]!.check).toBe("reentrancy")
  })

  test("update persists incremental changes to disk", async () => {
    const manager = createAuditStateManager(tmpDir)

    await manager.update({ currentPhase: "research" })

    const manager2 = createAuditStateManager(tmpDir)
    const loaded = await manager2.load()

    expect(loaded).not.toBeNull()
    expect(loaded!.currentPhase).toBe("research")
  })

  test("reset restores fresh default state", async () => {
    const manager = createAuditStateManager(tmpDir)

    await manager.update({
      currentPhase: "scanning",
      contractsReviewed: ["A.sol", "B.sol"],
    })

    await manager.reset()

    const manager2 = createAuditStateManager(tmpDir)
    const loaded = await manager2.load()

    expect(loaded).not.toBeNull()
    expect(loaded!.currentPhase).toBe("reconnaissance")
    expect(loaded!.contractsReviewed).toEqual([])
    expect(loaded!.findings).toEqual([])
  })

  test("load returns null when no state file exists", async () => {
    const manager = createAuditStateManager(tmpDir)
    const loaded = await manager.load()
    expect(loaded).toBeNull()
  })

  test("all fields survive JSON roundtrip", async () => {
    const manager = createAuditStateManager(tmpDir)
    const now = Date.now()

    await manager.update({
      currentPhase: "reporting",
      scope: ["VulnerableVault.sol", "Token.sol"],
      contractsReviewed: ["VulnerableVault.sol"],
      toolsExecuted: [
        { tool: "argus_slither_analyze", startTime: now, success: true, findingsCount: 3 },
        { tool: "argus_check_patterns", startTime: now, success: true, findingsCount: 1 },
      ],
      findings: [
        {
          id: "f-1",
          check: "reentrancy",
          severity: "Critical",
          confidence: "High",
          description: "Critical reentrancy",
          file: "src/VulnerableVault.sol",
          lines: [10, 20],
          source: "slither",
          remediation: "Add reentrancy guard",
        },
        {
          id: "f-2",
          check: "access-control",
          severity: "Medium",
          confidence: "Medium",
          description: "Missing access control",
          file: "src/VulnerableVault.sol",
          lines: [30, 40],
          source: "pattern",
        },
      ],
    })

    const manager2 = createAuditStateManager(tmpDir)
    const loaded = await manager2.load()

    expect(loaded).not.toBeNull()
    expect(loaded!.currentPhase).toBe("reporting")
    expect(loaded!.scope).toEqual(["VulnerableVault.sol", "Token.sol"])
    expect(loaded!.contractsReviewed).toEqual(["VulnerableVault.sol"])
    expect(loaded!.toolsExecuted).toHaveLength(2)
    expect(loaded!.findings).toHaveLength(2)
    expect(loaded!.findings[0]!.remediation).toBe("Add reentrancy guard")
    expect(loaded!.findings[1]!.remediation).toBeUndefined()
  })
})
