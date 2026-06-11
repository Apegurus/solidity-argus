import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Config } from "@opencode-ai/sdk/v2"
import type { ArgusConfig } from "../config/types"
import { DEFAULT_MODELS, DEFAULT_STEPS } from "../constants/defaults"
import { createConfigHandler } from "./config-handler"

function createArgusConfig(overrides?: Partial<ArgusConfig>): ArgusConfig {
  return {
    agents: {
      argus: {},
      sentinel: {},
      pythia: {},
      auditSpecialist: {},
      scribe: {},
      themis: {},
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
      skillPrecedence: "bundled-first" as const,
      customSkillsDir: overrides?.knowledge?.customSkillsDir,
    },
    reporting: {
      confidenceThreshold: 80,
      format: "markdown",
      severityThreshold: "low",
      gasAnalysis: false,
      output_dir: ".opencode/reports/",
      ...(overrides?.reporting ?? {}),
    } as unknown as {
      confidenceThreshold: number
      format: "markdown"
      severityThreshold: "critical" | "high" | "medium" | "low" | "informational"
      gasAnalysis: boolean
      output_dir: string
    },
    solodit: {
      enabled: true,
      port: 54173,
      ...overrides?.solodit,
    },
    disabled_hooks: overrides?.disabled_hooks ?? [],
    hooks: overrides?.hooks ?? {},
    cli: overrides?.cli ?? {},
    background: {
      max_concurrent: 3,
      ...overrides?.background,
    },
  }
}

describe("createConfigHandler", () => {
  test("registers all Argus agents", async () => {
    const handler = createConfigHandler(createArgusConfig())
    const config: Config = {}

    await handler(config)

    expect(config.agent?.argus).toBeDefined()
    expect(config.agent?.sentinel).toBeDefined()
    expect(config.agent?.pythia).toBeDefined()
    expect(config.agent?.["audit-specialist"]).toBeDefined()
    expect(config.agent?.scribe).toBeDefined()
    expect(config.agent?.themis).toBeDefined()
  })

  test("sets mode primary for argus and subagent for others", async () => {
    const handler = createConfigHandler(createArgusConfig())
    const config: Config = {}

    await handler(config)

    expect(config.agent?.argus?.mode).toBe("primary")
    expect(config.agent?.sentinel?.mode).toBe("subagent")
    expect(config.agent?.pythia?.mode).toBe("subagent")
    expect(config.agent?.["audit-specialist"]?.mode).toBe("subagent")
    expect(config.agent?.scribe?.mode).toBe("subagent")
    expect(config.agent?.themis?.mode).toBe("subagent")
  })

  test("grants skill permission to all Argus agents", async () => {
    const handler = createConfigHandler(createArgusConfig())
    const config: Config = {}

    await handler(config)

    expect(config.agent?.argus?.permission).toEqual({
      task: {
        sentinel: "allow",
        pythia: "allow",
        "audit-specialist": "allow",
        scribe: "allow",
        themis: "allow",
      },
      skill: "allow",
    })
    expect(config.agent?.sentinel?.permission).toEqual({
      argus_slither_analyze: "allow",
      argus_forge_test: "allow",
      argus_gas_analysis: "allow",
      argus_forge_fuzz: "allow",
      argus_analyze_contract: "allow",
      argus_check_patterns: "allow",
      argus_proxy_detection: "allow",
      argus_forge_coverage: "allow",
      argus_record_finding: "allow",
      argus_skill_load: "allow",
      skill: "allow",
    })
    expect(config.agent?.pythia?.permission).toEqual({
      argus_solodit_search: "allow",
      argus_check_patterns: "allow",
      argus_record_finding: "allow",
      argus_skill_load: "allow",
      skill: "allow",
    })
    expect(config.agent?.["audit-specialist"]?.permission).toEqual({
      argus_skill_load: "allow",
      argus_check_patterns: "allow",
      argus_solodit_search: "allow",
      argus_analyze_contract: "allow",
      argus_slither_analyze: "allow",
      argus_proxy_detection: "allow",
      argus_forge_test: "allow",
      argus_forge_fuzz: "allow",
      argus_forge_coverage: "allow",
      argus_gas_analysis: "allow",
      argus_record_finding: "allow",
      skill: "allow",
    })
    expect(config.agent?.scribe?.permission).toEqual({
      argus_read_findings: "allow",
      argus_generate_report: "allow",
      argus_persist_deduped: "allow",
      argus_skill_load: "allow",
      skill: "allow",
    })
  })

  test("subagents do not use deprecated tools config", async () => {
    const handler = createConfigHandler(createArgusConfig())
    const config: Config = {}

    await handler(config)

    expect(config.agent?.sentinel?.tools).toBeUndefined()
    expect(config.agent?.pythia?.tools).toBeUndefined()
    expect(config.agent?.["audit-specialist"]?.tools).toBeUndefined()
    expect(config.agent?.scribe?.tools).toBeUndefined()
    // argus still uses tools for wildcard denials
    expect(config.agent?.argus?.tools).toBeDefined()
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
          auditSpecialist: {},
          scribe: {},
          themis: {},
        },
      }),
    )
    const config: Config = {}

    await handler(config)

    expect(config.agent?.argus?.model).toBe("openai/gpt-5")
    expect(config.agent?.sentinel?.model).toBe(DEFAULT_MODELS.sentinel)
  })

  test("applies model override for audit-specialist", async () => {
    const handler = createConfigHandler(
      createArgusConfig({
        agents: {
          argus: {},
          sentinel: {},
          pythia: {},
          auditSpecialist: {
            model: "anthropic/claude-opus-4-7",
          },
          scribe: {},
          themis: {},
        },
      }),
    )
    const config: Config = {}

    await handler(config)

    expect(config.agent?.["audit-specialist"]?.model).toBe("anthropic/claude-opus-4-7")
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
    expect(config.agent?.argus?.model).toBe("anthropic/claude-opus-4-7")
    expect(config.agent?.sentinel?.model).toBe(DEFAULT_MODELS.sentinel)
    expect(config.agent?.pythia?.model).toBe(DEFAULT_MODELS.pythia)
    expect(config.agent?.["audit-specialist"]?.model).toBe(DEFAULT_MODELS.auditSpecialist)
    expect(config.agent?.scribe?.model).toBe(DEFAULT_MODELS.scribe)
  })

  test("sets default steps for all Argus agents", async () => {
    const handler = createConfigHandler(createArgusConfig())
    const config: Config = {}

    await handler(config)

    expect(config.agent?.argus?.steps).toBe(DEFAULT_STEPS)
    expect(config.agent?.sentinel?.steps).toBe(DEFAULT_STEPS)
    expect(config.agent?.pythia?.steps).toBe(DEFAULT_STEPS)
    expect(config.agent?.["audit-specialist"]?.steps).toBe(DEFAULT_STEPS)
    expect(config.agent?.scribe?.steps).toBe(DEFAULT_STEPS)
  })

  test("registers Solodit MCP server when enabled", async () => {
    const handler = createConfigHandler(createArgusConfig())
    const config: Config = {}

    await handler(config)

    const solodit = config.mcp?.["solodit-mcp"] as
      | { type: string; url: string; enabled?: boolean }
      | undefined
    expect(solodit).toBeDefined()
    expect(solodit?.type).toBe("remote")
    expect(solodit?.url).toBe("http://localhost:54173/mcp")
    expect(solodit?.enabled).toBe(true)
  })

  test("does not register Solodit MCP when disabled", async () => {
    const handler = createConfigHandler(
      createArgusConfig({
        solodit: {
          enabled: false,
          port: 54173,
        },
      }),
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

  test("registers customSkillsDir when directory exists", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "argus-custom-skills-"))
    const customDir = join(tempRoot, "my-skills")
    mkdirSync(customDir, { recursive: true })

    try {
      const handler = createConfigHandler(
        createArgusConfig({
          knowledge: {
            scvd: {
              enabled: true,
              apiUrl: "https://api.scvd.dev",
            },
            autoSync: true,
            skillPrecedence: "bundled-first" as const,
            customSkillsDir: customDir,
          },
        }),
      )
      const config: Config = {}

      await handler(config)

      expect(config.skills?.paths).toContain(customDir)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test("skips customSkillsDir when directory does not exist", async () => {
    const missingDir = join(tmpdir(), "argus-missing-skills", "does-not-exist")

    const handler = createConfigHandler(
      createArgusConfig({
        knowledge: {
          scvd: {
            enabled: true,
            apiUrl: "https://api.scvd.dev",
          },
          autoSync: true,
          skillPrecedence: "bundled-first" as const,
          customSkillsDir: missingDir,
        },
      }),
    )
    const config: Config = {}

    await handler(config)

    expect(config.skills?.paths).not.toContain(missingDir)
  })

  test("registers Trail of Bits plugin skill directories", async () => {
    const handler = createConfigHandler(createArgusConfig())
    const config: Config = {}

    await handler(config)

    const tobPaths =
      config.skills?.paths?.filter((path) => path.includes("trailofbits-skills/plugins/")) ?? []

    if (tobPaths.length > 0) {
      expect(tobPaths.every((path) => path.endsWith("/skills"))).toBe(true)
    }
  })
})
