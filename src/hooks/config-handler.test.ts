import { describe, expect, test } from "bun:test"
import type { Config } from "@opencode-ai/sdk"
import { createConfigHandler } from "./config-handler"
import { DEFAULT_MODELS } from "../constants/defaults"
import type { ArgusConfig } from "../plugin-config"

function createArgusConfig(overrides?: Partial<ArgusConfig>): ArgusConfig {
  return {
    agents: {
      argus: {},
      sentinel: {},
      pythia: {},
      scribe: {},
      ...overrides?.agents,
    },
    tools: {
      ...overrides?.tools,
    },
    knowledge: {
      scvd: {
        enabled: true,
        apiUrl: "https://api.scvd.dev",
        ...overrides?.knowledge?.scvd,
      },
      autoSync: true,
      customSkillsDir: overrides?.knowledge?.customSkillsDir,
    },
    reporting: {
      format: "markdown",
      severityThreshold: "low",
      gasAnalysis: false,
      ...overrides?.reporting,
    },
    solodit: {
      enabled: true,
      ...overrides?.solodit,
    },
  }
}

describe("createConfigHandler", () => {
  test("registers all four Argus agents", async () => {
    const handler = createConfigHandler(createArgusConfig())
    const config: Config = {}

    await handler(config)

    expect(config.agent?.argus).toBeDefined()
    expect(config.agent?.sentinel).toBeDefined()
    expect(config.agent?.pythia).toBeDefined()
    expect(config.agent?.scribe).toBeDefined()
  })

  test("sets mode primary for argus and subagent for others", async () => {
    const handler = createConfigHandler(createArgusConfig())
    const config: Config = {}

    await handler(config)

    expect(config.agent?.argus?.mode).toBe("primary")
    expect(config.agent?.sentinel?.mode).toBe("subagent")
    expect(config.agent?.pythia?.mode).toBe("subagent")
    expect(config.agent?.scribe?.mode).toBe("subagent")
  })

  test("applies model override for argus", async () => {
    const handler = createConfigHandler(
      createArgusConfig({
        agents: {
          argus: {
            model: "openai/gpt-5",
          },
          sentinel: {},
          pythia: {},
          scribe: {},
        },
      })
    )
    const config: Config = {}

    await handler(config)

    expect(config.agent?.argus?.model).toBe("openai/gpt-5")
    expect(config.agent?.sentinel?.model).toBe(DEFAULT_MODELS.sentinel)
  })

  test("preserves existing config.agent entries", async () => {
    const handler = createConfigHandler(createArgusConfig())
    const config: Config = {
      agent: {
        build: {
          mode: "primary",
          model: "anthropic/claude-sonnet-4-6",
        },
      },
    }

    await handler(config)

    expect(config.agent?.build).toEqual({
      mode: "primary",
      model: "anthropic/claude-sonnet-4-6",
    })
    expect(config.agent?.argus).toBeDefined()
  })

  test("uses default models when no overrides are provided", async () => {
    const handler = createConfigHandler(createArgusConfig())
    const config: Config = {}

    await handler(config)

    expect(config.agent?.argus?.model).toBe(DEFAULT_MODELS.argus)
    expect(config.agent?.sentinel?.model).toBe(DEFAULT_MODELS.sentinel)
    expect(config.agent?.pythia?.model).toBe(DEFAULT_MODELS.pythia)
    expect(config.agent?.scribe?.model).toBe(DEFAULT_MODELS.scribe)
  })

  test("registers Solodit MCP server when enabled", async () => {
    const handler = createConfigHandler(createArgusConfig())
    const config: Config = {}

    await handler(config)

    expect(config.mcp?.["solodit-mcp"]).toBeDefined()
    expect(config.mcp?.["solodit-mcp"]?.type).toBe("local")
    expect(config.mcp?.["solodit-mcp"]?.command).toEqual([
      "npx",
      "-y",
      "@lyuboslavlyubenov/solodit-mcp",
    ])
    expect(config.mcp?.["solodit-mcp"]?.enabled).toBe(true)
    expect(config.mcp?.["solodit-mcp"]?.timeout).toBe(10000)
  })

  test("does not register Solodit MCP when disabled", async () => {
    const handler = createConfigHandler(
      createArgusConfig({
        solodit: {
          enabled: false,
        },
      })
    )
    const config: Config = {}

    await handler(config)

    expect(config.mcp?.["solodit-mcp"]).toBeUndefined()
  })

  test("registers plugin skills directory", async () => {
    const handler = createConfigHandler(createArgusConfig())
    const config: Config = {}

    await handler(config)

    expect(config.skills?.paths).toBeDefined()
    expect(Array.isArray(config.skills?.paths)).toBe(true)
    expect(config.skills?.paths?.length).toBeGreaterThan(0)
    expect(config.skills?.paths?.[0]).toMatch(/skills$/)
  })

  test("preserves existing MCP entries", async () => {
    const handler = createConfigHandler(createArgusConfig())
    const config: Config = {
      mcp: {
        "custom-mcp": {
          type: "remote",
          url: "http://localhost:3000",
        },
      },
    }

    await handler(config)

    expect(config.mcp?.["custom-mcp"]).toBeDefined()
    expect(config.mcp?.["solodit-mcp"]).toBeDefined()
  })

  test("preserves existing skills paths", async () => {
    const handler = createConfigHandler(createArgusConfig())
    const config: Config = {
      skills: {
        paths: ["/existing/skills"],
      },
    }

    await handler(config)

    expect(config.skills?.paths).toContain("/existing/skills")
    expect(config.skills?.paths?.length).toBeGreaterThan(1)
  })
})
