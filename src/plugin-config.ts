import { z } from "zod";
import { readFileSync } from "fs";
import { join } from "path";

const AgentConfigSchema = z
  .object({
    model: z.string().optional(),
  })
  .default({});

const ToolsConfigSchema = z
  .object({
    slitherPath: z.string().optional(),
    forgePath: z.string().optional(),
  })
  .default({});

const ScvdConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    apiUrl: z.string().default("https://api.scvd.dev"),
  })
  .default({
    enabled: true,
    apiUrl: "https://api.scvd.dev",
  });

const KnowledgeConfigSchema = z
  .object({
    scvd: ScvdConfigSchema,
    autoSync: z.boolean().default(true),
    customSkillsDir: z.string().optional(),
  })
  .default({
    scvd: {
      enabled: true,
      apiUrl: "https://api.scvd.dev",
    },
    autoSync: true,
  });

const ReportingConfigSchema = z
  .object({
    format: z.enum(["markdown"]).default("markdown"),
    severityThreshold: z
      .enum(["critical", "high", "medium", "low", "informational"])
      .default("low"),
    gasAnalysis: z.boolean().default(false),
  })
  .default({
    format: "markdown",
    severityThreshold: "low",
    gasAnalysis: false,
  });

const SolditConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
  })
  .default({
    enabled: true,
  });

const ArgusConfigSchema = z.object({
  agents: z
    .object({
      argus: AgentConfigSchema,
      sentinel: AgentConfigSchema,
      pythia: AgentConfigSchema,
      scribe: AgentConfigSchema,
    })
    .default({
      argus: {},
      sentinel: {},
      pythia: {},
      scribe: {},
    }),
  tools: ToolsConfigSchema,
  knowledge: KnowledgeConfigSchema,
  reporting: ReportingConfigSchema,
  solodit: SolditConfigSchema,
});

export type ArgusConfig = z.infer<typeof ArgusConfigSchema>;

function stripJsoncComments(jsonc: string): string {
  let result = jsonc;
  
  result = result.replace(/\/\*[\s\S]*?\*\//g, "");
  
  const lines = result.split("\n");
  result = lines
    .map((line) => {
      const commentIndex = line.indexOf("//");
      if (commentIndex === -1) return line;
      
      let inString = false;
      let escaped = false;
      for (let i = 0; i < commentIndex; i++) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (line[i] === "\\") {
          escaped = true;
          continue;
        }
        if (line[i] === '"') {
          inString = !inString;
        }
      }
      
      if (inString) return line;
      return line.substring(0, commentIndex);
    })
    .join("\n");
  
  return result;
}

export function loadArgusConfig(projectDir: string): ArgusConfig {
  const configPath = join(projectDir, ".opencode", "opencode-argus.jsonc");

  let configData: unknown = {};

  try {
    const fileContent = readFileSync(configPath, "utf-8");
    const cleanedJson = stripJsoncComments(fileContent);
    configData = JSON.parse(cleanedJson);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      configData = {};
    } else {
      throw error;
    }
  }

  return ArgusConfigSchema.parse(configData);
}
