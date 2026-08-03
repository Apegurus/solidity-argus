import { describe, expect, it } from "bun:test"
import { ArgusConfigSchema } from "./schema"

describe("ArgusConfigSchema", () => {
  it("validates a complete valid config", () => {
    const config = {
      agents: {
        argus: { model: "anthropic/claude-opus-4-7" },
        sentinel: { model: "anthropic/claude-sonnet-4-6" },
        pythia: { model: "anthropic/claude-sonnet-4-6" },
        auditSpecialist: { model: "anthropic/claude-sonnet-4-6" },
        scribe: { model: "anthropic/claude-sonnet-4-6" },
      },
      tools: {},
      knowledge: {
        scvd: {
          enabled: true,
          apiUrl: "https://api.scvd.dev",
        },
        autoSync: true,
        customSkillsDir: "./my-skills",
      },
      reporting: {
        severityThreshold: "low" as const,
      },
      solodit: {
        enabled: true,
      },
      disabled_hooks: ["hook1", "hook2"],
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
        auditSpecialist: {},
        scribe: {},
        themis: {},
      })
      expect(result.data.tools).toEqual({})
      expect(result.data.disabled_hooks).toEqual([])
      expect(result.data.solodit.enabled).toBe(true)
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
      expect(result.data.agents.auditSpecialist).toEqual({})
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

  it("ignores removed nested configuration fields", () => {
    const config = {
      agents: {
        argus: {
          permission: { task: { sentinel: "allow" } },
          tools: { "argus_*": false },
        },
      },
      tools: {
        slitherPath: "/usr/local/bin/slither",
      },
      reporting: {
        format: "json",
        gasAnalysis: true,
      },
      solodit: {
        enabled: true,
        port: 54173,
      },
    }

    const result = ArgusConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents.argus).toEqual({})
      expect(result.data.tools).toEqual({})
      expect(result.data.reporting).toEqual({
        confidenceThreshold: 80,
        severityThreshold: "low",
        output_dir: ".argus/reports/",
      })
      expect(result.data.solodit).toEqual({ enabled: true })
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

  it("rejects removed top-level configuration fields", () => {
    for (const field of ["hooks", "cli", "background"] as const) {
      const result = ArgusConfigSchema.safeParse({ [field]: {} })
      expect(result.success).toBe(false)
    }
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
