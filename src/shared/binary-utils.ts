import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export function hasBinary(name: string): boolean {
  try {
    const result = Bun.spawnSync(["which", name], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return result.exitCode === 0;
  } catch (_e) {
    return false;
  }
}

export function parseSolcVersion(target: string): string | undefined {
  const foundryToml = join(target, "foundry.toml");
  if (existsSync(foundryToml)) {
    const content = readFileSync(foundryToml, "utf-8");
    const match = content.match(/solc\s*=\s*["']([^"']+)["']/);
    if (match?.[1]) return match[1];
  }

  const solFiles = [target];
  if (existsSync(target) && target.endsWith(".sol")) {
    solFiles.push(target);
  } else {
    const srcDir = join(target, "src");
    if (existsSync(srcDir)) {
      try {
        const files = execSync(`find "${srcDir}" -maxdepth 3 -name "*.sol"`, {
          encoding: "utf-8",
          timeout: 5_000,
          stdio: ["pipe", "pipe", "pipe"],
        })
          .trim()
          .split("\n")
          .filter(Boolean);
        solFiles.push(...files);
      } catch (_findErr) {
      }
    }
  }

  for (const file of solFiles) {
    if (!existsSync(file) || !file.endsWith(".sol")) continue;
    try {
      const content = readFileSync(file, "utf-8");
      const pragma = content.match(/pragma\s+solidity\s+[\^~>=<]*\s*([\d.]+)/);
      if (pragma?.[1]) return pragma[1];
    } catch (_readErr) {
    }
  }
  return undefined;
}

export function extractContractNames(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, "utf-8");
    const matches = content.matchAll(/\b(?:contract|library|interface)\s+(\w+)/g);
    return Array.from(matches, (m) => m[1]).filter(Boolean) as string[];
  } catch (_e) {
    return [];
  }
}
