import { existsSync } from "fs";
import { join, resolve } from "path";

export interface ProjectConfig {
  type: "foundry" | "hardhat" | "mixed" | "unknown";
  srcDir: string;
  testDir: string;
  solcVersion?: string;
  remappings: string[];
  viaIr: boolean;
  rootDir: string;
}

/**
 * Detects the Solidity framework (Foundry/Hardhat) from config files
 * @param dir Directory to scan for config files
 * @returns ProjectConfig with detected framework type and settings
 */
export async function detectProject(dir: string): Promise<ProjectConfig> {
  const rootDir = resolve(dir);
  const foundryTomlPath = join(rootDir, "foundry.toml");
  const hardhatConfigTsPath = join(rootDir, "hardhat.config.ts");
  const hardhatConfigJsPath = join(rootDir, "hardhat.config.js");

  const hasFoundry = existsSync(foundryTomlPath);
  const hasHardhatTs = existsSync(hardhatConfigTsPath);
  const hasHardhatJs = existsSync(hardhatConfigJsPath);
  const hasHardhat = hasHardhatTs || hasHardhatJs;

  // Determine project type
  let type: "foundry" | "hardhat" | "mixed" | "unknown";
  if (hasFoundry && hasHardhat) {
    type = "mixed";
  } else if (hasFoundry) {
    type = "foundry";
  } else if (hasHardhat) {
    type = "hardhat";
  } else {
    type = "unknown";
  }

  // Default values
  let srcDir = "src";
  let testDir = "test";
  let solcVersion: string | undefined;
  let remappings: string[] = [];
  let viaIr = false;

  // Parse Foundry config if present
  if (hasFoundry) {
    const foundryConfig = await parseFoundryToml(foundryTomlPath);
    srcDir = foundryConfig.srcDir || srcDir;
    testDir = foundryConfig.testDir || testDir;
    solcVersion = foundryConfig.solcVersion;
    remappings = foundryConfig.remappings;
    viaIr = foundryConfig.viaIr;
  }

  // Set Hardhat defaults if it's a Hardhat project
  if (hasHardhat && !hasFoundry) {
    srcDir = "contracts";
  }

  return {
    type,
    srcDir,
    testDir,
    solcVersion,
    remappings,
    viaIr,
    rootDir,
  };
}

/**
 * Parses foundry.toml file using regex-based parsing
 */
async function parseFoundryToml(
  filePath: string
): Promise<{
  srcDir?: string;
  testDir?: string;
  solcVersion?: string;
  remappings: string[];
  viaIr: boolean;
}> {
  const content = await Bun.file(filePath).text();

  const result = {
    srcDir: undefined as string | undefined,
    testDir: undefined as string | undefined,
    solcVersion: undefined as string | undefined,
    remappings: [] as string[],
    viaIr: false,
  };

  // Extract [profile.default] section - stop at next section or EOF
  const profileDefaultMatch = content.match(
    /\[profile\.default\]([\s\S]*?)(?:\n\[|$)/
  );
  if (!profileDefaultMatch || !profileDefaultMatch[1]) {
    return result;
  }

  const profileSection = profileDefaultMatch[1];

  // Parse src = "..."
  const srcMatch = profileSection.match(/^\s*src\s*=\s*["']([^"']+)["']/m);
  if (srcMatch && srcMatch[1]) {
    result.srcDir = srcMatch[1];
  }

  // Parse test = "..."
  const testMatch = profileSection.match(/^\s*test\s*=\s*["']([^"']+)["']/m);
  if (testMatch && testMatch[1]) {
    result.testDir = testMatch[1];
  }

  // Parse solc = "..."
  const solcMatch = profileSection.match(/^\s*solc\s*=\s*["']([^"']+)["']/m);
  if (solcMatch && solcMatch[1]) {
    result.solcVersion = solcMatch[1];
  }

  // Parse via_ir = true/false
  const viaIrMatch = profileSection.match(/^\s*via[_-]ir\s*=\s*(true|false)/m);
  if (viaIrMatch && viaIrMatch[1] === "true") {
    result.viaIr = true;
  }

  // Parse remappings array - handles both single line and multiline
  const remappingsMatch = profileSection.match(
    /remappings\s*=\s*\[([\s\S]*?)\]/
  );
  if (remappingsMatch && remappingsMatch[1]) {
    const remappingsContent = remappingsMatch[1];
    // Extract quoted strings from the array
    const remappingMatches = remappingsContent.match(/["']([^"']+)["']/g);
    if (remappingMatches) {
      result.remappings = remappingMatches.map((m) => m.slice(1, -1));
    }
  }

  return result;
}
