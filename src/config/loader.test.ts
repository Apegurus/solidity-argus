import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("loadArgusConfig", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "argus-loader-test-"))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("returns defaults when no config files exist", async () => {
    const { loadArgusConfig } = await import("./loader")
    const config = loadArgusConfig(tempDir)

    expect(config.agents).toBeDefined()
    expect(config.agents.argus).toEqual({})
    expect(config.agents.sentinel).toEqual({})
    expect(config.agents.pythia).toEqual({})
    expect(config.agents.scribe).toEqual({})
    expect(config.tools).toEqual({})
    expect(config.knowledge.scvd.enabled).toBe(true)
    expect(config.knowledge.scvd.apiUrl).toBe("https://api.scvd.dev")
    expect(config.knowledge.autoSync).toBe(true)
    expect(config.reporting.format).toBe("markdown")
    expect(config.reporting.severityThreshold).toBe("low")
    expect(config.reporting.gasAnalysis).toBe(false)
    expect(config.solodit.enabled).toBe(true)
    expect(config.solodit.enabled).toBe(true)
    expect(config.disabled_hooks).toEqual([])
    expect(config.hooks).toEqual({})
    expect(config.cli).toEqual({})
    expect(config.background.max_concurrent).toBe(3)
  })

  it("loads config from project path .opencode/solidity-argus.json", async () => {
    const opencodeDir = join(tempDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      join(opencodeDir, "solidity-argus.json"),
      JSON.stringify({
        agents: {
          argus: { model: "custom-model" },
        },
        reporting: {
          gasAnalysis: true,
        },
      }),
    )

    const { loadArgusConfig } = await import("./loader")
    const config = loadArgusConfig(tempDir)

    expect(config.agents.argus.model).toBe("custom-model")
    expect(config.reporting.gasAnalysis).toBe(true)
    expect(config.reporting.format).toBe("markdown")
    expect(config.knowledge.autoSync).toBe(true)
  })

  it("loads config from project path .opencode/solidity-argus.jsonc", async () => {
    const opencodeDir = join(tempDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      join(opencodeDir, "solidity-argus.jsonc"),
      `{
  // Agent configuration
  "agents": {
    "sentinel": { "model": "fast-model" }
  },
  "solodit": {
    "enabled": false,
  }
}`,
    )

    const { loadArgusConfig } = await import("./loader")
    const config = loadArgusConfig(tempDir)

    expect(config.agents.sentinel.model).toBe("fast-model")
    expect(config.solodit.enabled).toBe(false)
  })

  it("project config overrides user config via deep merge", async () => {
    const { _mergeConfigs } = await import("./loader")

    const userRaw = {
      agents: {
        argus: { model: "user-model" },
        sentinel: { model: "user-sentinel" },
      },
      reporting: {
        gasAnalysis: true,
      },
    }

    const projectRaw = {
      agents: {
        argus: { model: "project-model" },
      },
      reporting: {
        severityThreshold: "high" as const,
      },
    }

    const config = _mergeConfigs(userRaw, projectRaw)

    expect(config.agents.argus.model).toBe("project-model")
    expect(config.agents.sentinel.model).toBe("user-sentinel")
    expect(config.reporting.gasAnalysis).toBe(true)
    expect(config.reporting.severityThreshold).toBe("high")
  })

  it("invalid config logs warning and returns defaults (no throw)", async () => {
    const opencodeDir = join(tempDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      join(opencodeDir, "solidity-argus.json"),
      JSON.stringify({
        background: { max_concurrent: -5 },
      }),
    )

    const { loadArgusConfig } = await import("./loader")
    const config = loadArgusConfig(tempDir)

    expect(config.background.max_concurrent).toBe(3)
  })

  it("handles malformed JSON gracefully", async () => {
    const opencodeDir = join(tempDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(join(opencodeDir, "solidity-argus.json"), "{ not valid json at all")

    const { loadArgusConfig } = await import("./loader")
    const config = loadArgusConfig(tempDir)

    expect(config.agents).toBeDefined()
    expect(config.knowledge.autoSync).toBe(true)
  })

  it("_mergeConfigs with both null returns defaults", async () => {
    const { _mergeConfigs } = await import("./loader")
    const config = _mergeConfigs(null, null)

    expect(config.agents).toBeDefined()
    expect(config.reporting.format).toBe("markdown")
    expect(config.background.max_concurrent).toBe(3)
  })

  it("_mergeConfigs with only user config", async () => {
    const { _mergeConfigs } = await import("./loader")
    const config = _mergeConfigs({ agents: { argus: { model: "user-only" } } }, null)

    expect(config.agents.argus.model).toBe("user-only")
    expect(config.reporting.format).toBe("markdown")
  })

  it("_mergeConfigs with only project config", async () => {
    const { _mergeConfigs } = await import("./loader")
    const config = _mergeConfigs(null, {
      reporting: { gasAnalysis: true },
    })

    expect(config.reporting.gasAnalysis).toBe(true)
    expect(config.agents).toBeDefined()
  })

  it("loads config from .argus directory first", async () => {
    const argusDir = join(tempDir, ".argus")
    mkdirSync(argusDir, { recursive: true })
    writeFileSync(
      join(argusDir, "solidity-argus.json"),
      JSON.stringify({
        agents: {
          argus: { model: "argus-model" },
        },
      }),
    )

    const { loadArgusConfig } = await import("./loader")
    const config = loadArgusConfig(tempDir)

    expect(config.agents.argus.model).toBe("argus-model")
  })

  it("falls back to .opencode when .argus config does not exist", async () => {
    const opencodeDir = join(tempDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      join(opencodeDir, "solidity-argus.json"),
      JSON.stringify({
        agents: {
          argus: { model: "legacy-model" },
        },
      }),
    )

    const { loadArgusConfig } = await import("./loader")
    const config = loadArgusConfig(tempDir)

    expect(config.agents.argus.model).toBe("legacy-model")
  })

  it(".argus config takes precedence over .opencode config", async () => {
    const argusDir = join(tempDir, ".argus")
    mkdirSync(argusDir, { recursive: true })
    writeFileSync(
      join(argusDir, "solidity-argus.json"),
      JSON.stringify({
        agents: {
          argus: { model: "new-model" },
        },
      }),
    )

    const opencodeDir = join(tempDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      join(opencodeDir, "solidity-argus.json"),
      JSON.stringify({
        agents: {
          argus: { model: "old-model" },
        },
      }),
    )

    const { loadArgusConfig } = await import("./loader")
    const config = loadArgusConfig(tempDir)

    expect(config.agents.argus.model).toBe("new-model")
  })

  it("project disabled_hooks replaces (last-wins) instead of unioning with user", async () => {
    const { _mergeConfigs } = await import("./loader")

    const reEnabled = _mergeConfigs({ disabled_hooks: ["compaction"] }, { disabled_hooks: [] })
    expect(reEnabled.disabled_hooks).toEqual([])

    const replaced = _mergeConfigs(
      { disabled_hooks: ["compaction"] },
      { disabled_hooks: ["event"] },
    )
    expect(replaced.disabled_hooks).toEqual(["event"])
  })

  it("unknownDisabledHooks flags entries that are not canonical Argus hooks", async () => {
    const { unknownDisabledHooks } = await import("./loader")
    expect(unknownDisabledHooks(["knowledge-sync", "config-validation"])).toEqual([
      "config-validation",
    ])
    expect(unknownDisabledHooks(["compaction", "event"])).toEqual([])
  })

  it("_mergeConfigs does not let a __proto__ config key pollute Object.prototype", async () => {
    const { _mergeConfigs } = await import("./loader")
    const malicious = JSON.parse('{"__proto__":{"polluted":true}}')
    _mergeConfigs(null, malicious)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
