import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { stripJsoncComments } from "./jsonc-parser";

export type ConfigFormat = "json" | "jsonc" | "none";

export interface ConfigFileInfo {
  path: string | null;
  format: ConfigFormat;
}

export function detectConfigFile(basePath: string): ConfigFileInfo {
  const candidates = [
    { path: join(basePath, ".opencode", "opencode-argus.jsonc"), format: "jsonc" as const },
    { path: join(basePath, ".opencode", "opencode-argus.json"), format: "json" as const },
    { path: join(basePath, "opencode-argus.jsonc"), format: "jsonc" as const },
    { path: join(basePath, "opencode-argus.json"), format: "json" as const },
    { path: join(basePath, "config.jsonc"), format: "jsonc" as const },
    { path: join(basePath, "config.json"), format: "json" as const },
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate.path)) {
      return {
        path: candidate.path,
        format: candidate.format,
      };
    }
  }

  return {
    path: null,
    format: "none",
  };
}

export function readJsoncFile(filePath: string): Record<string, any> | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    const content = readFileSync(filePath, "utf-8");

    if (!content.trim()) {
      return null;
    }

    const stripped = stripJsoncComments(content);
    const parsed = JSON.parse(stripped);

    return parsed;
  } catch (_error) {
    return null;
  }
}
