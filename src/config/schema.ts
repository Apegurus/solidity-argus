import { z } from "zod"

export const DEFAULT_CONFIDENCE_THRESHOLD = 80

const AgentConfigSchema = z.object({
  model: z.string().optional(),
  variant: z.string().min(1).optional(),
  steps: z.number().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
})

const ToolsConfigSchema = z.object({})

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
  confidenceThreshold: z
    .number()
    .int()
    .min(0)
    .max(100)
    .default(DEFAULT_CONFIDENCE_THRESHOLD)
    .describe(
      "Threshold (0-100) for splitting findings into '## Findings' (>=) and '## Leads' (<). Default 80.",
    ),
  severityThreshold: z.enum(["critical", "high", "medium", "low", "informational"]).default("low"),
  output_dir: z.string().default(".argus/reports/"),
})

const SoloditConfigSchema = z.object({
  enabled: z.boolean().default(true),
})

export const ArgusConfigSchema = z
  .object({
    agents: z
      .object({
        argus: AgentConfigSchema.default({}),
        sentinel: AgentConfigSchema.default({}),
        pythia: AgentConfigSchema.default({}),
        auditSpecialist: AgentConfigSchema.default({}),
        scribe: AgentConfigSchema.default({}),
        themis: AgentConfigSchema.optional().default({}),
      })
      .default({
        argus: {},
        sentinel: {},
        pythia: {},
        auditSpecialist: {},
        scribe: {},
        themis: {},
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
      confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
      severityThreshold: "low",
      output_dir: ".argus/reports/",
    }),
    solodit: SoloditConfigSchema.default({
      enabled: true,
    }),
    disabled_hooks: z.array(z.string()).default([]),
  })
  .strict()
