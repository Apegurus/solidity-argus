import { describe, expect, it } from "bun:test"
import { ArgusConfigSchema } from "./schema"

describe("ArgusConfigSchema", () => {
  it("validates a complete valid config", () => {
    const config = {
      agents: {
        argus: { model: "anthropic/claude-opus-4-7" },
        sentinel: { model: "anthropic/claude-sonnet-4-6" },
        pythia: { model: "anthropic/claude-sonnet-4-6" },
        scribe: { model: "anthropic/claude-sonnet-4-6" },
      },
      tools: {
        slitherPath: "/usr/local/bin/slither",
        forgePath: "/usr/local/bin/forge",
      },
      knowledge: {
        scvd: {
          enabled: true,
          apiUrl: "https://api.scvd.dev",
        },
        autoSync: true,
        customSkillsDir: "./my-skills",
      },
      reporting: {
        format: "markdown" as const,
        severityThreshold: "low" as const,
        gasAnalysis: true,
      },
      solodit: {
        enabled: true,
        port: 54173,
      },
      disabled_hooks: ["hook1", "hook2"],
      hooks: { custom: { enabled: true } },
      cli: { verbose: true },
      background: { max_concurrent: 5 },
    }

    const result = ArgusConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents.argus.model).toBe("anthropic/claude-opus-4-7")
      expect(result.data.solodit.enabled).toBe(true)
    }
  })

  it("validates empty config with defaults", () => {
    const config = {}

    const result = ArgusConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents).toEqual({
        argus: {},
        sentinel: {},
        pythia: {},
        scribe: {},
        themis: {},
      })
      expect(result.data.tools).toEqual({})
      expect(result.data.disabled_hooks).toEqual([])
      expect(result.data.solodit.enabled).toBe(true)
      expect(result.data.background.max_concurrent).toBe(3)
    }
  })

  it("validates partial config with mixed defaults", () => {
    const config = {
      agents: {
        argus: { model: "custom-model" },
      },
      solodit: {
        enabled: false,
      },
    }

    const result = ArgusConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents.argus.model).toBe("custom-model")
      expect(result.data.agents.sentinel).toEqual({})
      expect(result.data.solodit.enabled).toBe(false)
      expect(result.data.solodit.enabled).toBe(false)
    }
  })

  it("rejects invalid severity threshold", () => {
    const config = {
      reporting: {
        severityThreshold: "invalid" as unknown as string,
      },
    }

    const result = ArgusConfigSchema.safeParse(config)
    expect(result.success).toBe(false)
  })

  it("rejects invalid format", () => {
    const config = {
      reporting: {
        format: "json" as unknown as string,
      },
    }

    const result = ArgusConfigSchema.safeParse(config)
    expect(result.success).toBe(false)
  })

  it("validates agent permission and tools fields", () => {
    const config = {
      agents: {
        argus: {
          model: "custom",
          permission: {
            task: {
              sentinel: "allow",
              pythia: "allow",
            },
          },
          tools: {
            "argus_*": false,
            "solodit-mcp_*": false,
          },
        },
      },
    }

    const result = ArgusConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents.argus.permission).toBeDefined()
      expect(result.data.agents.argus.tools).toBeDefined()
    }
  })

  it("validates disabled_hooks array", () => {
    const config = {
      disabled_hooks: ["knowledge-sync", "config-validation"],
    }

    const result = ArgusConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_hooks).toEqual(["knowledge-sync", "config-validation"])
    }
  })

  it("validates hooks object with arbitrary values", () => {
    const config = {
      hooks: {
        "custom-hook": {
          enabled: true,
          timeout: 5000,
          retries: 3,
        },
      },
    }

    const result = ArgusConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.hooks["custom-hook"]).toBeDefined()
    }
  })

  it("validates cli object with arbitrary values", () => {
    const config = {
      cli: {
        verbose: true,
        outputFormat: "json",
        colors: false,
      },
    }

    const result = ArgusConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.cli.verbose).toBe(true)
    }
  })

  it("validates background concurrency config", () => {
    const config = {
      background: {
        max_concurrent: 10,
      },
    }

    const result = ArgusConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.background.max_concurrent).toBe(10)
    }
  })

  it("rejects invalid background max_concurrent (negative)", () => {
    const config = {
      background: {
        max_concurrent: -1,
      },
    }

    const result = ArgusConfigSchema.safeParse(config)
    expect(result.success).toBe(false)
  })

  it("validates knowledge autoSync and customSkillsDir", () => {
    const config = {
      knowledge: {
        autoSync: false,
        customSkillsDir: "/path/to/skills",
      },
    }

    const result = ArgusConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.knowledge.autoSync).toBe(false)
      expect(result.data.knowledge.customSkillsDir).toBe("/path/to/skills")
    }
  })

  it("defaults skillPrecedence to bundled-first", () => {
    const result = ArgusConfigSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.knowledge.skillPrecedence).toBe("bundled-first")
    }
  })

  it("accepts custom-first skillPrecedence", () => {
    const result = ArgusConfigSchema.safeParse({
      knowledge: { skillPrecedence: "custom-first" },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.knowledge.skillPrecedence).toBe("custom-first")
    }
  })

  it("rejects invalid skillPrecedence value", () => {
    const result = ArgusConfigSchema.safeParse({
      knowledge: { skillPrecedence: "invalid-value" },
    })
    expect(result.success).toBe(false)
  })

  it("validates solodit enabled configuration", () => {
    const config = {
      solodit: {
        enabled: false,
      },
    }

    const result = ArgusConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.solodit.enabled).toBe(false)
    }
  })

  it("uses safeParse without throwing on invalid input", () => {
    const config = {
      agents: {
        invalid_agent: {},
      },
    }

    expect(() => {
      ArgusConfigSchema.safeParse(config)
    }).not.toThrow()
  })

  it("rejects unknown top-level keys (strict mode)", () => {
    const config = {
      disbled_hooks: ["hook1"],
    }

    const result = ArgusConfigSchema.safeParse(config)
    expect(result.success).toBe(false)
    if (!result.success) {
      const hasUnrecognizedKey = result.error.issues.some((i) => i.code === "unrecognized_keys")
      expect(hasUnrecognizedKey).toBe(true)
    }
  })

  it("rejects multiple unknown top-level keys", () => {
    const config = {
      unknownField: true,
      anotherBadKey: "value",
    }

    const result = ArgusConfigSchema.safeParse(config)
    expect(result.success).toBe(false)
  })
})
