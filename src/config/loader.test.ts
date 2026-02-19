import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

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
    expect(config.solodit.port).toBe(3000)
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
      })
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
    "port": 4000,
  }
}`
    )

    const { loadArgusConfig } = await import("./loader")
    const config = loadArgusConfig(tempDir)

    expect(config.agents.sentinel.model).toBe("fast-model")
    expect(config.solodit.port).toBe(4000)
    expect(config.solodit.enabled).toBe(true)
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
      })
    )

    const { loadArgusConfig } = await import("./loader")
    const config = loadArgusConfig(tempDir)

    expect(config.background.max_concurrent).toBe(3)
  })

  it("handles malformed JSON gracefully", async () => {
    const opencodeDir = join(tempDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      join(opencodeDir, "solidity-argus.json"),
      "{ not valid json at all"
    )

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
    const config = _mergeConfigs(
      { agents: { argus: { model: "user-only" } } },
      null
    )

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
})
