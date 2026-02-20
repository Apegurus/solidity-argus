import { test, expect, beforeEach, afterEach } from "bun:test";
import { detectProject } from "./project-detector";
import type { ProjectConfig } from "./project-detector";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-detector-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test("detects Foundry project from foundry.toml", async () => {
  const foundryToml = `[profile.default]
src = "src"
test = "test"
solc = "0.8.20"
remappings = ["@openzeppelin/=lib/openzeppelin-contracts/"]
`;
  writeFileSync(join(tempDir, "foundry.toml"), foundryToml);

  const config = await detectProject(tempDir);

  expect(config.type).toBe("foundry");
  expect(config.srcDir).toBe("src");
  expect(config.testDir).toBe("test");
  expect(config.solcVersion).toBe("0.8.20");
  expect(config.remappings).toContain("@openzeppelin/=lib/openzeppelin-contracts/");
  expect(config.rootDir).toBe(tempDir);
});

test("detects Hardhat project from hardhat.config.ts", async () => {
  writeFileSync(join(tempDir, "hardhat.config.ts"), "export default {};");

  const config = await detectProject(tempDir);

  expect(config.type).toBe("hardhat");
  expect(config.srcDir).toBe("contracts");
  expect(config.testDir).toBe("test");
  expect(config.remappings).toEqual([]);
  expect(config.rootDir).toBe(tempDir);
});

test("detects Hardhat project from hardhat.config.js", async () => {
  writeFileSync(join(tempDir, "hardhat.config.js"), "module.exports = {};");

  const config = await detectProject(tempDir);

  expect(config.type).toBe("hardhat");
  expect(config.srcDir).toBe("contracts");
  expect(config.testDir).toBe("test");
  expect(config.rootDir).toBe(tempDir);
});

test("detects mixed project when both foundry.toml and hardhat.config exist", async () => {
  writeFileSync(join(tempDir, "foundry.toml"), "[profile.default]\nsrc = 'src'\n");
  writeFileSync(join(tempDir, "hardhat.config.ts"), "export default {};");

  const config = await detectProject(tempDir);

  expect(config.type).toBe("mixed");
  expect(config.rootDir).toBe(tempDir);
});

test("returns unknown for empty directory", async () => {
  const config = await detectProject(tempDir);

  expect(config.type).toBe("unknown");
  expect(config.srcDir).toBe("src");
  expect(config.testDir).toBe("test");
  expect(config.remappings).toEqual([]);
  expect(config.rootDir).toBe(tempDir);
});

test("parses Foundry foundry.toml with custom src and test dirs", async () => {
  const foundryToml = `[profile.default]
src = "contracts"
test = "tests"
`;
  writeFileSync(join(tempDir, "foundry.toml"), foundryToml);

  const config = await detectProject(tempDir);

  expect(config.type).toBe("foundry");
  expect(config.srcDir).toBe("contracts");
  expect(config.testDir).toBe("tests");
});

test("parses Foundry foundry.toml with multiple remappings", async () => {
  const foundryToml = `[profile.default]
remappings = [
  "@openzeppelin/=lib/openzeppelin-contracts/",
  "@uniswap/=lib/uniswap-v3-core/"
]
`;
  writeFileSync(join(tempDir, "foundry.toml"), foundryToml);

  const config = await detectProject(tempDir);

  expect(config.type).toBe("foundry");
  expect(config.remappings.length).toBe(2);
  expect(config.remappings).toContain("@openzeppelin/=lib/openzeppelin-contracts/");
  expect(config.remappings).toContain("@uniswap/=lib/uniswap-v3-core/");
});

test("handles Foundry foundry.toml without optional fields", async () => {
  const foundryToml = `[profile.default]
`;
  writeFileSync(join(tempDir, "foundry.toml"), foundryToml);

  const config = await detectProject(tempDir);

  expect(config.type).toBe("foundry");
  expect(config.srcDir).toBe("src");
  expect(config.testDir).toBe("test");
  expect(config.remappings).toEqual([]);
  expect(config.solcVersion).toBeUndefined();
  expect(config.viaIr).toBe(false);
});

test("detects via_ir = true in foundry.toml", async () => {
  const foundryToml = `[profile.default]
src = "src"
solc = "0.8.20"
via_ir = true
`;
  writeFileSync(join(tempDir, "foundry.toml"), foundryToml);

  const config = await detectProject(tempDir);

  expect(config.type).toBe("foundry");
  expect(config.viaIr).toBe(true);
});

test("detects via_ir = false in foundry.toml", async () => {
  const foundryToml = `[profile.default]
via_ir = false
`;
  writeFileSync(join(tempDir, "foundry.toml"), foundryToml);

  const config = await detectProject(tempDir);

  expect(config.viaIr).toBe(false);
});

test("detects via-ir (hyphenated) in foundry.toml", async () => {
  const foundryToml = `[profile.default]
via-ir = true
`;
  writeFileSync(join(tempDir, "foundry.toml"), foundryToml);

  const config = await detectProject(tempDir);

  expect(config.viaIr).toBe(true);
});

test("viaIr defaults to false when not in foundry.toml", async () => {
  const foundryToml = `[profile.default]
src = "src"
`;
  writeFileSync(join(tempDir, "foundry.toml"), foundryToml);

  const config = await detectProject(tempDir);

  expect(config.viaIr).toBe(false);
});

test("viaIr is false for non-foundry projects", async () => {
  writeFileSync(join(tempDir, "hardhat.config.ts"), "export default {};");

  const config = await detectProject(tempDir);

  expect(config.viaIr).toBe(false);
});

test("prioritizes foundry.toml over hardhat.config when both exist", async () => {
  writeFileSync(join(tempDir, "foundry.toml"), "[profile.default]\nsrc = 'src'\n");
  writeFileSync(join(tempDir, "hardhat.config.ts"), "export default {};");

  const config = await detectProject(tempDir);

  expect(config.type).toBe("mixed");
});

test("detects optimizer settings from foundry.toml", async () => {
  const foundryToml = `[profile.default]
src = "src"
optimizer = true
optimizer_runs = 200
`;
  writeFileSync(join(tempDir, "foundry.toml"), foundryToml);

  const config = await detectProject(tempDir);

  expect(config.type).toBe("foundry");
  expect(config.optimizer).toEqual({ enabled: true, runs: 200 });
});

test("detects evm_version from foundry.toml", async () => {
  const foundryToml = `[profile.default]
src = "src"
evm_version = "paris"
`;
  writeFileSync(join(tempDir, "foundry.toml"), foundryToml);

  const config = await detectProject(tempDir);

  expect(config.evmVersion).toBe("paris");
});

test("detects multiple profiles in foundry.toml", async () => {
  const foundryToml = `[profile.default]
src = "src"
optimizer = true

[profile.ci]
optimizer_runs = 1000

[profile.lite]
optimizer = false
`;
  writeFileSync(join(tempDir, "foundry.toml"), foundryToml);

  const config = await detectProject(tempDir);

  expect(config.profiles).toContain("default");
  expect(config.profiles).toContain("ci");
  expect(config.profiles).toContain("lite");
  expect(config.profiles!.length).toBe(3);
});

test("detects hardhat config with hasHardhat flag", async () => {
  writeFileSync(join(tempDir, "hardhat.config.ts"), "export default {};");

  const config = await detectProject(tempDir);

  expect(config.hasHardhat).toBe(true);
  expect(config.hasFoundry).toBe(false);
});

test("extracts dependencies from package.json", async () => {
  const packageJson = JSON.stringify({
    name: "my-project",
    dependencies: {
      "@openzeppelin/contracts": "^4.9.0",
      "ethers": "^6.0.0",
    },
    devDependencies: {
      "hardhat": "^2.17.0",
      "@nomicfoundation/hardhat-toolbox": "^3.0.0",
    },
  });
  writeFileSync(join(tempDir, "package.json"), packageJson);
  writeFileSync(join(tempDir, "hardhat.config.ts"), "export default {};");

  const config = await detectProject(tempDir);

  expect(config.dependencies).toEqual({
    "@openzeppelin/contracts": "^4.9.0",
    "ethers": "^6.0.0",
  });
  expect(config.devDependencies).toEqual({
    "hardhat": "^2.17.0",
    "@nomicfoundation/hardhat-toolbox": "^3.0.0",
  });
});

test("detects .openzeppelin/ directory as upgradeable project", async () => {
  mkdirSync(join(tempDir, ".openzeppelin"), { recursive: true });
  writeFileSync(join(tempDir, "hardhat.config.ts"), "export default {};");

  const config = await detectProject(tempDir);

  expect(config.isUpgradeable).toBe(true);
});

test("isUpgradeable is false when .openzeppelin/ does not exist", async () => {
  writeFileSync(join(tempDir, "hardhat.config.ts"), "export default {};");

  const config = await detectProject(tempDir);

  expect(config.isUpgradeable).toBe(false);
});

test("parses remappings.txt file", async () => {
  const remappingsTxt = `@openzeppelin/=lib/openzeppelin-contracts/
@uniswap/=lib/uniswap-v3-core/

forge-std/=lib/forge-std/src/
`;
  writeFileSync(join(tempDir, "remappings.txt"), remappingsTxt);
  writeFileSync(join(tempDir, "foundry.toml"), "[profile.default]\nsrc = 'src'\n");

  const config = await detectProject(tempDir);

  expect(config.remappings).toContain("@openzeppelin/=lib/openzeppelin-contracts/");
  expect(config.remappings).toContain("@uniswap/=lib/uniswap-v3-core/");
  expect(config.remappings).toContain("forge-std/=lib/forge-std/src/");
  expect(config.remappings.length).toBe(3);
});

test("mixed project sets both hasFoundry and hasHardhat", async () => {
  const foundryToml = `[profile.default]
src = "src"
optimizer = true
optimizer_runs = 500
evm_version = "shanghai"
out = "out"
`;
  writeFileSync(join(tempDir, "foundry.toml"), foundryToml);
  writeFileSync(join(tempDir, "hardhat.config.ts"), "export default {};");
  mkdirSync(join(tempDir, ".openzeppelin"), { recursive: true });

  const config = await detectProject(tempDir);

  expect(config.type).toBe("mixed");
  expect(config.hasFoundry).toBe(true);
  expect(config.hasHardhat).toBe(true);
  expect(config.isUpgradeable).toBe(true);
  expect(config.optimizer).toEqual({ enabled: true, runs: 500 });
  expect(config.evmVersion).toBe("shanghai");
  expect(config.outDir).toBe("out");
});

test("detects out directory from foundry.toml", async () => {
  const foundryToml = `[profile.default]
src = "src"
out = "artifacts"
`;
  writeFileSync(join(tempDir, "foundry.toml"), foundryToml);

  const config = await detectProject(tempDir);

  expect(config.outDir).toBe("artifacts");
});
