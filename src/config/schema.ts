import { z } from "zod"

const AgentConfigSchema = z.object({
  model: z.string().optional(),
  steps: z.number().positive().optional(),
  permission: z.record(z.string(), z.any()).optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  temperature: z.number().min(0).max(2).optional(),
})

const ToolsConfigSchema = z.object({
  slitherPath: z.string().optional(),
  forgePath: z.string().optional(),
})

const ScvdConfigSchema = z.object({
  enabled: z.boolean().default(true),
  apiUrl: z.string().default("https://api.scvd.dev"),
})

const KnowledgeConfigSchema = z.object({
  scvd: ScvdConfigSchema.default({
    enabled: true,
    apiUrl: "https://api.scvd.dev",
  }),
  autoSync: z.boolean().default(true),
  customSkillsDir: z.string().optional(),
  skillPrecedence: z.enum(["bundled-first", "custom-first"]).default("bundled-first"),
})

const ReportingConfigSchema = z.object({
  format: z.enum(["markdown"]).default("markdown"),
  severityThreshold: z.enum(["critical", "high", "medium", "low", "informational"]).default("low"),
  gasAnalysis: z.boolean().default(false),
  output_dir: z.string().default(".argus/reports/"),
})

const SoloditConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().default(54173),
})

const BackgroundConfigSchema = z.object({
  max_concurrent: z.number().positive().default(3),
})

export const ArgusConfigSchema = z
  .object({
    agents: z
      .object({
        argus: AgentConfigSchema.default({}),
        sentinel: AgentConfigSchema.default({}),
        pythia: AgentConfigSchema.default({}),
        scribe: AgentConfigSchema.default({}),
      })
      .default({
        argus: {},
        sentinel: {},
        pythia: {},
        scribe: {},
      }),
    tools: ToolsConfigSchema.default({}),
    knowledge: KnowledgeConfigSchema.default({
      scvd: {
        enabled: true,
        apiUrl: "https://api.scvd.dev",
      },
      autoSync: true,
      skillPrecedence: "bundled-first",
    }),
    reporting: ReportingConfigSchema.default({
      format: "markdown",
      severityThreshold: "low",
      gasAnalysis: false,
      output_dir: ".argus/reports/",
    }),
    solodit: SoloditConfigSchema.default({
      enabled: true,
      port: 54173,
    }),
    disabled_hooks: z.array(z.string()).default([]),
    hooks: z.record(z.string(), z.any()).default({}),
    cli: z.record(z.string(), z.any()).default({}),
    background: BackgroundConfigSchema.default({
      max_concurrent: 3,
    }),
  })
  .strict()
