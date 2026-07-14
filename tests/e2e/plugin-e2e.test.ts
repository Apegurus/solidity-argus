import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path, { join } from "node:path"
import type { Config, Event } from "@opencode-ai/sdk"
import { cliOutput } from "../../src/cli/cli-output"
import { doctorCommand } from "../../src/cli/commands/doctor"
import { initCommand } from "../../src/cli/commands/init"
import { _mergeConfigs, loadArgusConfig } from "../../src/config/loader"
import { ArgusConfigSchema } from "../../src/config/schema"
import { createHooks } from "../../src/create-hooks"
import { createTools } from "../../src/create-tools"
import { createAuditStateManager } from "../../src/features/persistent-state/audit-state-manager"
import { createHookGuard } from "../../src/hooks/hook-system"
import ArgusPlugin from "../../src/index"

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
    expect("dispose" in result).toBe(false)
  })

  test("tool map contains all 18 argus tools", async () => {
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
      "argus_list_skills",
      "argus_persist_deduped",
      "argus_proxy_detection",
      "argus_read_findings",
      "argus_recommend_skills",
      "argus_record_finding",
      "argus_skill_load",
      "argus_slither_analyze",
      "argus_solodit_search",
      "argus_sync_knowledge",
      "argus_themis_disposition",
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

  test("config hook registers 6 agents without Solodit MCP", async () => {
    const ctx = { directory: FIXTURE_DIR } as Parameters<typeof ArgusPlugin>[0]
    const result = await ArgusPlugin(ctx)

    const config: Config = { agent: {}, mcp: {} }
    expect(result.config).toBeDefined()
    await result.config?.(config)

    const agentNames = Object.keys(config.agent ?? {}).sort()
    expect(agentNames).toEqual([
      "argus",
      "audit-specialist",
      "pythia",
      "scribe",
      "sentinel",
      "themis",
    ])
    expect(config.mcp?.["solodit-mcp"]).toBeUndefined()
  })

  test("plugin works with arbitrary project dir (non-Solidity)", async () => {
    const tmpDir = makeTempDir("non-solidity")
    try {
      const ctx = { directory: tmpDir } as Parameters<typeof ArgusPlugin>[0]
      const result = await ArgusPlugin(ctx)

      expect(result.tool).toBeDefined()
      expect(Object.keys(result.tool ?? {})).toHaveLength(18)
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

  test("argus init creates config file in .argus/", async () => {
    const out = captureConsole()
    try {
      const exitCode = await initCommand.execute([])
      out.restore()

      expect(exitCode).toBe(0)
      const configPath = join(tmpDir, ".argus", "solidity-argus.json")
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
    mkdirSync(join(tmpDir, ".argus"), { recursive: true })
    writeFileSync(join(tmpDir, ".argus", "solidity-argus.json"), "{}")

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
  }, 15000)

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
      reporting: { severityThreshold: "high" },
    }
    const projectConfig = {
      agents: { argus: { model: "project-model" } },
      reporting: { severityThreshold: "low" },
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
    expect(merged.reporting.severityThreshold).toBe("low")
    expect(merged.disabled_hooks).toEqual([])
  })

  test("empty configs produce valid defaults", () => {
    const merged = _mergeConfigs(null, null)
    expect(merged.agents).toBeDefined()
    expect(merged.reporting.severityThreshold).toBe("low")
    expect(merged.disabled_hooks).toEqual([])
  })

  test("loadArgusConfig reads real JSONC from disk", () => {
    const tmpDir = makeTempDir("config-merge")
    try {
      mkdirSync(join(tmpDir, ".argus"), { recursive: true })
      writeFileSync(
        join(tmpDir, ".argus", "solidity-argus.jsonc"),
        [
          "{",
          '  "agents": {',
          '    "argus": { "model": "custom-opus" }',
          "  },",
          '  "reporting": {',
          '    "severityThreshold": "medium"',
          "  }",
          "}",
        ].join("\n"),
      )

      const config = loadArgusConfig(tmpDir)
      expect(config.agents.argus.model).toBe("custom-opus")
      expect(config.reporting.severityThreshold).toBe("medium")
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

  test("solodit enabled flag is configurable", () => {
    const projectConfig = {
      solodit: { enabled: false },
    }

    const merged = _mergeConfigs(null, projectConfig)
    expect(merged.solodit.enabled).toBe(false)
  })

  test("removed root config fields are not returned", () => {
    const merged = _mergeConfigs(null, {
      background: { max_concurrent: 5 },
      hooks: {},
      cli: {},
    })

    expect(merged).not.toHaveProperty("background")
    expect(merged).not.toHaveProperty("hooks")
    expect(merged).not.toHaveProperty("cli")
  })
})

describe("E2E D: Hook Lifecycle", () => {
  test("compaction hook serializes audit state as XML block", async () => {
    const config = ArgusConfigSchema.parse({})
    const auditStateManager = createAuditStateManager(FIXTURE_DIR)
    const hooks = createHooks({
      config,
      auditStateManager,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    const output = { context: ["Previous summary."] }
    expect(hooks["experimental.session.compacting"]).toBeDefined()
    await hooks["experimental.session.compacting"]?.({ sessionID: "test-session" }, output)

    expect(output.context.length).toBe(2)
    expect(output.context[1]).toContain("<argus-audit-state>")
    expect(output.context[1]).toContain("Phase:")
  })

  test("tool-after hook processes tool execution results", async () => {
    const config = ArgusConfigSchema.parse({})
    const auditStateManager = createAuditStateManager(FIXTURE_DIR)
    const hooks = createHooks({
      config,
      auditStateManager,
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

    expect(hooks["tool.execute.after"]).toBeDefined()
    await hooks["tool.execute.after"]?.(input, output)
  })

  test("event hook handles session lifecycle without throwing", async () => {
    const config = ArgusConfigSchema.parse({})
    const auditStateManager = createAuditStateManager(FIXTURE_DIR)
    const hooks = createHooks({
      config,
      auditStateManager,
      projectDir: FIXTURE_DIR,
      isHookEnabled: () => true,
    })

    expect(hooks.event).toBeDefined()
    await hooks.event?.({ event: { type: "session.created", properties: {} } } as unknown as {
      event: Event
    })
    await hooks.event?.({ event: { type: "session.idle", properties: {} } } as unknown as {
      event: Event
    })
    await hooks.event?.({ event: { type: "session.error", properties: {} } } as unknown as {
      event: Event
    })
    await hooks.event?.({ event: { type: "session.deleted", properties: {} } } as unknown as {
      event: Event
    })
  })

  test("disabled_hooks suppresses specific hooks from interface", async () => {
    const config = ArgusConfigSchema.parse({
      disabled_hooks: ["system-prompt", "compaction", "event"],
    })
    const isHookEnabled = createHookGuard(config.disabled_hooks)
    const auditStateManager = createAuditStateManager(FIXTURE_DIR)
    const hooks = createHooks({
      config,
      auditStateManager,
      projectDir: FIXTURE_DIR,
      isHookEnabled,
    })

    const iface = {
      tool: createTools(config),
      config: hooks.config,
      ...(hooks["chat.params"] ? { "chat.params": hooks["chat.params"] } : {}),
      ...(hooks["chat.message"] ? { "chat.message": hooks["chat.message"] } : {}),
      ...(hooks["experimental.chat.system.transform"]
        ? { "experimental.chat.system.transform": hooks["experimental.chat.system.transform"] }
        : {}),
      ...(hooks["experimental.session.compacting"]
        ? { "experimental.session.compacting": hooks["experimental.session.compacting"] }
        : {}),
      ...(hooks["experimental.text.complete"]
        ? { "experimental.text.complete": hooks["experimental.text.complete"] }
        : {}),
      ...(hooks["tool.execute.after"] ? { "tool.execute.after": hooks["tool.execute.after"] } : {}),
      ...(hooks.event ? { event: hooks.event } : {}),
    }

    expect(iface["experimental.chat.system.transform"]).toBeUndefined()
    expect(iface["experimental.session.compacting"]).toBeUndefined()
    expect(iface.event).toBeUndefined()

    expect(iface.config).toBeDefined()
    expect(iface["tool.execute.after"]).toBeDefined()
    expect(Object.keys(iface.tool)).toHaveLength(18)
  })

  test("config hook is always present even with all feature hooks disabled", async () => {
    const config = ArgusConfigSchema.parse({
      disabled_hooks: ["system-prompt", "compaction", "tool-tracking", "event"],
    })
    const isHookEnabled = createHookGuard(config.disabled_hooks)
    const auditStateManager = createAuditStateManager(FIXTURE_DIR)
    const hooks = createHooks({
      config,
      auditStateManager,
      projectDir: FIXTURE_DIR,
      isHookEnabled,
    })

    const iface = {
      tool: createTools(config),
      config: hooks.config,
      ...(hooks["chat.params"] ? { "chat.params": hooks["chat.params"] } : {}),
      ...(hooks["chat.message"] ? { "chat.message": hooks["chat.message"] } : {}),
      ...(hooks["experimental.chat.system.transform"]
        ? { "experimental.chat.system.transform": hooks["experimental.chat.system.transform"] }
        : {}),
      ...(hooks["experimental.session.compacting"]
        ? { "experimental.session.compacting": hooks["experimental.session.compacting"] }
        : {}),
      ...(hooks["experimental.text.complete"]
        ? { "experimental.text.complete": hooks["experimental.text.complete"] }
        : {}),
      ...(hooks["tool.execute.after"] ? { "tool.execute.after": hooks["tool.execute.after"] } : {}),
      ...(hooks.event ? { event: hooks.event } : {}),
    }

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

    const stateFile = join(tmpDir, ".argus", "argus-state.json")
    expect(existsSync(stateFile)).toBe(true)

    const manager2 = createAuditStateManager(tmpDir)
    const loaded = await manager2.load()

    expect(loaded).not.toBeNull()
    expect(loaded?.currentPhase).toBe("scanning")
    expect(loaded?.contractsReviewed).toEqual(["VulnerableVault.sol"])
    expect(loaded?.findings).toHaveLength(1)
    expect(loaded?.findings?.at(0)?.check).toBe("reentrancy")
  })

  test("update persists incremental changes to disk", async () => {
    const manager = createAuditStateManager(tmpDir)

    await manager.update({ currentPhase: "research" })

    const manager2 = createAuditStateManager(tmpDir)
    const loaded = await manager2.load()

    expect(loaded).not.toBeNull()
    expect(loaded?.currentPhase).toBe("research")
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
    expect(loaded?.currentPhase).toBe("reconnaissance")
    expect(loaded?.contractsReviewed).toEqual([])
    expect(loaded?.findings).toEqual([])
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
    expect(loaded?.currentPhase).toBe("reporting")
    expect(loaded?.scope).toEqual(["VulnerableVault.sol", "Token.sol"])
    expect(loaded?.contractsReviewed).toEqual(["VulnerableVault.sol"])
    expect(loaded?.toolsExecuted).toHaveLength(2)
    expect(loaded?.findings).toHaveLength(2)
    expect(loaded?.findings?.at(0)?.remediation).toBe("Add reentrancy guard")
    expect(loaded?.findings?.at(1)?.remediation).toBeUndefined()
  })
})
