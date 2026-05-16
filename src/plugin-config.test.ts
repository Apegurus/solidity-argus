import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadArgusConfig } from "./config/loader"

const testDir = "/tmp/argus-config-test"

beforeEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {}
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {}
})

test("loadArgusConfig returns default config when no file exists", () => {
  const config = loadArgusConfig(testDir)

  expect(config).toBeDefined()
  expect(config.agents).toBeDefined()
  expect(config.agents.argus).toEqual({})
  expect(config.agents.sentinel).toEqual({})
  expect(config.agents.pythia).toEqual({})
  expect(config.agents.scribe).toEqual({})
  expect(config.tools).toEqual({})
  expect(config.knowledge).toBeDefined()
  expect(config.knowledge.scvd).toBeDefined()
  expect(config.knowledge.scvd.enabled).toBe(true)
  expect(config.knowledge.scvd.apiUrl).toBe("https://api.scvd.dev")
  expect(config.knowledge.autoSync).toBe(true)
  expect(config.reporting).toBeDefined()
  expect(config.reporting.format).toBe("markdown")
  expect(config.reporting.severityThreshold).toBe("low")
  expect(config.reporting.gasAnalysis).toBe(false)
  expect(config.solodit).toBeDefined()
  expect(config.solodit.enabled).toBe(true)
  expect(config.disabled_hooks).toEqual([])
})

test("loadArgusConfig merges partial config with defaults", () => {
  const configDir = join(testDir, ".opencode")
  mkdirSync(configDir, { recursive: true })

  writeFileSync(
    join(configDir, "solidity-argus.jsonc"),
    JSON.stringify({
      agents: { argus: { model: "anthropic/claude-opus-4-7" } },
      reporting: { gasAnalysis: true },
    }),
  )

  const config = loadArgusConfig(testDir)

  expect(config.agents.argus.model).toBe("anthropic/claude-opus-4-7")
  expect(config.agents.sentinel).toEqual({})
  expect(config.reporting.gasAnalysis).toBe(true)
  expect(config.reporting.format).toBe("markdown")
  expect(config.reporting.severityThreshold).toBe("low")
  expect(config.knowledge.scvd.enabled).toBe(true)
})

test("loadArgusConfig handles JSONC comments", () => {
  const configDir = join(testDir, ".opencode")
  mkdirSync(configDir, { recursive: true })

  writeFileSync(
    join(configDir, "solidity-argus.jsonc"),
    `{
    // This is a comment
    "agents": {
      "argus": {
        "model": "anthropic/claude-opus-4-7" // inline comment
      }
    },
    /* block comment */
    "reporting": {
      "format": "markdown"
    }
  }`,
  )

  const config = loadArgusConfig(testDir)

  expect(config.agents.argus.model).toBe("anthropic/claude-opus-4-7")
  expect(config.reporting.format).toBe("markdown")
})

test("loadArgusConfig falls back to defaults for invalid config", () => {
  const configDir = join(testDir, ".opencode")
  mkdirSync(configDir, { recursive: true })

  writeFileSync(
    join(configDir, "solidity-argus.jsonc"),
    JSON.stringify({ agents: { argus: { model: 123 } } }),
  )

  const config = loadArgusConfig(testDir)
  expect(config.agents.argus).toEqual({})
})

test("loadArgusConfig accepts valid full config", () => {
  const configDir = join(testDir, ".opencode")
  mkdirSync(configDir, { recursive: true })

  writeFileSync(
    join(configDir, "solidity-argus.jsonc"),
    JSON.stringify({
      agents: {
        argus: { model: "anthropic/claude-opus-4-7" },
        sentinel: { model: "anthropic/claude-sonnet-4-6" },
        pythia: { model: "anthropic/claude-sonnet-4-6" },
        scribe: { model: "anthropic/claude-sonnet-4-6" },
      },
      tools: { slitherPath: "/usr/local/bin/slither", forgePath: "/usr/local/bin/forge" },
      knowledge: {
        scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
        autoSync: true,
        customSkillsDir: "/path/to/skills",
      },
      reporting: {
        format: "markdown",
        severityThreshold: "high",
        gasAnalysis: true,
        output_dir: ".opencode/reports/",
      },
      solodit: { enabled: true },
    }),
  )

  const config = loadArgusConfig(testDir)

  expect(config.agents.argus.model).toBe("anthropic/claude-opus-4-7")
  expect(config.agents.sentinel.model).toBe("anthropic/claude-sonnet-4-6")
  expect(config.tools.slitherPath).toBe("/usr/local/bin/slither")
  expect(config.tools.forgePath).toBe("/usr/local/bin/forge")
  expect(config.knowledge.customSkillsDir).toBe("/path/to/skills")
  expect(config.reporting.severityThreshold).toBe("high")
  expect(config.reporting.gasAnalysis).toBe(true)
})

test("loadArgusConfig returns ArgusConfig type", () => {
  const config = loadArgusConfig(testDir)

  expect(config).toHaveProperty("agents")
  expect(config).toHaveProperty("tools")
  expect(config).toHaveProperty("knowledge")
  expect(config).toHaveProperty("reporting")
  expect(config).toHaveProperty("solodit")
  expect(config).toHaveProperty("disabled_hooks")
})

test("loadArgusConfig handles empty JSONC file", () => {
  const configDir = join(testDir, ".opencode")
  mkdirSync(configDir, { recursive: true })

  writeFileSync(join(configDir, "solidity-argus.jsonc"), "{}")

  const config = loadArgusConfig(testDir)

  expect(config.knowledge.scvd.enabled).toBe(true)
  expect(config.reporting.format).toBe("markdown")
})
